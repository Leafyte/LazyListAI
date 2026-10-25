# LazyList AI 🥗🛒

> **Turn pantry leftovers into delicious meal plans and a consolidated shopping list.**  
> Powered by a local Gemma model via Ollama. 100% private, free, and runs entirely offline on your machine.

---

## ✨ Features

- **Pantry-First Meal Suggestions**: Tell LazyList what you have in your kitchen (eggs, spinach, rice, etc.). It figures out what dishes you can make with minimal extra groceries.
- **Unified, De-duplicated Shopping List**: Automatically compares meal recipes against what you already have, cross-checking and combining only the missing ingredients into a clean shopping checklist.
- **Dietary & Serving Controls**: Tailor suggestions by dietary preference (*Any*, *Vegetarian*, *Vegan*) and adjust meal count (1–5 meals).
- **100% Local & Private**: Powered by Google's Gemma model via Ollama. No API keys, no paid tokens, and zero personal data leaving your computer.
- **Saved Lists in Browser**: Save your favorite generated plans locally with `localStorage`. No accounts or external databases required.
- **Real-Time Health Monitoring**: Built-in status indicator lets you know if Ollama is running and whether the required model is ready.
- **Zero-Build Lightweight UI**: Built with clean, vanilla HTML/CSS/JavaScript with responsive layout, keyboard shortcuts, and full screen-reader accessibility.

---

## 🛠️ Architecture & Tech Stack

- **Backend**: Python, [Flask](https://flask.palletsprojects.com/)
- **LLM Engine**: [Ollama](https://ollama.com/) running `gemma3:4b` (or any compatible Ollama model)
- **Frontend**: Vanilla JavaScript (ES6+), Semantic HTML5, Custom CSS with CSS variables and responsive grid layout.

---

## 📋 Prerequisites

1. **Python 3.9+**
2. **[Ollama](https://ollama.com/)** installed and running on your system.

---

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/Leafyte/LazyListAI.git
cd LazyListAI
```

### 2. Install Python dependencies
```bash
pip install flask requests
```

### 3. Pull the Ollama model
By default, LazyList AI uses `gemma3:4b`:
```bash
ollama pull gemma3:4b
```
*(Make sure the Ollama service is active. If not running, start it with `ollama serve` or launch the Ollama desktop app).*

### 4. Run the application
```bash
python3 app.py
```

### 5. Open in your browser
Visit:
```
http://127.0.0.1:5000
```

---

## ⚙️ Configuration & Environment Variables

You can customize the model, Ollama URL, or port by setting environment variables:

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | URL of your running Ollama instance |
| `LAZYLIST_MODEL` | `gemma3:4b` | Ollama model tag to use for recipe generation (e.g., `gemma:2b`, `llama3.2`) |
| `LAZYLIST_TIMEOUT` | `180` | Request timeout in seconds for LLM generation |
| `PORT` | `5000` | Port for the Flask web server |
| `HOST` | `127.0.0.1` | Host address to bind to |

#### Example: Running with a custom model or port
```bash
LAZYLIST_MODEL="llama3.2" PORT=8080 python3 app.py
```

---

## 💡 How It Works

1. **Pantry Parsing & Stemming**: User inputs are parsed, cleaned, and normalized with a custom stemming algorithm (e.g., matching `"tomatoes"` with `"tomato"`).
2. **LLM Structured Generation**: A prompt tailored to Gemma requests JSON recipes prioritizing pantry ingredients with minimal missing additions.
3. **Diff & Deduplication**: The backend computes the difference between required ingredients and your kitchen items, merging them into an organized shopping list.
4. **Client-Side Storage**: The user can check off items, save complete grocery runs, and reload previous lists at any time.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/Leafyte/LazyListAI/issues).

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
