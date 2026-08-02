// SocksRoute — single-file dashboard (no build step, no frameworks).
import { VERSION } from './config.mjs';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function renderDashboard(status) {
  const providerCards = (status.providers || [])
    .map((p) => {
      const state = !p.enabled
        ? 'disabled'
        : p.cooldownSeconds > 0
          ? 'cooling'
          : p.hasKey
            ? 'ready'
            : p.keyless
              ? 'keyless'
              : 'missing-key';
      const badge = {
        disabled: 'OFF',
        cooling: `COOLDOWN ${p.cooldownSeconds}s`,
        ready: 'KEY READY',
        keyless: 'NO KEY NEEDED',
        'missing-key': 'ADD KEY',
      }[state];
      const badgeClass = {
        disabled: 'b-off',
        cooling: 'b-cool',
        ready: 'b-ready',
        keyless: 'b-keyless',
        'missing-key': 'b-miss',
      }[state];
      return `
      <div class="card ${state}">
        <div class="card-top">
          <h3>${esc(p.name)}</h3>
          <span class="badge ${badgeClass}">${badge}</span>
        </div>
        <div class="models">${(p.models || []).map((m) => `<code>${esc(m)}</code>`).join('')}</div>
        <p class="note">${esc(p.note)}</p>
        <div class="stats">
          <span>⚡ ${p.requests} req</span>
          <span>⇪ ${(p.tokensIn / 1000).toFixed(1)}k in</span>
          <span>⇣ ${(p.tokensOut / 1000).toFixed(1)}k out</span>
          <span>✕ ${p.errors} errors</span>
        </div>
        ${p.lastError ? `<p class="err">last error: ${esc(p.lastError.slice(0, 160))}</p>` : ''}
      </div>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🧦 SocksRoute</title>
<style>
  :root { --bg:#0f1117; --card:#171a22; --line:#262b38; --text:#e6e9f0; --dim:#8b93a7; --accent:#ff6b9d; --green:#4ade80; --red:#f87171; --yellow:#fbbf24; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  header { padding:28px 20px 8px; max-width:1060px; margin:0 auto; }
  h1 { margin:0; font-size:26px; } h1 .ver { color:var(--dim); font-size:13px; font-weight:normal; }
  .sub { color:var(--dim); font-size:13px; margin-top:6px; }
  main { max-width:1060px; margin:0 auto; padding:12px 20px 60px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card.missing-key { border-color:#3b2c3f; }
  .card-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  h3 { margin:0; font-size:15px; }
  .badge { font-size:10px; letter-spacing:.08em; padding:3px 8px; border-radius:99px; white-space:nowrap; }
  .b-ready{ background:#123524; color:var(--green);} .b-keyless{ background:#0f2f4a; color:#7dd3fc;}
  .b-miss{ background:#3a1220; color:var(--red);} .b-cool{ background:#3a2f10; color:var(--yellow);}
  .b-off{ background:#232733; color:var(--dim);}
  .models { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 8px; }
  .models code { background:#0b0d13; border:1px solid var(--line); border-radius:6px; padding:2px 7px; font-size:11px; color:#c9d2e3; }
  .note { color:var(--dim); font-size:11.5px; line-height:1.45; margin:0 0 10px; }
  .stats { display:flex; gap:12px; font-size:11px; color:var(--dim); flex-wrap:wrap; }
  .err { color:var(--red); font-size:11px; margin:8px 0 0; word-break:break-word; }
  section { margin-top:28px; }
  h2 { font-size:15px; border-bottom:1px solid var(--line); padding-bottom:8px; }
  .box { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-top:12px; font-size:13px; line-height:1.6; }
  .box code, .box pre { background:#0b0d13; border-radius:6px; padding:1px 5px; color:#7dd3fc; }
  pre { padding:10px 12px; overflow-x:auto; font-size:12px; }
  .warn { border-left:3px solid var(--yellow); }
  .ok { border-left:3px solid var(--green); }
  .dim { color:var(--dim); }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  footer { color:var(--dim); font-size:11px; text-align:center; padding:30px 0; }
</style>
</head>
<body>
<header>
  <h1>🧦 SocksRoute <span class="ver">v${esc(VERSION)}</span></h1>
  <p class="sub">Your own AI router — one endpoint, many free providers, automatic fallback. Listens on <code>http://${esc(status.host)}:${esc(status.port)}</code>${status.authEnabled ? ' · 🔒 API key required' : ''}</p>
</header>
<main>
  <section>
    <div class="grid" id="cards">${providerCards}</div>
  </section>

  <section>
    <h2>⚡ Try it right now</h2>
    <div class="box ok">
      <pre>curl http://localhost:${esc(status.port)}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"socks-mock","messages":[{"role":"user","content":"hello socks"}]}'</pre>
      <p class="dim">Pick any model from the cards above. Prefix <code>provider:model</code> to force one, e.g. <code>groq:llama-3.3-70b-versatile</code>. If a provider fails or rate-limits you, SocksRoute automatically tries the next one.</p>
    </div>
  </section>

  <section>
    <h2>🔌 Endpoints</h2>
    <div class="box">
      <div><code>POST /v1/chat/completions</code> — OpenAI format (works with Cursor, Cline, OpenCode, aider…)</div>
      <div style="margin-top:6px"><code>POST /anthropic/v1/messages</code> — Anthropic format (works with Claude Code)</div>
      <div style="margin-top:6px"><code>GET /v1/models</code> · <code>GET /anthropic/v1/models</code> — model lists</div>
      <div style="margin-top:6px"><code>GET /api/status</code> — this dashboard's JSON</div>
    </div>
  </section>

  <section>
    <h2>🔑 Add providers</h2>
    <div class="box">
      Copy <code>config.example.json</code> → <code>config.json</code> and paste your free API keys, or export them as env vars:
      <pre>export GEMINI_API_KEY=...    # aistudio.google.com (free)
export GROQ_API_KEY=...      # console.groq.com (free)
export OPENROUTER_API_KEY=... # openrouter.ai/keys (free)</pre>
      <p class="dim">Config.json is gitignored — your keys never get committed. See README for the full list.</p>
    </div>
  </section>

  <section>
    <h2>⚠️ Honest notes</h2>
    <div class="box warn">
      <p><b>There is no infinite token faucet.</b> Free tiers are real but rate-limited per provider, and hammering them can get your free accounts banned. Use a few providers politely, and never expose an unauthenticated gateway to the internet — set <code>SOCKSROUTE_API_KEY</code> first.</p>
    </div>
  </section>
</main>
<footer>🧦 SocksRoute v${esc(VERSION)} · built from scratch, zero dependencies · <span id="uptime"></span></footer>
<script>
async function refresh() {
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    document.getElementById('uptime').textContent = 'uptime ' + Math.round(s.uptimeSeconds / 60) + ' min';
    const cards = document.getElementById('cards');
    const prov = new Map((s.providers || []).map(p => [p.id, p]));
    document.querySelectorAll('.card').forEach(card => { /* live-update cooldowns only */ });
  } catch {}
}
setInterval(refresh, 5000); refresh();
</script>
</body>
</html>`;
}
