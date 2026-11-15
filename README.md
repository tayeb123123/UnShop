# UnShop 0.3

People often recognise what they *don't* want before they can say what they do. UnShop is an unofficial Manifest V3 Chrome extension for Amazon.com search pages: hit **✕ Not for me** on results that miss, say why in a few words, and UnShop learns your preferences, re-scores the page, and suggests a better search.

An LLM (via a small local server) interprets free-form feedback: Claude by default, or OpenAI / any OpenAI-compatible API, Gemini, or a local Ollama model. Without the server, deterministic local rules still handle budgets, size, and "no X / with X" phrases.

## Run it

**1. Load the extension**

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose this folder (the one with `manifest.json`).
2. If upgrading from 0.2, click **Reload** on the UnShop card and close/reopen any Amazon tabs (old tabs keep the old script).

**2. Start the AI server** (needed for AI interpretation)

```sh
npm install
cp .env.example .env   # pick LLM_PROVIDER and add that provider's key
npm run server
```

It listens on `http://localhost:8787`. The extension's popup, settings page and panel show which provider is connected.

| `LLM_PROVIDER` | Needs | Notes |
| --- | --- | --- |
| `anthropic` (default) | `ANTHROPIC_API_KEY` | Claude Opus 5.5 by default; structured outputs + refusal fallback. Tested live. |
| `openai` | `OPENAI_API_KEY`, `UNSHOP_MODEL` | Strict JSON schema, falling back to JSON mode. Set `OPENAI_BASE_URL` for OpenRouter, Groq, Together, LM Studio, etc. (local servers need no key). |
| `gemini` | `GEMINI_API_KEY`, `UNSHOP_MODEL` | JSON response mode; output validated against the schema. |
| `ollama` | `UNSHOP_MODEL` (pulled locally) | No key, nothing leaves your machine. Small models are slower and less accurate; the first request also loads the model and can exceed the 55 s timeout. |

All providers get the same prompt and must return the same JSON shape; replies are validated and clamped server-side, and if a call fails the extension falls back to local rules. Only the Claude path has been tested against a live API; the others are covered by unit tests with mocked responses.

**3. Try it** — click the toolbar icon → **Try the demo**, or open any `amazon.com/s?k=...` search.

## How it works

| Piece | File | Role |
| --- | --- | --- |
| Content script | `src/content.js` | Finds result cards, injects the per-card badge + **Not for me** button, renders the Shadow-DOM side panel and rejection dialog |
| Preference model | `src/model.runtime.js` | Shared by Chrome and Node tests: state normalisation, local inference, merging Claude results, scoring |
| Background worker | `src/background.js` | The only part that calls the server (content scripts on amazon.com can't reliably reach localhost) |
| Server | `server/server.mjs`, `server/analyze.mjs`, `server/providers.mjs` | Validates requests with zod, calls the configured LLM provider, validates and clamps the response |
| Pages | `src/demo.*`, `src/options.*`, `src/popup.*` | Fictional demo, settings (server URL, AI toggle, data deletion), toolbar popup |

**AI call.** Each rejection or typed request sends: current preferences, the last 12 rejections (title, reason, note), the new feedback, and up to 40 visible products (ASIN, title, price). Claude (`claude-opus-5-5`, low effort, structured JSON output) returns updated preferences (budget, compact, must-have, avoid, notes), a better search query, a one-line summary, and a 0–100 fit score + reason for each product. Server-side refusal fallbacks are enabled (`fallbacks: "default"`). Product titles are treated as untrusted data in the system prompt; the server caps every field before returning. Override the model with `UNSHOP_MODEL`. Other providers receive the same prompt plus the JSON Schema (see `server/providers.mjs`).

**Scoring.** With a Claude score, fit = 75% Claude + 25% local rules (budget, size, avoid/must-have keyword hits), minus a penalty for hard conflicts. Without Claude, local rules alone. Unknown attributes are neutral.

**Why the button didn't work before.** Amazon attaches its own click/mousedown handlers to result cards, and 0.2 appended its toolbar at the bottom of each card where Amazon's layout could clip it. 0.3 positions the controls over the top of each card and handles clicks in the window *capture* phase — the first listener to run — so the page can't swallow them. A browser test simulates a page that swallows all clicks.

**Freeze fix (from 0.2) kept.** The `MutationObserver` disconnects during extension writes, ignores extension-owned and unrelated mutations, and batches scans (≤ 1 per 120 ms).

## Test

```sh
npm install
npm test                                                   # model + server unit tests
PLAYWRIGHT_BROWSERS_PATH=work/browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=work/browsers npm run test:browser
```

Browser tests cover observer stability, click interception, local-mode reject/restore/undo/reset/persistence, Claude mode with a mocked response, recycled cards, collapse, storage failure, and a real unpacked MV3 load (demo, service worker, settings). The Claude call itself is not exercised by the automated tests; a real-key smoke test is manual.

## Judge demo (90 seconds)

1. Start the server, open the demo from the toolbar. Point out the **Claude** pill. All products are fictional.
2. Hit **✕ Not for me** on "Studio One Large Over-Ear…", pick **Too bulky / large**, note "too heavy for my commute". Show Claude's summary, the learned chips, and the fit badges on every card.
3. Type "under $80, nothing flashy" → Enter. Show the RGB/LED products drop, the shortlist reorder, and the refined Amazon search link.
4. Remove a chip with ×, Undo, Restore a product. Refresh to show persistence.
5. Optionally repeat on a live Amazon search.

## Limits and honesty

Unofficial; not affiliated with Amazon. Reads only titles, ASINs, displayed USD prices and thumbnails already on the page; no reviews, account data or purchases. Live Amazon layouts vary by region and experiment — selector coverage is verified on fixtures, not guaranteed live. Preferences are device-local and saved per Amazon search query (`unshopQ:<query>`, 30 most recent kept): a new search starts blank, returning to a search (any page, any casing) restores them, and following UnShop's own refined-search link carries them to the new query (single-use, 30 minutes). Tabs don't sync live. Undo is one step. The server is meant to run on your own machine; for a hosted deployment add authentication and rate limits before exposing it. Review Amazon's conditions of use and Chrome Web Store policy before distributing.
