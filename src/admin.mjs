// SocksRoute — admin API used by the dashboard.
// All routes live under /api/* (auth-gated when SOCKSROUTE_API_KEY is set).
import { readBody, sendJson } from './http-utils.mjs';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

function maskKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '••••••••';
  return `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

/** Runtime view of the config, with secrets masked. */
export function maskedConfig(config) {
  const providers = {};
  for (const [id, p] of Object.entries(config.providers || {})) {
    providers[id] = { ...p, apiKey: p.apiKey ? maskKey(p.apiKey) : '' };
  }
  return {
    port: config.port,
    host: config.host,
    apiKeySet: !!config.apiKey,
    storageEncrypted: !!config.storageKey,
    routing: config.routing || {},
    compression: config.compression || {},
    providers,
    customProviders: (config.customProviders || []).map((p) => ({ ...p, apiKey: p.apiKey ? maskKey(p.apiKey) : '' })),
  };
}

/**
 * Handle an admin request. Returns true if the path was an /api route.
 * ctx: { baseConfig, settings, usage, router, refreshRuntime, dataDir }
 */
export async function handleAdmin(req, res, url, ctx) {
  const path = url.pathname;
  const method = (req.method || 'GET').toUpperCase();
  const { settings, usage, router, refreshRuntime } = ctx;
  const m = (re) => path.match(re);

  const json = async () => {
    try { return JSON.parse((await readBody(req, 5 * 1024 * 1024)) || '{}'); }
    catch { return null; }
  };

  // ---------- GET /api/status ----------
  if (method === 'GET' && path === '/api/status') {
    sendJson(res, 200, usage.status(router));
    return true;
  }

  // ---------- GET /api/catalog (model browser data) ----------
  if (method === 'GET' && path === '/api/catalog') {
    const { loadModelCatalog } = await import('./providers.mjs');
    const models = loadModelCatalog();
    const defs = router.defs.map((d) => ({
      id: d.id,
      name: d.name,
      free: !!d.free || !!d.keyless,
      keyless: !!d.keyless,
      hasKey: router.usable(d),
      enabled: router.isEnabled(d),
      format: d.format || 'openai',
      home: d.home || '',
      note: d.note || '',
      models: d.models || [],
      discovered: d.discovered || [],
    }));
    sendJson(res, 200, {
      stats: router.catalogStats(),
      models: models.map((m) => ({ id: m.id, name: m.name, context: m.context, free: m.free, provider: m.provider })),
      providers: defs,
      synced: models.length > 0,
    });
    return true;
  }

  // ---------- GET /api/config ----------
  if (method === 'GET' && path === '/api/config') {
    sendJson(res, 200, maskedConfig(router.config));
    return true;
  }

  // ---------- GET /api/logs ----------
  if (method === 'GET' && path === '/api/logs') {
    sendJson(res, 200, { logs: usage.logs.slice(-100) });
    return true;
  }

  // ---------- POST /api/refresh (re-discover models) ----------
  if (method === 'POST' && path === '/api/refresh') {
    await router.refreshModels();
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ---------- PUT /api/providers/:id/key ----------
  let mm = m(/^\/api\/providers\/([^/]+)\/key$/);
  if (mm && method === 'PUT') {
    const id = decodeURIComponent(mm[1]);
    const body = await json();
    if (!body || typeof body.key !== 'string') {
      sendJson(res, 400, { error: { message: 'Send {"key": "..."}', type: 'invalid_request_error' } });
      return true;
    }
    if (body.key) settings.setKey(id, body.key.trim());
    else settings.deleteKey(id);
    refreshRuntime();
    usage.log('info', `🔑 API key ${body.key ? 'saved for' : 'removed from'} provider "${id}"`);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (mm && method === 'DELETE') {
    const id = decodeURIComponent(mm[1]);
    settings.deleteKey(id);
    refreshRuntime();
    usage.log('info', `🔑 API key removed from provider "${id}"`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ---------- PUT /api/providers/:id/enabled ----------
  mm = m(/^\/api\/providers\/([^/]+)\/enabled$/);
  if (mm && method === 'PUT') {
    const id = decodeURIComponent(mm[1]);
    const body = await json();
    if (!body || typeof body.enabled !== 'boolean') {
      sendJson(res, 400, { error: { message: 'Send {"enabled": true|false}', type: 'invalid_request_error' } });
      return true;
    }
    settings.setProviderEnabled(id, body.enabled);
    refreshRuntime();
    usage.log('info', `${body.enabled ? '✅ Enabled' : '⏸️ Disabled'} provider "${id}"`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ---------- custom providers CRUD ----------
  if (path === '/api/providers' && method === 'POST') {
    const body = await json();
    if (!body || !ID_RE.test(body.id || '') || !/^https?:\/\//.test(body.baseUrl || '')) {
      sendJson(res, 400, { error: { message: 'Need a valid "id" (a-z0-9_-) and "baseUrl" (http(s)://…).', type: 'invalid_request_error' } });
      return true;
    }
    if (router.defs.some((d) => d.id === body.id)) {
      sendJson(res, 409, { error: { message: `Provider "${body.id}" already exists.`, type: 'conflict' } });
      return true;
    }
    const list = [...(settings.getSettings().customProviders || [])];
    list.push({
      id: body.id,
      name: body.name || body.id,
      baseUrl: body.baseUrl.replace(/\/+$/, ''),
      apiKey: body.apiKey || '',
      models: Array.isArray(body.models) ? body.models.map(String) : String(body.models || '').split(',').map((s) => s.trim()).filter(Boolean),
      free: !!body.free,
      note: body.note || 'Custom provider.',
    });
    settings.setCustomProviders(list);
    refreshRuntime();
    usage.log('info', `➕ Added custom provider "${body.id}"`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  mm = m(/^\/api\/providers\/([^/]+)$/);
  if (mm && method === 'PUT') {
    const id = decodeURIComponent(mm[1]);
    const list = [...(settings.getSettings().customProviders || [])];
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) {
      sendJson(res, 404, { error: { message: `No custom provider "${id}".`, type: 'not_found' } });
      return true;
    }
    const body = await json();
    const updated = { ...list[idx], ...(body || {}) };
    updated.id = id;
    updated.baseUrl = String(updated.baseUrl || '').replace(/\/+$/, '');
    updated.models = Array.isArray(updated.models) ? updated.models : String(updated.models || '').split(',').map((s) => s.trim()).filter(Boolean);
    list[idx] = updated;
    settings.setCustomProviders(list);
    refreshRuntime();
    usage.log('info', `✏️ Updated custom provider "${id}"`);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (mm && method === 'DELETE') {
    const id = decodeURIComponent(mm[1]);
    const list = (settings.getSettings().customProviders || []).filter((p) => p.id !== id);
    settings.setCustomProviders(list);
    refreshRuntime();
    usage.log('info', `🗑️ Removed custom provider "${id}"`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  // ---------- PUT /api/routing ----------
  if (path === '/api/routing' && method === 'PUT') {
    const body = await json();
    const patch = {};
    if (body?.strategy !== undefined) {
      if (!['priority', 'round-robin', 'latency'].includes(body.strategy)) {
        sendJson(res, 400, { error: { message: 'strategy must be priority | round-robin | latency', type: 'invalid_request_error' } });
        return true;
      }
      patch.strategy = body.strategy;
    }
    if (Array.isArray(body?.order)) patch.order = body.order;
    if (Object.keys(patch).length) {
      settings.setRouting(patch);
      refreshRuntime();
      usage.log('info', `🔄 Routing updated: ${JSON.stringify(patch)}`);
    }
    sendJson(res, 200, { ok: true, routing: router.config.routing });
    return true;
  }

  // ---------- POST /api/test ----------
  if (path === '/api/test' && method === 'POST') {
    const body = await json();
    const def = router.defs.find((d) => d.id === (body?.providerId || ''));
    if (!def) {
      sendJson(res, 404, { error: { message: `Unknown provider "${body?.providerId}".`, type: 'not_found' } });
      return true;
    }
    const model = body?.model || def.discovered?.[0] || def.models?.[0] || 'socks-mock';
    const t0 = Date.now();
    const result = await router.chat({
      model: `${def.id}:${model}`,
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
      maxTokens: 16,
      stream: false,
      ignoreCooldown: true,
      timeoutMs: 20000,
    });
    const latencyMs = Date.now() - t0;
    if (result.ok) {
      const content = result.result.json?.choices?.[0]?.message?.content ?? '';
      sendJson(res, 200, {
        ok: true, providerId: result.providerId, model: result.model, latencyMs,
        snippet: String(content).slice(0, 200),
      });
      usage.log('info', `🧪 Test ${def.id} → OK in ${latencyMs}ms`);
    } else {
      sendJson(res, 200, {
        ok: false, providerId: def.id, model, latencyMs, error: result.error.slice(0, 400),
      });
      usage.log('warn', `🧪 Test ${def.id} → failed: ${result.error.slice(0, 200)}`);
    }
    return true;
  }

  // ---------- POST /api/shutdown (convenience for headless use) ----------
  if (path === '/api/shutdown' && method === 'POST') {
    sendJson(res, 200, { ok: true, bye: true });
    setTimeout(() => { try { process.exit(0); } catch { /* noop */ } }, 150);
    return true;
  }

  return false;
}
