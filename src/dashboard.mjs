// SocksRoute — single-file dashboard (no build step, no frameworks).
import { VERSION } from './config.mjs';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function renderDashboard(status) {
  const prov = status.providers || [];
  const ready = prov.filter((p) => p.enabled && (p.hasKey)).length;
  const t = status.totals || {};

  const providerCards = prov
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
        disabled: 'b-off', cooling: 'b-cool', ready: 'b-ready',
        keyless: 'b-keyless', 'missing-key': 'b-miss',
      }[state];
      const models = (p.models || []).slice(0, 12).map((m) => `<code title="${esc(m)}">${esc(m)}</code>`).join('');
      const more = (p.models || []).length > 12 ? `<span class="more">+${p.models.length - 12}</span>` : '';
      return `
      <div class="card ${state}" data-provider="${esc(p.id)}">
        <div class="card-top">
          <h3>${esc(p.name)} ${p.custom ? '<span class="tag">custom</span>' : ''}</h3>
          <span class="badge ${badgeClass}">${badge}</span>
        </div>
        <div class="models">${models}${more}</div>
        <p class="note">${esc(p.note)}</p>
        <div class="stats">
          <span>⚡ ${p.requests} req</span>
          <span>⇪ ${fmt(p.tokensIn)}</span>
          <span>⇣ ${fmt(p.tokensOut)}</span>
          <span>✕ ${p.errors}</span>
          ${p.latencyAvg != null ? `<span>⏱ ${Math.round(p.latencyAvg)}ms</span>` : ''}
        </div>
        <div class="meta">key ${p.keyless ? 'not required' : p.hasKey ? '✓ set' : '✗ missing'} · used ${timeAgo(p.lastUsed)} · ${p.format === 'anthropic' ? 'Anthropic API' : 'OpenAI API'}</div>
        ${p.lastError ? `<p class="err">last error: ${esc(p.lastError.slice(0, 140))}</p>` : ''}
        <div class="actions">
          <button class="btn" data-act="test" data-id="${esc(p.id)}">🧪 Test</button>
          ${p.keyless && !p.custom ? '' : `<button class="btn" data-act="key" data-id="${esc(p.id)}">🔑 Key</button>`}
          <button class="btn" data-act="toggle" data-id="${esc(p.id)}">${p.enabled ? '⏸ Disable' : '▶ Enable'}</button>
          ${p.custom ? `<button class="btn danger" data-act="edit" data-id="${esc(p.id)}">✏️</button><button class="btn danger" data-act="del" data-id="${esc(p.id)}">🗑</button>` : ''}
        </div>
        <div class="test-result" id="test-${esc(p.id)}"></div>
      </div>`;
    })
    .join('\n');

  const modelOptions = prov
    .filter((p) => p.enabled && p.hasKey)
    .map((p) => `
      <optgroup label="${esc(p.name)}">
        ${(p.models || []).map((m) => `<option value="${esc(p.id)}:${esc(m)}">${esc(m)}</option>`).join('')}
      </optgroup>`)
    .join('\n');

  const strategyOpts = ['priority', 'round-robin', 'latency']
    .map((s) => `<option value="${s}" ${(status.routing?.strategy || 'priority') === s ? 'selected' : ''}>${s}</option>`)
    .join('');

  const orderItems = (status.routing?.order && status.routing.order.length
    ? status.routing.order
    : prov.map((p) => p.id)
  ).map((id, i, arr) => `
    <div class="order-item" data-id="${esc(id)}">
      <span class="order-name">${esc(prov.find((p) => p.id === id)?.name || id)}</span>
      <span class="order-btns">
        <button class="mini" data-order="up" data-id="${esc(id)}" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="mini" data-order="down" data-id="${esc(id)}" ${i === arr.length - 1 ? 'disabled' : ''}>▼</button>
      </span>
    </div>`).join('');

  const logRows = (status.logs || []).slice().reverse()
    .map((l) => `<div class="log-row ${esc(l.level)}"><span class="log-ts">${new Date(l.ts).toLocaleTimeString()}</span><span>${esc(l.msg)}</span></div>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🧦 SocksRoute</title>
<style>
  :root { --bg:#0f1117; --card:#171a22; --card2:#1d2230; --line:#262b38; --text:#e6e9f0; --dim:#8b93a7; --accent:#ff6b9d; --green:#4ade80; --red:#f87171; --yellow:#fbbf24; --blue:#7dd3fc; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; }
  header { padding:22px 20px 4px; max-width:1180px; margin:0 auto; display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:12px; }
  h1 { margin:0; font-size:24px; } h1 .ver { color:var(--dim); font-size:12px; font-weight:normal; }
  .sub { color:var(--dim); font-size:12px; margin-top:4px; }
  .chips { display:flex; gap:8px; flex-wrap:wrap; }
  .chip { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:5px 10px; font-size:11px; color:var(--dim); }
  .chip b { color:var(--text); }
  main { max-width:1180px; margin:0 auto; padding:14px 20px 70px; }
  section { margin-top:22px; }
  h2 { font-size:14px; border-bottom:1px solid var(--line); padding-bottom:7px; margin:0 0 10px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 14px; display:flex; flex-direction:column; gap:7px; }
  .card.missing-key { border-color:#4a2432; } .card.disabled { opacity:.55; }
  .card-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  h3 { margin:0; font-size:14px; } .tag { font-size:9px; background:#3b1252; color:#e9b8ff; border-radius:99px; padding:2px 6px; vertical-align:2px; }
  .badge { font-size:9.5px; letter-spacing:.06em; padding:3px 8px; border-radius:99px; white-space:nowrap; }
  .b-ready{ background:#123524; color:var(--green);} .b-keyless{ background:#0f2f4a; color:var(--blue);}
  .b-miss{ background:#3a1220; color:var(--red);} .b-cool{ background:#3a2f10; color:var(--yellow);}
  .b-off{ background:#232733; color:var(--dim);}
  .models { display:flex; flex-wrap:wrap; gap:5px; }
  .models code { background:#0b0d13; border:1px solid var(--line); border-radius:6px; padding:2px 6px; font-size:10.5px; color:#c9d2e3; }
  .more { color:var(--dim); font-size:10px; align-self:center; }
  .note { color:var(--dim); font-size:11px; line-height:1.4; margin:0; }
  .stats { display:flex; gap:10px; font-size:10.5px; color:var(--dim); flex-wrap:wrap; }
  .meta { color:var(--dim); font-size:10px; }
  .err { color:var(--red); font-size:10.5px; margin:0; word-break:break-word; }
  .actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:2px; }
  .btn { background:var(--card2); border:1px solid var(--line); color:var(--text); border-radius:8px; padding:5px 10px; font-size:11px; cursor:pointer; font-family:inherit; }
  .btn:hover { border-color:var(--accent); }
  .btn.danger:hover { border-color:var(--red); color:var(--red); }
  .btn.primary { background:#2a1b2e; border-color:#5a2a45; color:#ffc4da; }
  .btn:disabled { opacity:.4; cursor:not-allowed; }
  .test-result { font-size:10.5px; color:var(--dim); word-break:break-word; }
  .test-result.ok { color:var(--green); } .test-result.fail { color:var(--red); }
  .box { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .box code, .box pre { background:#0b0d13; border-radius:6px; padding:1px 5px; color:var(--blue); }
  pre { padding:10px 12px; overflow-x:auto; font-size:11.5px; line-height:1.5; }
  .playground { display:flex; flex-direction:column; gap:8px; }
  .pg-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  textarea { width:100%; background:#0b0d13; color:var(--text); border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-family:inherit; font-size:12.5px; resize:vertical; min-height:64px; }
  textarea:focus, select:focus { outline:1px solid var(--accent); }
  select { background:var(--card2); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:6px 8px; font-family:inherit; font-size:11.5px; max-width:100%; }
  #pg-out { background:#0b0d13; border:1px solid var(--line); border-radius:10px; padding:12px; min-height:90px; white-space:pre-wrap; font-size:12.5px; line-height:1.55; }
  #pg-out .dim { color:var(--dim); }
  .pg-provider { font-size:10.5px; color:var(--blue); }
  .row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  @media (max-width: 900px) { .row2 { grid-template-columns:1fr; } }
  .order-item { display:flex; justify-content:space-between; align-items:center; background:#0b0d13; border:1px solid var(--line); border-radius:8px; padding:6px 10px; margin-bottom:6px; }
  .order-name { font-size:12px; }
  .mini { background:var(--card2); border:1px solid var(--line); color:var(--text); border-radius:6px; padding:2px 8px; cursor:pointer; font-size:10px; }
  .mini:disabled { opacity:.3; cursor:not-allowed; }
  .logs { background:#0b0d13; border:1px solid var(--line); border-radius:10px; padding:10px 12px; max-height:260px; overflow-y:auto; }
  .log-row { display:flex; gap:10px; font-size:11px; padding:2px 0; color:var(--dim); }
  .log-row.warn { color:var(--yellow); } .log-row.info { color:var(--dim); } .log-row.error { color:var(--red); }
  .log-ts { color:#4b5266; flex-shrink:0; }
  .modal-back { position:fixed; inset:0; background:rgba(0,0,0,.6); display:none; align-items:center; justify-content:center; z-index:50; }
  .modal-back.open { display:flex; }
  .modal { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; width:min(480px, 92vw); max-height:88vh; overflow-y:auto; }
  .modal h3 { margin:0 0 12px; }
  .modal label { display:block; font-size:11px; color:var(--dim); margin:10px 0 4px; }
  .modal input { width:100%; background:#0b0d13; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-family:inherit; font-size:12.5px; }
  .modal .m-actions { display:flex; gap:8px; margin-top:16px; justify-content:flex-end; }
  .toast { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); background:#2a1b2e; border:1px solid #5a2a45; color:#ffc4da; padding:10px 18px; border-radius:99px; font-size:12px; display:none; z-index:60; }
  footer { color:var(--dim); font-size:10.5px; text-align:center; padding:24px 0 40px; }
  .warn-box { border-left:3px solid var(--yellow); margin-top:10px; }
  .ok-box { border-left:3px solid var(--green); margin-top:10px; }
  .spinner { display:inline-block; width:11px; height:11px; border:2px solid var(--dim); border-top-color:var(--accent); border-radius:50%; animation:spin .7s linear infinite; vertical-align:-1px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .link { color:var(--blue); text-decoration:none; } .link:hover { text-decoration:underline; }
</style>
</head>
<body>
<header>
  <div>
    <h1>🧦 SocksRoute <span class="ver">v${esc(VERSION)}</span></h1>
    <p class="sub">One endpoint · every provider · automatic fallback — <span id="host-line">http://${esc(status.host)}:${esc(status.port)}</span></p>
  </div>
  <div class="chips">
    <span class="chip">✅ <b>${ready}</b>/${prov.length} providers ready</span>
    <span class="chip">⚡ <b id="chip-req">${fmt(t.requests)}</b> requests</span>
    <span class="chip">⇪ <b id="chip-in">${fmt(t.tokensIn)}</b> tokens in</span>
    <span class="chip">⇣ <b id="chip-out">${fmt(t.tokensOut)}</b> tokens out</span>
    <span class="chip">✕ <b id="chip-err">${t.errors}</b> errors</span>
    <span class="chip">⏱ <b id="chip-up">${Math.round(status.uptimeSeconds / 60)}m</b> uptime</span>
    <span class="chip">${status.authEnabled ? '🔒 auth on' : '🔓 auth off'}</span>
    <button class="btn" id="btn-refresh">🔄 Refresh</button>
  </div>
</header>
<main>
  <section>
    <h2>🧩 Providers <button class="btn" id="btn-add-provider" style="float:right">➕ Add custom provider</button></h2>
    <div class="grid" id="grid">${providerCards}</div>
  </section>

  <section>
    <h2>💬 Chat playground</h2>
    <div class="box playground">
      <div class="pg-row">
        <select id="pg-model" style="flex:1;min-width:220px">${modelOptions || '<option value="">— add a provider key first —</option>'}</select>
        <button class="btn primary" id="btn-send">▶ Send</button>
        <button class="btn" id="btn-clear">Clear</button>
        <label style="color:var(--dim);font-size:11px"><input type="checkbox" id="pg-stream" checked> stream</label>
      </div>
      <textarea id="pg-input" placeholder="Ask anything… (streaming, shows which provider answers)"></textarea>
      <div id="pg-out"><span class="dim">Response will appear here.</span></div>
      <div class="pg-provider" id="pg-provider"></div>
    </div>
  </section>

  <section>
    <h2>🎛️ Routing</h2>
    <div class="row2">
      <div class="box">
        <label style="color:var(--dim);font-size:11px">Strategy</label>
        <select id="strategy" style="width:100%;margin-top:6px">${strategyOpts}</select>
        <p style="color:var(--dim);font-size:11px;line-height:1.5;margin:8px 0 0">
          <b>priority</b> — try in order below · <b>round-robin</b> — rotate · <b>latency</b> — fastest recent provider first.
        </p>
      </div>
      <div class="box">
        <label style="color:var(--dim);font-size:11px">Priority order (priority strategy)</label>
        <div id="order-list" style="margin-top:8px">${orderItems}</div>
      </div>
    </div>
  </section>

  <section>
    <h2>📜 Event log</h2>
    <div class="logs" id="logs">${logRows || '<div class="log-row"><span class="dim">No events yet.</span></div>'}</div>
  </section>

  <section>
    <h2>⚠️ Honest notes</h2>
    <div class="box warn-box">
      <p style="margin:0;line-height:1.6"><b>There is no infinite token faucet.</b> Free tiers are real but rate-limited, and hammering them gets your free accounts banned. Keys you save here are stored in <code>data/keys.json</code> (plaintext by default — set <code>SOCKSROUTE_STORAGE_KEY</code> to encrypt them at rest). Never expose an unauthenticated gateway to the internet: set <code>SOCKSROUTE_API_KEY</code> first. See README for the full security checklist.</p>
    </div>
  </section>
</main>
<footer>🧦 SocksRoute v${esc(VERSION)} · from scratch · zero dependencies · MIT</footer>

<div class="modal-back" id="modal-back">
  <div class="modal" id="modal"></div>
</div>
<div class="toast" id="toast"></div>

<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let state = { status: null, config: null, logs: [] };
  let authKey = localStorage.getItem('socksroute_key') || '';

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = 'none'), 2600);
  }

  async function api(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (authKey) headers.authorization = 'Bearer ' + authKey;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) {
      const key = prompt('🔒 SocksRoute requires the API key (SOCKSROUTE_API_KEY):');
      if (key) { authKey = key; localStorage.setItem('socksroute_key', key); return api(method, path, body); }
      throw new Error('Unauthorized');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok && json.error?.message) throw new Error(json.error.message);
    return json;
  }

  async function refresh() {
    try {
      const [status, config, logs] = await Promise.all([
        api('GET', '/api/status'),
        api('GET', '/api/config'),
        api('GET', '/api/logs'),
      ]);
      state = { status, config, logs };
      renderAll();
    } catch (e) {
      toast('⚠️ ' + e.message);
    }
  }

  function renderAll() {
    const { status, config, logs } = state;
    if (!status) return;
    document.getElementById('chip-req').textContent = fmt(status.totals.requests);
    document.getElementById('chip-in').textContent = fmt(status.totals.tokensIn);
    document.getElementById('chip-out').textContent = fmt(status.totals.tokensOut);
    document.getElementById('chip-err').textContent = status.totals.errors;
    document.getElementById('chip-up').textContent = Math.round(status.uptimeSeconds / 60) + 'm';
    const ready = status.providers.filter((p) => p.enabled && p.hasKey).length;
    document.querySelectorAll('header .chips .chip')[0].innerHTML = '<b>' + ready + '</b>/' + status.providers.length + ' providers ready';
    document.getElementById('strategy').value = status.routing?.strategy || 'priority';
    updateCards();
  }

  const timeAgo = (ts) => {
    if (!ts) return 'never';
    const s = Math.floor((Date.now() - ts) / 1000);
    return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago';
  };

  function updateCards() {
    (state.status.providers || []).forEach((p) => {
      const card = document.querySelector('.card[data-provider="' + p.id + '"]');
      if (!card) return;
      const st = !p.enabled ? 'disabled' : p.cooldownSeconds > 0 ? 'cooling' : p.hasKey ? 'ready' : p.keyless ? 'keyless' : 'missing-key';
      card.className = 'card ' + st;
      const badge = card.querySelector('.badge');
      badge.textContent = ({ disabled: 'OFF', cooling: 'COOLDOWN ' + p.cooldownSeconds + 's', ready: 'KEY READY', keyless: 'NO KEY NEEDED', 'missing-key': 'ADD KEY' })[st];
      badge.className = 'badge ' + ({ disabled: 'b-off', cooling: 'b-cool', ready: 'b-ready', keyless: 'b-keyless', 'missing-key': 'b-miss' })[st];
      card.querySelector('.stats').innerHTML =
        '<span>⚡ ' + p.requests + ' req</span><span>⇪ ' + fmt(p.tokensIn) + '</span><span>⇣ ' + fmt(p.tokensOut) + '</span><span>✕ ' + p.errors + '</span>' +
        (p.latencyAvg != null ? '<span>⏱ ' + Math.round(p.latencyAvg) + 'ms</span>' : '');
      card.querySelector('.meta').innerHTML = 'key ' + (p.keyless ? 'not required' : p.hasKey ? '✓ set' : '✗ missing') + ' · used ' + timeAgo(p.lastUsed) + ' · ' + (p.format === 'anthropic' ? 'Anthropic API' : 'OpenAI API');
      card.querySelector('[data-act="toggle"]').textContent = p.enabled ? '⏸ Disable' : '▶ Enable';
      let err = card.querySelector('.err');
      if (p.lastError) {
        if (!err) { err = document.createElement('p'); err.className = 'err'; card.appendChild(err); }
        err.textContent = 'last error: ' + String(p.lastError).slice(0, 140);
      } else if (err) err.remove();
    });
  }

  const fmt = (n) => n == null ? '—' : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'k' : String(n);

  // ---------- provider actions ----------
  document.getElementById('grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;

    if (act === 'toggle') {
      const p = state.status.providers.find((x) => x.id === id);
      try {
        await api('PUT', '/api/providers/' + encodeURIComponent(id) + '/enabled', { enabled: !p.enabled });
        toast(p.enabled ? '⏸ Disabled ' + id : '▶ Enabled ' + id);
        await refresh();
      } catch (e) { toast('⚠️ ' + e.message); }
    }

    if (act === 'test') {
      const out = document.getElementById('test-' + id);
      out.innerHTML = '<span class="spinner"></span> testing…';
      try {
        const r = await api('POST', '/api/test', { providerId: id });
        if (r.ok) out.innerHTML = '<span class="ok">✓ ' + esc(r.model) + ' in ' + r.latencyMs + 'ms — "' + esc(r.snippet) + '"</span>';
        else out.innerHTML = '<span class="fail">✗ ' + esc(r.error || 'failed') + '</span>';
      } catch (e) { out.innerHTML = '<span class="fail">✗ ' + esc(e.message) + '</span>'; }
    }

    if (act === 'key') keyModal(id);
    if (act === 'edit') customModal(id);
    if (act === 'del') {
      if (!confirm('Delete custom provider ' + id + '?')) return;
      try { await api('DELETE', '/api/providers/' + encodeURIComponent(id)); toast('🗑 Deleted'); await refresh(); } catch (e) { toast('⚠️ ' + e.message); }
    }
  });

  function openModal(html) {
    $('#modal').innerHTML = html;
    $('#modal-back').classList.add('open');
  }
  function closeModal() { $('#modal-back').classList.remove('open'); }
  $('#modal-back').addEventListener('click', (e) => { if (e.target === $('#modal-back')) closeModal(); });

  function keyModal(id) {
    const p = state.status.providers.find((x) => x.id === id);
    openModal(\`
      <h3>🔑 API key — \${esc(p.name)}</h3>
      <p style="color:var(--dim);font-size:11px;margin:0">Saved to data/keys.json (gitignored). The dashboard never shows it back to you.</p>
      <label>New key (paste full key, or leave blank to keep)</label>
      <input type="password" id="key-input" placeholder="sk-… / AIza…" autocomplete="off">
      <div class="m-actions">
        <button class="btn" onclick="(()=>{document.querySelector('#modal-back').classList.remove('open')})()">Cancel</button>
        <button class="btn danger" id="btn-key-del" style="margin-right:auto">Remove key</button>
        <button class="btn primary" id="btn-key-save">Save key</button>
      </div>\`);
    document.getElementById('btn-key-save').onclick = async () => {
      const v = document.getElementById('key-input').value.trim();
      try { await api('PUT', '/api/providers/' + encodeURIComponent(id) + '/key', { key: v }); closeModal(); toast('🔑 Key saved'); await refresh(); } catch (e) { toast('⚠️ ' + e.message); }
    };
    document.getElementById('btn-key-del').onclick = async () => {
      try { await api('DELETE', '/api/providers/' + encodeURIComponent(id) + '/key'); closeModal(); toast('🔑 Key removed'); await refresh(); } catch (e) { toast('⚠️ ' + e.message); }
    };
  }

  function customModal(id) {
    const existing = id ? state.config.customProviders.find((p) => p.id === id) : null;
    openModal(\`
      <h3>\${existing ? '✏️ Edit custom provider' : '➕ Add custom provider'}</h3>
      <label>ID (a-z, 0-9, - _)</label>
      <input id="cp-id" value="\${esc(existing?.id || '')}" \${existing ? 'disabled' : ''} placeholder="myprovider">
      <label>Name</label>
      <input id="cp-name" value="\${esc(existing?.name || '')}" placeholder="My Provider">
      <label>Base URL (OpenAI-compatible, e.g. https://api.example.com/v1)</label>
      <input id="cp-url" value="\${esc(existing?.baseUrl || '')}" placeholder="https://…/v1">
      <label>API key (optional)</label>
      <input id="cp-key" type="password" value="\${esc(existing?.apiKey || '')}" placeholder="sk-…">
      <label>Models (comma-separated)</label>
      <input id="cp-models" value="\${esc((existing?.models || []).join(', '))}" placeholder="model-a, model-b">
      <label>Note (optional)</label>
      <input id="cp-note" value="\${esc(existing?.note || '')}" placeholder="What is this?">
      <div class="m-actions">
        <button class="btn" id="btn-cp-cancel">Cancel</button>
        <button class="btn primary" id="btn-cp-save">\${existing ? 'Save changes' : 'Add provider'}</button>
      </div>\`);
    document.getElementById('btn-cp-cancel').onclick = closeModal;
    document.getElementById('btn-cp-save').onclick = async () => {
      const body = {
        id: (document.getElementById('cp-id').value || '').trim().toLowerCase(),
        name: document.getElementById('cp-name').value.trim(),
        baseUrl: document.getElementById('cp-url').value.trim(),
        apiKey: document.getElementById('cp-key').value.trim(),
        models: document.getElementById('cp-models').value.split(',').map((s) => s.trim()).filter(Boolean),
        note: document.getElementById('cp-note').value.trim(),
      };
      try {
        if (existing) await api('PUT', '/api/providers/' + encodeURIComponent(id), body);
        else await api('POST', '/api/providers', body);
        closeModal(); toast('✅ Saved'); await refresh();
      } catch (e) { toast('⚠️ ' + e.message); }
    };
  }

  // ---------- routing ----------
  document.getElementById('strategy').addEventListener('change', async (e) => {
    try { await api('PUT', '/api/routing', { strategy: e.target.value }); toast('🎛️ Strategy → ' + e.target.value); } catch (err) { toast('⚠️ ' + err.message); }
  });
  document.getElementById('order-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-order]');
    if (!b) return;
    const id = b.dataset.id;
    const items = [...document.querySelectorAll('#order-list .order-item')].map((el) => el.dataset.id);
    const i = items.indexOf(id);
    const j = b.dataset.order === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    try { await api('PUT', '/api/routing', { order: items }); toast('🎛️ Order saved'); await refresh(); } catch (err) { toast('⚠️ ' + err.message); }
  });

  // ---------- playground ----------
  document.getElementById('btn-add-provider').onclick = () => customModal(null);
  document.getElementById('btn-clear').onclick = () => { $('#pg-out').innerHTML = ''; $('#pg-provider').textContent = ''; };
  document.getElementById('btn-send').onclick = sendPlayground;

  async function sendPlayground() {
    const model = $('#pg-model').value;
    const content = $('#pg-input').value.trim();
    const stream = $('#pg-stream').checked;
    if (!model) return toast('⚠️ Pick a model first (add a provider key)');
    if (!content) return toast('⚠️ Type a message first');
    const out = $('#pg-out');
    out.innerHTML = '<span class="dim">thinking…</span>';
    $('#pg-provider').textContent = '';
    try {
      const headers = { 'content-type': 'application/json' };
      if (authKey) headers.authorization = 'Bearer ' + authKey;
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content }], stream }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error?.message || 'HTTP ' + res.status);
      }
      $('#pg-provider').textContent = 'answering via: ' + (res.headers.get('X-SocksRoute-Provider') || '?');
      if (!stream) {
        const j = await res.json();
        out.textContent = j.choices?.[0]?.message?.content || '(empty)';
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', text = '';
      out.textContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\\n')) !== -1) {
          const line = buf.slice(0, idx).replace(/\\r$/, ''); buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const ev = JSON.parse(data);
            const delta = ev.choices?.[0]?.delta?.content;
            if (delta) { text += delta; out.textContent = text; }
          } catch { /* skip */ }
        }
      }
      if (!text) out.innerHTML = '<span class="dim">(no text — check the event log)</span>';
    } catch (e) {
      out.innerHTML = '<span class="fail" style="color:var(--red)">✗ ' + esc(e.message) + '</span>';
    }
  }

  $('#pg-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendPlayground();
  });

  // ---------- logs + refresh ----------
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      api('GET', '/api/logs').then((l) => { state.logs = l; renderLogs(); }).catch(() => {});
    }
  }, 5000);

  function renderLogs() {
    const rows = (state.logs.logs || []).slice().reverse()
      .map((l) => '<div class="log-row ' + esc(l.level) + '"><span class="log-ts">' + new Date(l.ts).toLocaleTimeString() + '</span><span>' + esc(l.msg) + '</span></div>')
      .join('');
    $('#logs').innerHTML = rows || '<div class="log-row"><span class="dim">No events yet.</span></div>';
  }
  document.getElementById('btn-refresh').onclick = refresh;
  refresh();
})();
</script>
</body>
</html>`;
}
