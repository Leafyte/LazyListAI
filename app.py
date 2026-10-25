"""LazyList AI: a tiny grocery-list generator.

Flask serves a static front end and one JSON endpoint. The endpoint asks a
locally running Gemma model (through Ollama) for easy meal ideas, then merges
everything you'd still need to buy into a single de-duplicated shopping list.
Nothing leaves your machine and no paid API is involved.
"""

import json
import os
import re

import requests
from flask import Flask, jsonify, render_template, request

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MODEL = os.environ.get("LAZYLIST_MODEL", "gemma3:4b")
TIMEOUT = int(os.environ.get("LAZYLIST_TIMEOUT", "180"))  # seconds

MAX_INGREDIENTS = 30
MAX_NAME_LEN = 40
DIETS = {"any", "vegetarian", "vegan"}

app = Flask(__name__, template_folder=".", static_folder=".", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024  # requests are tiny; reject anything big


class LazyListError(Exception):
    """An error with a user-friendly message and an HTTP status."""

    def __init__(self, message, status=500):
        super().__init__(message)
        self.message = message
        self.status = status


# --------------------------------------------------------------------------
# Text helpers
# --------------------------------------------------------------------------

def clean_text(value, limit):
    """Strip control characters, collapse whitespace, and cap the length."""
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def stem(word):
    """Very small plural-stripper so 'tomatoes' matches 'tomato'."""
    w = word.lower()
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("oes"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def key_words(name):
    """Normalise an ingredient name to a set of stemmed words."""
    return frozenset(stem(w) for w in re.findall(r"[^\W_]+", name.lower()))


# Things we tell the model to assume everybody has.
STAPLES = {
    frozenset(["salt"]),
    frozenset(["pepper"]),
    frozenset(["black", "pepper"]),
    frozenset(["water"]),
    frozenset(["oil"]),
    frozenset(["cooking", "oil"]),
    frozenset(["vegetable", "oil"]),
}


def as_list(value):
    return value if isinstance(value, list) else []


# --------------------------------------------------------------------------
# Input validation
# --------------------------------------------------------------------------

def parse_ingredients(raw):
    if not isinstance(raw, list):
        raise LazyListError("Send your ingredients as a list.", 400)
    seen, ingredients = set(), []
    for item in raw:
        name = clean_text(item, MAX_NAME_LEN)
        words = key_words(name)
        if not words or words in seen:
            continue
        seen.add(words)
        ingredients.append(name)
    if not ingredients:
        raise LazyListError("Add at least one ingredient first.", 400)
    if len(ingredients) > MAX_INGREDIENTS:
        raise LazyListError(f"That's a lot! Please keep it to {MAX_INGREDIENTS} ingredients or fewer.", 400)
    return ingredients


# --------------------------------------------------------------------------
# Talking to Ollama
# --------------------------------------------------------------------------

MEAL_SCHEMA = {
    "type": "object",
    "properties": {
        "meals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "time_minutes": {"type": "integer"},
                    "uses": {"type": "array", "items": {"type": "string"}},
                    "missing": {"type": "array", "items": {"type": "string"}},
                    "steps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "description", "time_minutes", "uses", "missing", "steps"],
            },
        }
    },
    "required": ["meals"],
}

SYSTEM_PROMPT = (
    "You are LazyList, a friendly kitchen assistant that suggests quick, easy "
    "home-cooked meals. Reply with JSON only, matching the requested schema."
)


def build_prompt(pantry, count, diet):
    diet_line = "" if diet == "any" else f" All meals must be {diet}."
    return (
        f"Ingredients I already have (JSON list): {json.dumps(pantry)}\n\n"
        f"Suggest {count} different easy meals, each under 40 minutes with minimal equipment.{diet_line}\n"
        "Rules:\n"
        "- Assume I also have salt, pepper, water and cooking oil.\n"
        "- Use as many of my ingredients as you can.\n"
        '- "uses": which of my ingredients the meal uses.\n'
        '- "missing": ingredients I would still need to buy. Plain names only, no quantities, at most 5.\n'
        '- "steps": 3 to 5 short steps.\n'
        "- Keep each description to one sentence."
    )


def parse_model_json(content):
    """Parse the model's reply, tolerating code fences or stray text."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    raise LazyListError("Gemma replied in a format I couldn't read. Please try again.", 502)


def ask_gemma(pantry, count, diet):
    payload = {
        "model": MODEL,
        "stream": False,
        "format": MEAL_SCHEMA,  # Ollama structured outputs: forces valid JSON
        "keep_alive": "10m",
        "options": {"temperature": 0.5, "num_predict": 1800},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_prompt(pantry, count, diet)},
        ],
    }
    try:
        resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=TIMEOUT)
    except requests.exceptions.ConnectionError:
        raise LazyListError(
            f"Can't reach Ollama at {OLLAMA_URL}. Start it with `ollama serve` (or open the Ollama app), then try again.",
            503,
        )
    except requests.exceptions.Timeout:
        raise LazyListError(
            "Gemma took too long to answer. The first request loads the model into memory, so try again. "
            "If it keeps happening, switch to a smaller model such as gemma3:1b.",
            504,
        )
    except requests.exceptions.RequestException as exc:
        raise LazyListError(f"Couldn't talk to Ollama: {exc}", 502)

    if resp.status_code == 404:
        raise LazyListError(f"The model '{MODEL}' isn't installed. Run `ollama pull {MODEL}` and try again.", 404)
    if resp.status_code != 200:
        detail = clean_text(resp.text, 200)
        raise LazyListError(f"Ollama returned an error ({resp.status_code}): {detail}", 502)

    try:
        content = resp.json()["message"]["content"]
    except (ValueError, KeyError, TypeError):
        raise LazyListError("Ollama sent back something unexpected. Please try again.", 502)
    return parse_model_json(content)


# --------------------------------------------------------------------------
# Clean up the model output and build the combined shopping list
# --------------------------------------------------------------------------

def tidy_meals(data, pantry, count):
    pantry_sets = [key_words(p) for p in pantry]

    def already_have(words):
        return words in STAPLES or any(words <= owned for owned in pantry_sets)

    meals, shopping = [], {}
    for raw in as_list(data.get("meals") if isinstance(data, dict) else None):
        if not isinstance(raw, dict):
            continue
        name = clean_text(raw.get("name"), 80)
        if not name:
            continue

        missing, seen = [], set()
        for item in as_list(raw.get("missing"))[:12]:
            item_name = clean_text(item, MAX_NAME_LEN)
            words = key_words(item_name)
            if not words or words in seen or already_have(words):
                continue
            seen.add(words)
            missing.append((item_name, words))

        try:
            minutes = max(5, min(180, int(raw.get("time_minutes"))))
        except (TypeError, ValueError):
            minutes = None

        meals.append({
            "name": name,
            "description": clean_text(raw.get("description"), 240),
            "time_minutes": minutes,
            "uses": [t for t in (clean_text(u, MAX_NAME_LEN) for u in as_list(raw.get("uses"))[:12]) if t],
            "missing": [n for n, _ in missing],
            "steps": [t for t in (clean_text(s, 240) for s in as_list(raw.get("steps"))[:8]) if t],
        })
        for item_name, words in missing:
            entry = shopping.setdefault(words, {"name": item_name, "for_meals": []})
            if name not in entry["for_meals"]:
                entry["for_meals"].append(name)

        if len(meals) >= count:
            break

    if not meals:
        raise LazyListError("Gemma didn't come up with any usable meals. Try again or add a few more ingredients.", 502)
    return {"meals": meals, "shopping_list": list(shopping.values())}


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    """Tell the UI whether Ollama is up and the model is installed."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        resp.raise_for_status()
        names = [m.get("name", "") for m in resp.json().get("models", [])]
    except (requests.RequestException, ValueError):
        return jsonify(
            status="ollama_down",
            model=MODEL,
            message=f"Ollama isn't running at {OLLAMA_URL}. Start it with `ollama serve` or open the Ollama app.",
        )
    if MODEL in names or f"{MODEL}:latest" in names:
        return jsonify(status="ready", model=MODEL, message="")
    return jsonify(
        status="model_missing",
        model=MODEL,
        message=f"Ollama is running, but '{MODEL}' isn't installed. Run `ollama pull {MODEL}`.",
    )


@app.post("/api/suggest")
def suggest():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise LazyListError("Send a JSON body.", 400)

    pantry = parse_ingredients(body.get("ingredients"))
    try:
        count = max(1, min(5, int(body.get("meal_count", 3))))
    except (TypeError, ValueError):
        count = 3
    diet = body.get("diet") if body.get("diet") in DIETS else "any"

    return jsonify(tidy_meals(ask_gemma(pantry, count, diet), pantry, count))


@app.errorhandler(LazyListError)
def handle_lazylist_error(err):
    return jsonify(error=err.message), err.status


@app.errorhandler(413)
def handle_too_large(_err):
    return jsonify(error="That request was too large."), 413


@app.errorhandler(Exception)
def handle_unexpected(err):
    if hasattr(err, "code") and isinstance(err.code, int):  # normal HTTP errors (404, 405...)
        if request.path.startswith("/api/"):
            return jsonify(error=getattr(err, "description", "Request failed.")), err.code
        return err
    app.logger.exception("Unhandled error")
    return jsonify(error="Something went wrong on the server. Check the terminal for details."), 500


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
