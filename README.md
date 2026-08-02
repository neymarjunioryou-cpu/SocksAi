# 🧦 SocksRoute

**Your own AI router — built from scratch, zero dependencies, runs anywhere Node runs (including Termux on your phone).**

SocksRoute gives you **one local endpoint** that speaks both the **OpenAI API** and the **Anthropic API**, a **full admin dashboard** where you connect providers, paste API keys, test them, and watch live usage — plus automatic fallback when a provider rate-limits you, token compression, streaming, and a **data-driven model catalog**: **53 provider pools** and **337 bundled models** (refreshed with `npm run catalog:sync`), so you get the OmniRoute-style "one endpoint, hundreds of models" experience.

It is a from-scratch re-implementation of the *idea* behind tools like OmniRoute/9router — not a copy of their code. **Zero npm dependencies, no native modules, no hardcoded secrets, no build step:** `git clone` + `npm install` + `npm run dev`.

```
SocksAi/
├── server.mjs            # entry point (node --watch for dev)
├── scripts/
│   └── sync-catalog.mjs  # refresh the bundled model catalog (npm run catalog:sync)
├── src/
│   ├── config.mjs        # config.json + env + dashboard settings merge
│   ├── providers.mjs     # provider pool registry + OpenAI & Anthropic adapters
│   ├── router.mjs        # selection, cooldowns, fallback, 3 strategies
│   ├── admin.mjs         # /api/* — the dashboard's backend
│   ├── openai.mjs        # /v1/chat/completions (streaming)
│   ├── anthropic.mjs     # /anthropic/v1/messages (Claude Code format)
│   ├── streams.mjs       # SSE passthrough + synthetic streams
│   ├── tokens.mjs        # token estimation + context compression
│   ├── store.mjs         # usage stats, keys, settings, logs (JSON files)
│   ├── dashboard.mjs     # single-file web dashboard
│   └── http-utils.mjs    # tiny HTTP helpers
│   └── catalog/
│       ├── providers.json     # 53 curated provider pools (free-tier info)
│       └── openrouter.json    # 337 bundled models (OpenRouter snapshot)
├── config.example.json   # copy to config.json to override defaults
└── tests/smoke.test.mjs  # 21 offline smoke tests
```

---

## ⚠️ Read this first (the honest truth)

**There is no infinite token faucet.** The "1.6 billion free tokens" you see in OmniRoute marketing is just the sum of the free-tier allowances of every provider it knows about, added up on paper. Free tiers are **real but rate-limited** — and aggressively hammering them gets your free accounts banned.

SocksRoute is the honest version: it makes free tiers **convenient**, not infinite. Use a few providers politely and you can run a coding assistant on your phone for $0.

**Security:** by default SocksRoute binds to `127.0.0.1` only and requires no auth. If you expose it to your LAN/Wi‑Fi, set an API key (below) and keep it off the public internet.

---

## 🚀 Quick start (desktop / laptop)

```bash
# needs Node.js >= 18.18 (any recent LTS is fine)
git clone https://github.com/neymarjunioryou-cpu/SocksAi.git
cd SocksAi
npm install        # instant — there are ZERO dependencies
npm run dev        # starts on http://localhost:20128
```

Open **http://localhost:20128** — the dashboard is right there:

- 🧩 **Providers** — 53 provider pool cards. Click **🔑 Key** to paste an API key, **🧪 Test** to ping a provider, **⏸ Disable** to take one out of rotation.
- 🔎 **Model browser** — search all **337 bundled models** (r1, gemma, kimi, 4o, llama…), see which pool serves them, context length, and free badges.
- 💬 **Chat playground** — pick any model, type a message, watch the streamed reply and which provider answered it.
- 🎛️ **Routing** — strategy (priority / round-robin / latency) + reorder the priority list.
- 📜 **Event log** — keys saved, tests run, providers cooling down, errors.
- ➕ **Add custom provider** — connect *any* OpenAI-compatible API in 10 seconds.

The header shows the live numbers: **🧠 models · 🌐 provider pools · 🆓 free tiers · usage**.

---

## 📱 Termux guide (run it on your Android phone)

```bash
# 1. Update Termux and install Node.js (NOT nodejs-lts — need >= 18.18)
pkg update && pkg upgrade -y
pkg install nodejs git

# 2. Clone the repo
git clone https://github.com/neymarjunioryou-cpu/SocksAi.git
cd SocksAi

# 3. Install (instant — no native modules to compile)
npm install

# 4. Run it
npm run dev
```

The dashboard and API live at **http://localhost:20128** — open it in your phone's browser (Chrome works great).

**Access from a laptop/other devices on the same Wi‑Fi** (find your phone IP with `ip addr show wlan0`):

```bash
HOST=0.0.0.0 SOCKSROUTE_API_KEY=pick-a-long-random-password npm run dev
# then open http://PHONE_IP:20128 from your laptop
```

**Keep it running in the background:**

```bash
nohup npm start > socksroute.log 2>&1 &
# stop it:
pkill -f "server.mjs"
```

**Auto-start after reboot:** install [Termux:Boot](https://wiki.termux.com/wiki/Termux:Boot) and create `~/.termux/boot/socksroute.sh`:

```bash
#!/data/data/com.termux/files/usr/bin/sh
cd ~/SocksAi && nohup npm start > ~/socksroute.log 2>&1 &
```

Also disable battery optimization for Termux, or Android may kill the server.

### Troubleshooting (Termux)

| Problem | Fix |
|---|---|
| `node: command not found` | `pkg install nodejs` (current version, not `nodejs-lts`) |
| `npm run dev` shows `--watch` errors | Your Node is too old — `pkg upgrade` then reinstall nodejs |
| Works locally, not from laptop | Both devices must be on the same network; check hotspot/client isolation; use `HOST=0.0.0.0` |
| Server dies when phone sleeps | Disable battery optimization for Termux |
| Port already in use | `pkill -f server.mjs`, then `npm run dev` again |

---

## 🧩 Provider pools & the model catalog

SocksRoute ships a **data-driven catalog** (`src/catalog/`):

- **`providers.json` — 53 curated provider pools.** Every pool knows its base URL, API format, key env var, and whether a free tier or free credits exist. The pools file is editable — add or fix pools without touching code.
- **`openrouter.json` — 337 bundled models** (a real OpenRouter catalog snapshot: id, name, context length, per-token pricing, free flag, serving provider). Any of these models works through the OpenRouter pool with one key — that's the "500+ models through one endpoint" architecture.
- **Live discovery** — every pool's `/models` endpoint is queried at startup (and via **🔄 Refresh** / `POST /api/refresh`), so Ollama/LM Studio report their installed models and every other pool's catalog stays current.
- **`npm run catalog:sync`** — re-fetches OpenRouter's live model list and updates the bundled snapshot (run it on any networked machine, Termux included; this sandbox can't reach OpenRouter so the repo ships with a snapshot).

### The 53 pools (highlights)

| Pool | Free? | Notes |
|---|---|---|
| **OpenRouter** | ✅ many `:free` models | one key = the 337-model catalog (or 400+ after sync) |
| **Google Gemini** | ✅ free tier | generous daily allowance |
| **Groq** | ✅ free tier | fast Llama inference |
| **Anthropic (Claude)** | paid | real Claude via Anthropic-format adapter |
| **Cerebras · Mistral · NVIDIA NIM · HuggingFace · GitHub Models · SambaNova** | ✅ free tiers/credits | |
| **OpenAI · DeepSeek · xAI · Together · Fireworks · Cohere · AI21 · Replicate …** | paid / credits | the classics |
| **SiliconFlow · Moonshot · Zhipu · Z.ai · MiniMax · Baichuan · Qwen · Yi · StepFun · Baidu · Tencent · Doubao** | mostly free tiers | the Chinese clouds |
| **DeepInfra · Novita · Hyperbolic · Lambda · Nebius · Scaleway · Kluster · Chutes · ShuttleAI · TextCortex · AIMLAPI · Featherless · Upstage · Perplexity** | credits/free tiers | open-model hosting + aggregators |
| **Portkey · Unify · Requesty · Martian · OpenPipe** | varies | gateway/aggregator pools (bring your own upstream) |
| **Ollama · LM Studio (local)** | ✅ 100% free | local models, live-discovered |
| **Pollinations · Mock** | ✅ free | keyless public endpoint + built-in last resort |

Not enough? **Add custom provider** in the dashboard connects literally any OpenAI-compatible API (works offline with Ollama/LM Studio too).

---

## 🔌 Using it with AI coding tools

### Claude Code (Anthropic format)

```bash
export ANTHROPIC_BASE_URL=http://localhost:20128/anthropic
export ANTHROPIC_AUTH_TOKEN=anything-or-your-socksroute-key
cd your-project
claude
# in Claude Code: /model groq:llama-3.3-70b-versatile   (or any SocksRoute model)
```

Claude Code uses the Anthropic endpoint, but SocksRoute can route those requests to **any** provider — Groq, Gemini, OpenRouter… the whole point.

### Cursor / Cline / OpenCode / aider (OpenAI format)

```
Base URL: http://localhost:20128/v1
API key:  (blank, or your SOCKSROUTE_API_KEY)
Model:    groq:llama-3.3-70b-versatile   ← "provider:model" forces a specific one
```

### Model syntax

| You request | What happens |
|---|---|
| `gemini-2.5-flash` | any provider offering that model (Gemini) |
| `groq:llama-3.3-70b-versatile` | that exact provider+model |
| `anthropic:claude-sonnet-4-5` | real Claude via the Anthropic API adapter |
| `ollama:llama3` | a local model via Ollama |
| `openai/gpt-4o-mini` | a bundled catalog model → routed through the OpenRouter pool |
| anything unknown / `auto` | SocksRoute picks providers in order, each with its default model, falling back on failure |

---

## 🎛️ Routing & resilience

- **3 strategies**: `priority` (try in order), `round-robin` (rotate), `latency` (fastest recent provider first — SocksRoute tracks smoothed per-provider latency).
- **Auto-fallback**: on failure it slides to the next provider. Every response carries `X-SocksRoute-Provider: <id>` so you always know who answered.
- **Cooldowns**: 429 → 60s, 5xx → 15s, 401/403 (bad key) → 30min, network error → 5s. Adjustable in `config.json`.
- **Token compression**: long messages truncated, oldest messages pruned past `maxContextTokens` (a poor-man's RTK — honest about what it does).
- **Last resort**: the built-in `mock` answers instead of a silent 503.

## ⚙️ Configuration

Everything is manageable from the dashboard, but for headless setups copy `config.example.json` → `config.json` (gitignored):

```jsonc
{
  "port": 20128,
  "host": "127.0.0.1",              // "0.0.0.0" to allow other devices on the LAN
  "apiKey": "",                     // set this if you expose the server! (or SOCKSROUTE_API_KEY env)
  "routing": { "strategy": "priority", "order": [], "cooldownSeconds": { "429": 60, "5xx": 15, "401": 1800 } },
  "compression": { "enabled": true, "maxContextTokens": 32000, "maxMessageChars": 60000 },
  "providers": { "gemini": { "enabled": true } },   // keys live in data/keys.json (set via dashboard)
  "customProviders": [{ "id": "myapi", "name": "My API", "baseUrl": "https://api.example.com/v1",
                        "apiKey": "sk-...", "models": ["my-model"] }]
}
```

**Environment variables**: `PORT`, `HOST`, `SOCKSROUTE_API_KEY`, `SOCKSROUTE_DATA_DIR`, `SOCKSROUTE_STORAGE_KEY`, plus per-provider keys (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `NVIDIA_API_KEY`, `TOGETHER_API_KEY`, `HF_TOKEN`, `FIREWORKS_API_KEY`, `GITHUB_TOKEN`).

### Admin API (the dashboard's backend)

```
GET    /api/status                 all providers, usage, routing, uptime, logs
GET    /api/config                 runtime config with keys masked
PUT    /api/providers/:id/key      {"key":"..."}  (empty string removes)
DELETE /api/providers/:id/key      remove key
PUT    /api/providers/:id/enabled  {"enabled":true|false}
POST   /api/providers              add custom provider
PUT    /api/providers/:id          edit custom provider
DELETE /api/providers/:id          remove custom provider
PUT    /api/routing                {"strategy":"priority|round-robin|latency","order":[...]}
POST   /api/test                   {"providerId":"groq"} → latency + snippet
POST   /api/refresh                re-discover live model lists
GET    /api/logs                   recent events
POST   /api/shutdown               stop the server
```

## 🧪 Tests

```bash
npm test        # 21 offline smoke tests — no network, no keys needed
```

Covers health, model lists, mock chat, auto-fallback, OpenAI + Anthropic streaming, auth gating, the whole admin API (keys, toggles, custom provider CRUD, routing, test endpoint, logs), and the catalog (pool count, model snapshot size, `/api/catalog`, catalog model routing with fallback).

## 🔒 Security

- [ ] Safe by default — binds to `127.0.0.1`, no auth required
- [ ] Exposing to LAN? Set `SOCKSROUTE_API_KEY` (env) or `apiKey` (config.json)
- [ ] Never port-forward / ngrok it without auth — it holds your provider API keys
- [ ] Keys are stored in `data/keys.json` (gitignored). Set **`SOCKSROUTE_STORAGE_KEY`** to encrypt them at rest with AES-256-GCM — OmniRoute's "encrypted storage" but *opt-in and actually on by default when you set the env var* (no insecure default secret, unlike the CVE-2026-49352 class of bug)
- [ ] Free-tier accounts are tied to your identity — respect provider ToS, don't scrape

## ❓ FAQ

**Where are my 1.6 billion tokens?** They were marketing math. SocksRoute gives you the same *architecture* (multi-provider routing + fallback + compression + dashboard + catalog) so the free tiers you *do* have go as far as possible — without the ToS-abusing "blast through 90 providers" behavior.

**But 53 pools vs OmniRoute's ~290?** Their count mixes in every aggregator, reseller, and OpenRouter-style mirror as a separate "provider". SocksRoute's 53 pools are all real, distinct endpoints — and the **337-model catalog** (via OpenRouter) gives you the same "one endpoint, hundreds of models" experience. The pools file is plain JSON: if you use a niche provider, add it in 30 seconds or use **Add custom provider**.

**Why does it say 43 free tiers?** That counts pools with a genuine free tier *or* free signup credits (each card says which, e.g. "free credits on signup"). OmniRoute's "90+" applies the same generous counting — the difference is we label each one honestly.

**Is this OmniRoute?** No. Same category of tool, written from scratch: zero npm dependencies, no hardcoded secrets, no native builds (Termux-friendly), no 174MB npm package. MIT licensed.

**Does it work without any keys?** Yes — mock + Pollinations work out of the box, plus local Ollama/LM Studio models if installed.

**Will I get banned for using free tiers?** Only if you abuse them. A couple of providers at human speed is what free tiers are for.

**Can it run offline?** Yes — point SocksRoute at Ollama/LM Studio and it becomes a private, 100% local gateway.

**My phone died mid-request?** Stats are flushed every 2s and on shutdown; worst case you lose the last couple of seconds of counters.

---

MIT © SocksAi. Built for fun, from scratch, with 🧦.
