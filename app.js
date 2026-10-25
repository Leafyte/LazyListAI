/* LazyList AI front end. Plain JavaScript, no build step, no dependencies.
   Everything the model returns is inserted with textContent (never innerHTML). */
(() => {
  "use strict";

  const STATE_KEY = "lazylist.v1.state";
  const SAVED_KEY = "lazylist.v1.saved";
  const MAX_PANTRY = 30;
  const MAX_SAVED = 20;
  const EXAMPLE = ["eggs", "rice", "spinach", "cheddar", "tomatoes", "onion"];

  const $ = (id) => document.getElementById(id);
  const keyOf = (s) => String(s).trim().toLowerCase();
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- Small DOM helper ---------- */

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid);
    return node;
  }

  /* ---------- Storage (localStorage, with safe fallbacks) ---------- */

  let storageWarned = false;

  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      if (!storageWarned) {
        storageWarned = true;
        showBanner("Your browser blocked local storage, so your lists won't be remembered after you close this tab.");
      }
    }
  }

  const strList = (v, max) =>
    (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).slice(0, max);

  function normalizeMeal(m) {
    if (!m || typeof m.name !== "string" || !m.name.trim()) return null;
    return {
      name: m.name,
      description: typeof m.description === "string" ? m.description : "",
      time_minutes: Number.isFinite(m.time_minutes) ? m.time_minutes : null,
      uses: strList(m.uses, 12),
      missing: strList(m.missing, 12),
      steps: strList(m.steps, 8),
    };
  }

  function normalizeItem(i) {
    if (!i || typeof i.name !== "string" || !i.name.trim()) return null;
    return {
      id: typeof i.id === "string" ? i.id : uid(),
      name: i.name,
      forMeals: strList(i.forMeals, 10),
      checked: i.checked === true,
      manual: i.manual === true,
    };
  }

  function normalizeState(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    const cfg = s.settings && typeof s.settings === "object" ? s.settings : {};
    return {
      pantry: strList(s.pantry, MAX_PANTRY),
      meals: (Array.isArray(s.meals) ? s.meals : []).map(normalizeMeal).filter(Boolean),
      shopping: (Array.isArray(s.shopping) ? s.shopping : []).map(normalizeItem).filter(Boolean),
      settings: {
        mealCount: [2, 3, 4, 5].includes(cfg.mealCount) ? cfg.mealCount : 3,
        diet: ["any", "vegetarian", "vegan"].includes(cfg.diet) ? cfg.diet : "any",
      },
    };
  }

  function normalizeSaved(raw) {
    return (Array.isArray(raw) ? raw : [])
      .filter((e) => e && typeof e.id === "string" && typeof e.name === "string" && e.data)
      .slice(0, MAX_SAVED);
  }

  /* ---------- App state ---------- */

  let state = normalizeState(readStore(STATE_KEY, null));
  let saved = normalizeSaved(readStore(SAVED_KEY, []));
  let loading = false;

  const persist = () => writeStore(STATE_KEY, state);
  const hasContent = () => state.pantry.length || state.meals.length || state.shopping.length;

  /* ---------- Messages ---------- */

  function showBanner(message) {
    $("banner-text").textContent = message;
    $("banner").hidden = false;
  }
  const clearBanner = () => { $("banner").hidden = true; };

  let toastTimer;
  function toast(message) {
    const box = $("toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 2400);
  }

  /* ---------- Pantry ---------- */

  function addPantry(raw) {
    const names = raw.split(/[,\n]/).map((s) => s.trim().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean);
    let added = 0;
    for (const name of names) {
      if (state.pantry.length >= MAX_PANTRY) {
        showBanner(`That's plenty! LazyList handles up to ${MAX_PANTRY} ingredients at a time.`);
        break;
      }
      if (!state.pantry.some((p) => keyOf(p) === keyOf(name))) {
        state.pantry.push(name);
        added++;
      }
    }
    if (added) { persist(); renderPantry(); }
  }

  function renderPantry() {
    $("pantry-list").replaceChildren(
      ...state.pantry.map((name) =>
        el("li", { class: "chip" },
          el("span", { text: name }),
          el("button", {
            type: "button", class: "chip-x", "aria-label": `Remove ${name}`, text: "\u00d7",
            onclick: () => { state.pantry = state.pantry.filter((p) => p !== name); persist(); renderPantry(); },
          })
        )
      )
    );
    $("pantry-empty").hidden = state.pantry.length > 0;
    $("clear-pantry").hidden = state.pantry.length === 0;
    updateSuggestButton();
  }

  function updateSuggestButton() {
    const btn = $("suggest-btn");
    btn.disabled = loading || state.pantry.length === 0;
    btn.setAttribute("aria-busy", String(loading));
    $("suggest-label").textContent = loading ? "Thinking\u2026" : "Suggest meals";
  }

  /* ---------- Meals ---------- */

  function mealRow(meal) {
    return el("article", { class: "meal" },
      el("div", { class: "meal-head" },
        el("h3", { text: meal.name }),
        meal.time_minutes ? el("span", { class: "badge", text: `${meal.time_minutes} min` }) : null
      ),
      meal.description ? el("p", { class: "muted", text: meal.description }) : null,
      meal.uses.length
        ? el("div", { class: "tags" },
            el("span", { class: "tag-label", text: "You have" }),
            meal.uses.map((u) => el("span", { class: "tag have", text: u })))
        : null,
      el("div", { class: "tags" },
        el("span", { class: "tag-label", text: "You need" }),
        meal.missing.length
          ? meal.missing.map((m) => el("span", { class: "tag need", text: m }))
          : el("span", { class: "tag have", text: "Nothing, you're set" })),
      meal.steps.length
        ? el("details", {},
            el("summary", { text: "How to make it" }),
            el("ol", {}, meal.steps.map((s) => el("li", { text: s }))))
        : null
    );
  }

  function renderMeals() {
    const box = $("meals");
    box.setAttribute("aria-busy", String(loading));
    if (loading) {
      box.replaceChildren(
        ...[0, 1, 2].map(() => el("div", { class: "skeleton" }, el("i"), el("i"), el("i"))),
        el("p", { class: "loading-note", text: "Gemma is thinking. The first request can take a minute while the model loads." })
      );
    } else if (!state.meals.length) {
      box.replaceChildren(el("p", { class: "empty", text: "Meal ideas show up here. Add what you have, then choose Suggest meals." }));
    } else {
      box.replaceChildren(...state.meals.map(mealRow));
    }
  }

  async function suggest() {
    if (loading || !state.pantry.length) return;
    clearBanner();
    setLoading(true);
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredients: state.pantry,
          meal_count: state.settings.mealCount,
          diet: state.settings.diet,
        }),
      });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON error page */ }
      if (!res.ok) throw new Error((data && data.error) || `The server returned an error (${res.status}).`);
      applyResult(data);
    } catch (err) {
      showBanner(
        err instanceof TypeError
          ? "Can't reach the LazyList server. Check that `python app.py` is still running."
          : err.message
      );
    } finally {
      setLoading(false);
      refreshHealth(false);
    }
  }

  function applyResult(data) {
    const meals = (Array.isArray(data && data.meals) ? data.meals : []).map(normalizeMeal).filter(Boolean);
    if (!meals.length) throw new Error("No meals came back. Please try again.");

    const previous = new Map(state.shopping.map((i) => [keyOf(i.name), i]));
    const auto = (Array.isArray(data.shopping_list) ? data.shopping_list : [])
      .filter((e) => e && typeof e.name === "string" && e.name.trim())
      .map((e) => {
        const old = previous.get(keyOf(e.name));
        return {
          id: old ? old.id : uid(),
          name: e.name,
          forMeals: strList(e.for_meals, 10),
          checked: old ? old.checked : false,
          manual: false,
        };
      });
    const autoKeys = new Set(auto.map((i) => keyOf(i.name)));
    const manual = state.shopping.filter((i) => i.manual && !autoKeys.has(keyOf(i.name)));

    state.meals = meals;
    state.shopping = [...auto, ...manual];
    persist();
    renderMeals();
    renderShopping();
  }

  function setLoading(value) {
    loading = value;
    updateSuggestButton();
    renderMeals();
  }

  /* ---------- Shopping list ---------- */

  function updateCount() {
    const total = state.shopping.length;
    const done = state.shopping.filter((i) => i.checked).length;
    $("list-count").textContent = total ? `${done} of ${total} checked` : "";
  }

  function shoppingRow(item) {
    const id = `item-${item.id}`;
    return el("li", { class: "item" + (item.checked ? " done" : "") },
      el("input", {
        type: "checkbox", id, checked: item.checked,
        onchange: (e) => {
          item.checked = e.target.checked;
          e.target.closest("li").classList.toggle("done", item.checked);
          persist();
          updateCount();
        },
      }),
      el("label", { for: id },
        el("span", { class: "item-name", text: item.name }),
        item.forMeals.length ? el("small", { text: `for ${item.forMeals.join(", ")}` }) : null),
      el("button", {
        type: "button", class: "icon-btn", title: "Remove", "aria-label": `Remove ${item.name}`, text: "\u00d7",
        onclick: () => {
          state.shopping = state.shopping.filter((i) => i.id !== item.id);
          persist();
          renderShopping();
        },
      })
    );
  }

  function renderShopping() {
    $("shopping-list").replaceChildren(...state.shopping.map(shoppingRow));
    $("shopping-empty").textContent = state.shopping.length
      ? ""
      : state.meals.length
        ? "Nothing to buy. You have everything for these meals."
        : "Your list is empty. Suggest some meals or add items yourself.";
    updateCount();
  }

  function addManualItems(raw) {
    const names = raw.split(",").map((s) => s.trim().replace(/\s+/g, " ").slice(0, 80)).filter(Boolean);
    let added = 0;
    for (const name of names) {
      if (state.shopping.some((i) => keyOf(i.name) === keyOf(name))) continue;
      state.shopping.push({ id: uid(), name, forMeals: [], checked: false, manual: true });
      added++;
    }
    if (added) { persist(); renderShopping(); }
  }

  function fallbackCopy(text) {
    const area = el("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0" });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    area.remove();
    return ok;
  }

  async function copyList() {
    if (!state.shopping.length) return toast("Nothing to copy yet.");
    const text = state.shopping.map((i) => `${i.checked ? "[x]" : "[ ]"} ${i.name}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("List copied.");
    } catch {
      toast(fallbackCopy(text) ? "List copied." : "Couldn't copy. Select the text and copy it by hand.");
    }
  }

  /* ---------- Saved lists ---------- */

  function renderSaved() {
    $("saved-lists").replaceChildren(
      ...saved.map((entry) => {
        const items = Array.isArray(entry.data && entry.data.shopping) ? entry.data.shopping.length : 0;
        const when = new Date(entry.savedAt);
        const meta = `${items} ${items === 1 ? "item" : "items"}` + (isNaN(when) ? "" : `, ${when.toLocaleDateString()}`);
        return el("li", { class: "saved-item" },
          el("button", { type: "button", class: "saved-load", title: "Load this list", onclick: () => loadList(entry.id) },
            el("strong", { text: entry.name }),
            el("small", { text: meta })),
          el("button", {
            type: "button", class: "icon-btn", title: "Delete", "aria-label": `Delete ${entry.name}`, text: "\u00d7",
            onclick: () => {
              saved = saved.filter((s) => s.id !== entry.id);
              writeStore(SAVED_KEY, saved);
              renderSaved();
            },
          })
        );
      })
    );
    $("saved-empty").hidden = saved.length > 0;
  }

  function saveList() {
    if (!hasContent()) return toast("Nothing to save yet.");
    const typed = $("list-name").value.trim().slice(0, 40);
    const name = typed || `List from ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    saved.unshift({ id: uid(), name, savedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(state)) });
    saved = saved.slice(0, MAX_SAVED);
    writeStore(SAVED_KEY, saved);
    $("list-name").value = "";
    renderSaved();
    toast(`Saved "${name}".`);
  }

  function loadList(id) {
    const entry = saved.find((s) => s.id === id);
    if (!entry) return;
    if (hasContent() && !confirm("Replace what's on screen with this saved list? Save the current one first if you want to keep it.")) return;
    const loaded = normalizeState(entry.data);
    loaded.settings = state.settings;
    state = loaded;
    persist();
    renderAll();
    toast(`Loaded "${entry.name}".`);
  }

  /* ---------- Ollama status ---------- */

  async function refreshHealth(announce) {
    const pill = $("health");
    const label = $("health-label");
    try {
      const res = await fetch("/api/health");
      const h = await res.json();
      const views = {
        ready: ["ok", `${h.model} ready`],
        model_missing: ["warn", "Model not installed"],
        ollama_down: ["bad", "Ollama not running"],
      };
      const [stateName, text] = views[h.status] || ["warn", "Status unknown"];
      pill.dataset.state = stateName;
      label.textContent = text;
      pill.title = h.message || "";
      if (announce && h.status !== "ready" && h.message) showBanner(h.message);
    } catch {
      pill.dataset.state = "bad";
      label.textContent = "Server unreachable";
      pill.title = "The LazyList server isn't responding. Is `python app.py` running?";
    }
  }

  /* ---------- Wire up ---------- */

  function renderAll() {
    $("meal-count").value = String(state.settings.mealCount);
    $("diet").value = state.settings.diet;
    renderPantry();
    renderMeals();
    renderShopping();
    renderSaved();
  }

  $("pantry-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("ingredient-input");
    addPantry(input.value);
    input.value = "";
    input.focus();
  });

  $("ingredient-input").addEventListener("keydown", (e) => {
    if (e.key === "," && e.target.value.trim()) {
      e.preventDefault();
      addPantry(e.target.value);
      e.target.value = "";
    }
  });

  $("example-btn").addEventListener("click", () => addPantry(EXAMPLE.join(", ")));

  $("clear-pantry").addEventListener("click", () => {
    state.pantry = [];
    persist();
    renderPantry();
  });

  $("meal-count").addEventListener("change", (e) => { state.settings.mealCount = Number(e.target.value); persist(); });
  $("diet").addEventListener("change", (e) => { state.settings.diet = e.target.value; persist(); });
  $("suggest-btn").addEventListener("click", suggest);
  $("banner-close").addEventListener("click", clearBanner);

  $("add-item-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("add-item-input");
    addManualItems(input.value);
    input.value = "";
    input.focus();
  });

  $("remove-checked").addEventListener("click", () => {
    const before = state.shopping.length;
    state.shopping = state.shopping.filter((i) => !i.checked);
    if (state.shopping.length === before) return toast("Nothing is checked yet.");
    persist();
    renderShopping();
  });

  $("copy-list").addEventListener("click", copyList);

  $("clear-list").addEventListener("click", () => {
    if (!state.shopping.length) return;
    if (!confirm("Remove every item from the shopping list?")) return;
    state.shopping = [];
    persist();
    renderShopping();
  });

  $("save-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveList();
  });

  renderAll();
  refreshHealth(true);
})();
