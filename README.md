# 🧦 SocksRoute

**Your own AI router — built from scratch, zero dependencies, runs anywhere Node runs (including Termux on your phone).**

SocksRoute gives you **one local endpoint** that speaks both the **OpenAI API** and the **Anthropic API**, and routes every request across the free-tier AI providers you plug in — with automatic fallback when one rate-limits you, token compression to keep contexts small, and a tiny dashboard to watch it all.

It is a from-scratch, dependency-free re-implementation of the *idea* behind tools like OmniRoute/9router — not a copy of their code. No hardcoded secrets, no native modules, no build step: `git clone` + `npm install` + `npm run dev`.

```
SocksAi/
├── server.mjs            # entry point (node --watch for dev)
├── src/
│   ├── config.mjs        # config.json + env var loading
│   ├── providers.mjs     # provider registry + OpenAI-compatible adapter
│   ├── router.mjs        # selection, cooldowns, fallback, round-robin
│   ├── openai.mjs        # /v1/chat/completions (streaming)
│   ├── anthropic.mjs     # /anthropic/v1/messages (Claude Code format)
│   ├── streams.mjs       # SSE passthrough + synthetic streams
│   ├── tokens.mjs        # token estimation + context compression
│   ├── store.mjs         # JSON usage stats (no database)
│   ├── dashboard.mjs     # single-file web dashboard
│   └── http-utils.mjs    # tiny HTTP helpers
├── config.example.json   # copy to config.json and add keys
└── tests/smoke.test.mjs  # offline smoke tests (9 passing)
```

---

## ⚠️ Read this first (the honest truth)

**There is no infinite token faucet.** The "1.6 billion free tokens" you see in OmniRoute marketing is just the sum of the free-tier allowances of every provider it knows about, added up on paper. Free tiers are **real but rate-limited** — and aggressively hammering them gets your free accounts banned.

SocksRoute is the honest version: it makes free tiers **convenient**, not infinite. Use a few providers politely, respect their rate limits, and you can run a coding assistant on your phone for $0.

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

Open **http://localhost:20128** — you get the dashboard, a working `socks-mock` model, and the keyless Pollinations endpoint. Try it:

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"socks-mock","messages":[{"role":"user","content":"hello socks"}]}'
```

Add free API keys (see [Providers](#-free-providers--where-to-get-keys)) and SocksRoute starts routing through them automatically.

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

That's it. The dashboard and API live at **http://localhost:20128** — open it in your phone's browser (Chrome works great).

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

## 🔌 Using it with AI coding tools

SocksRoute is OpenAI- and Anthropic-compatible, so it plugs into almost everything:

### Claude Code (Anthropic format)

```bash
export ANTHROPIC_BASE_URL=http://localhost:20128/anthropic
export ANTHROPIC_AUTH_TOKEN=anything-or-your-socksroute-key
cd your-project
claude
# in Claude Code: /model groq:llama-3.3-70b-versatile   (or any SocksRoute model)
```

### Cursor / Cline / OpenCode / aider (OpenAI format)

Point them at a custom OpenAI-compatible base URL:

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
| `openai` / anything unknown / `auto` | SocksRoute picks providers in priority order, each with its default model, falling back on failure |

---

## 🆓 Free providers & where to get keys

| Provider | Free? | Key needed? | Get it | Models |
|---|---|---|---|---|
| Google Gemini | ✅ free tier | ✅ free key | [aistudio.google.com](https://aistudio.google.com) | `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.5-pro` |
| Groq | ✅ free tier | ✅ free key | [console.groq.com](https://console.groq.com) | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` |
| OpenRouter | ✅ free models | ✅ free key | [openrouter.ai/keys](https://openrouter.ai/keys) | `deepseek/deepseek-r1:free`, `meta-llama/llama-3.3-70b-instruct:free`, `openai/gpt-4o-mini:free` |
| Cerebras | ✅ free tier | ✅ free key | [cloud.cerebras.ai](https://cloud.cerebras.ai) | `llama-3.3-70b` |
| Mistral | ✅ free tier | ✅ free key | [console.mistral.ai](https://console.mistral.ai) | `open-mistral-nemo`, `mistral-small-latest` |
| Pollinations | ✅ free | ❌ **no key** | nothing — public endpoint | `openai`, `mistral` |
| Mock | ✅ built-in | ❌ no key | nothing | `socks-mock` (test/last-resort) |
| *any OpenAI-compatible API* | your call | your key | `customProviders` in config.json | anything |

## ⚙️ Configuration

Copy `config.example.json` → `config.json` (it's gitignored, so keys are safe) and edit:

```jsonc
{
  "port": 20128,
  "host": "127.0.0.1",              // "0.0.0.0" to allow other devices on the LAN
  "apiKey": "",                     // set this if you expose the server! (or SOCKSROUTE_API_KEY env)
  "routing": {
    "strategy": "priority",         // "priority" | "round-robin"
    "order": ["groq", "gemini"],    // optional explicit provider priority
    "cooldownSeconds": { "429": 60, "5xx": 15, "401": 1800 }
  },
  "compression": {                  // context pruning (SocksRoute's "token saver")
    "enabled": true,
    "maxContextTokens": 32000,      // drop oldest messages above this
    "maxMessageChars": 60000        // truncate giant tool outputs at this
  },
  "providers": {
    "gemini": { "enabled": true, "apiKey": "AIza..." },   // key can go here…
    "groq":   { "enabled": true }                          // …or in GROQ_API_KEY env var
  },
  "customProviders": [{
    "id": "myapi", "name": "My API",
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "sk-...",
    "models": ["my-model"]
  }]
}
```

**Environment variables** (override config.json): `PORT`, `HOST`, `SOCKSROUTE_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `SOCKSROUTE_DATA_DIR`.

## 🔀 How routing works

1. **Pick candidates** — matching model, or all usable providers in priority order for `auto`.
2. **Try them in order** — skip any provider in cooldown.
3. **On failure, fall back** — 429 → 60s cooldown, 5xx → 15s, 401 (bad key) → 30min, network error → 5s.
4. **Last resort** — the built-in `mock` answers so you always get a readable response instead of a silent 503.
5. Every success/failure is recorded in `data/usage.json` and visible on the dashboard.

Every response includes `X-SocksRoute-Provider: <provider-id>` so you can see who actually answered.

## 🧪 Tests

```bash
npm test        # 9 offline smoke tests — no network, no keys needed
```

Covers health, model lists, mock chat, **auto-fallback**, OpenAI streaming, Anthropic non-stream + streaming, auth gating, and 404s.

## 🔒 Security checklist

- [ ] Change nothing → safe by default (binds to 127.0.0.1, no auth required)
- [ ] Exposing to LAN? Set `SOCKSROUTE_API_KEY` (env) or `apiKey` (config.json)
- [ ] Never port-forward / ngrok it without auth — it holds your provider API keys
- [ ] `config.json` and `data/` are gitignored — keep it that way
- [ ] Free-tier accounts are tied to your identity — respect provider ToS, don't scrape

## ❓ FAQ

**Where are my 1.6 billion tokens?** They were marketing math. SocksRoute gives you the same *architecture* (multi-provider routing + fallback + compression) so the free tiers you *do* have go as far as possible — without the ToS-abusing "blast through 90 providers" behavior.

**Is this OmniRoute?** No. Same category of tool, written from scratch: zero npm dependencies, no hardcoded secrets (no CVE-2026-49352 class of bug), no native builds (Termux-friendly), MIT licensed. OmniRoute/9router had real security issues — SocksRoute's answer is "no default secrets, ever".

**Does it work without any keys?** Yes — mock + Pollinations work out of the box.

**Will I get banned for using free tiers?** Only if you abuse them. A couple of providers at human speed is what free tiers are for.

**Can I add my paid providers?** Yes — `customProviders` in config.json accepts any OpenAI-compatible API.

---

MIT © SocksAi. Built for fun, from scratch, with 🧦.
