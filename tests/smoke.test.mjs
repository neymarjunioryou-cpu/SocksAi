// SocksRoute — offline smoke tests (no network, no keys needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

function makeConfig(overrides = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'socksroute-'));
  return {
    dataDir,
    port: 0, // random port
    host: '127.0.0.1',
    apiKey: '',
    routing: {
      strategy: 'priority',
      order: ['broken', 'mock', 'pollinations'], // broken first → tests fallback
      cooldownSeconds: { 429: 60, '5xx': 15, 401: 1800 },
    },
    compression: { enabled: true, maxContextTokens: 32000, maxMessageChars: 60000 },
    timeoutMs: 3000,
    providers: {
      mock: { enabled: true },
      pollinations: { enabled: false },
      gemini: { enabled: false },
      groq: { enabled: false },
      openrouter: { enabled: false },
      cerebras: { enabled: false },
      mistral: { enabled: false },
    },
    customProviders: [
      { id: 'broken', name: 'Broken', baseUrl: 'http://127.0.0.1:9', models: ['broken-model'], apiKey: 'x' },
    ],
    ...overrides,
  };
}

async function start(config) {
  const { server, usage } = createServer(config);
  await new Promise((r) => server.listen(config.port, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => { usage.close(); server.close(r); }),
  };
}

test('health endpoint', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/health`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.service, 'socksroute');
  await srv.close();
});

test('/v1/models lists providers and models', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/v1/models`);
  const json = await res.json();
  assert.equal(res.status, 200);
  const ids = json.data.map((m) => m.id);
  assert.ok(ids.includes('socks-mock'), 'mock model present');
  assert.ok(ids.includes('broken-model'), 'custom provider model present');
  await srv.close();
});

test('chat completions via mock', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'socks-mock', messages: [{ role: 'user', content: 'hello socks' }] }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-socksroute-provider'), 'mock');
  assert.match(json.choices[0].message.content, /SocksRoute mock reply/);
  assert.ok(json.usage.total_tokens > 0);
  await srv.close();
});

test('auto-fallback: broken provider first, mock saves the day', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'nobody-has-this-model', messages: [{ role: 'user', content: 'hi' }] }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-socksroute-provider'), 'mock', 'fell back to mock');
  assert.ok(json.choices[0].message.content.length > 0);
  await srv.close();
});

test('streaming chat completions emits SSE and [DONE]', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'socks-mock', stream: true, messages: [{ role: 'user', content: 'stream me' }] }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  assert.ok(text.includes('data: [DONE]'), 'ends with [DONE]');
  assert.ok(text.includes('chat.completion.chunk'));
  await srv.close();
});

test('anthropic messages (non-streaming) — Claude Code format', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'socks-mock',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'hi anthropic' }],
    }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.type, 'message');
  assert.equal(json.content[0].type, 'text');
  assert.match(json.content[0].text, /SocksRoute mock reply/);
  await srv.close();
});

test('anthropic streaming emits message_start … message_stop', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'socks-mock',
      max_tokens: 200,
      stream: true,
      messages: [{ role: 'user', content: 'stream anthropic' }],
    }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('message_start'));
  assert.ok(text.includes('content_block_delta'));
  assert.ok(text.includes('content_block_stop'));
  assert.ok(text.includes('message_stop'));
  await srv.close();
});

test('auth: SOCKSROUTE_API_KEY gates /v1 routes', async () => {
  const srv = await start(makeConfig({ apiKey: 'super-secret' }));
  const denied = await fetch(`${srv.base}/v1/models`);
  assert.equal(denied.status, 401);
  const allowed = await fetch(`${srv.base}/v1/models`, {
    headers: { authorization: 'Bearer super-secret' },
  });
  assert.equal(allowed.status, 200);
  await srv.close();
});

test('unknown route → 404 JSON', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/nope`);
  assert.equal(res.status, 404);
  const json = await res.json();
  assert.equal(json.error.code, 'not_found');
  await srv.close();
});

// ---------------------------------------------------------------------------
// Admin API (the dashboard's backend)

test('admin: save + remove provider key via /api', async () => {
  const srv = await start(makeConfig());
  // save
  let res = await fetch(`${srv.base}/api/providers/gemini/key`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'AIza-abc123-secret' }),
  });
  assert.equal(res.status, 200);
  let status = await (await fetch(`${srv.base}/api/status`)).json();
  const gemini = status.providers.find((p) => p.id === 'gemini');
  assert.equal(gemini.hasKey, true);
  // masked config must never leak the key
  const cfg = await (await fetch(`${srv.base}/api/config`)).json();
  assert.ok(!JSON.stringify(cfg).includes('AIza-abc123-secret'), 'key is masked');
  assert.equal(cfg.providers.gemini.apiKey, 'AIza••••cret');
  // remove
  res = await fetch(`${srv.base}/api/providers/gemini/key`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  status = await (await fetch(`${srv.base}/api/status`)).json();
  assert.equal(status.providers.find((p) => p.id === 'gemini').hasKey, false);
  await srv.close();
});

test('admin: enable/disable provider toggle', async () => {
  const srv = await start(makeConfig());
  let res = await fetch(`${srv.base}/api/providers/gemini/enabled`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(res.status, 200);
  let status = await (await fetch(`${srv.base}/api/status`)).json();
  assert.equal(status.providers.find((p) => p.id === 'gemini').enabled, true);
  await fetch(`${srv.base}/api/providers/gemini/enabled`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  status = await (await fetch(`${srv.base}/api/status`)).json();
  assert.equal(status.providers.find((p) => p.id === 'gemini').enabled, false);
  await srv.close();
});

test('admin: custom provider CRUD', async () => {
  const srv = await start(makeConfig());
  // create
  let res = await fetch(`${srv.base}/api/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'myapi', name: 'My API', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', models: 'my-model, other-model' }),
  });
  assert.equal(res.status, 200);
  let models = await (await fetch(`${srv.base}/v1/models`)).json();
  assert.ok(models.data.some((m) => m.id === 'my-model'));
  assert.ok(models.data.some((m) => m.id === 'other-model'));
  // duplicate → 409
  res = await fetch(`${srv.base}/api/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'myapi', baseUrl: 'https://api.example.com/v1' }),
  });
  assert.equal(res.status, 409);
  // update
  res = await fetch(`${srv.base}/api/providers/myapi`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ models: ['new-only'], note: 'updated' }),
  });
  assert.equal(res.status, 200);
  models = await (await fetch(`${srv.base}/v1/models`)).json();
  assert.ok(models.data.some((m) => m.id === 'new-only'));
  assert.ok(!models.data.some((m) => m.id === 'my-model'));
  // delete
  res = await fetch(`${srv.base}/api/providers/myapi`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  models = await (await fetch(`${srv.base}/v1/models`)).json();
  assert.ok(!models.data.some((m) => m.id === 'new-only'));
  await srv.close();
});

test('admin: routing strategy update', async () => {
  const srv = await start(makeConfig());
  let res = await fetch(`${srv.base}/api/routing`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ strategy: 'round-robin', order: ['mock', 'broken'] }),
  });
  assert.equal(res.status, 200);
  let status = await (await fetch(`${srv.base}/api/status`)).json();
  assert.equal(status.routing.strategy, 'round-robin');
  assert.deepEqual(status.routing.order, ['mock', 'broken']);
  // invalid strategy → 400
  res = await fetch(`${srv.base}/api/routing`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ strategy: 'banana' }),
  });
  assert.equal(res.status, 400);
  await srv.close();
});

test('admin: test provider endpoint (mock)', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/api/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'mock' }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.providerId, 'mock');
  assert.match(json.snippet, /pong/i);
  await srv.close();
});

test('admin: event log endpoint', async () => {
  const srv = await start(makeConfig());
  await fetch(`${srv.base}/api/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'mock' }),
  });
  const res = await fetch(`${srv.base}/api/logs`);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(json.logs));
  assert.ok(json.logs.some((l) => l.msg.includes('Test')));
  await srv.close();
});

test('admin routes require auth when apiKey is set', async () => {
  const srv = await start(makeConfig({ apiKey: 'super-secret' }));
  const denied = await fetch(`${srv.base}/api/status`);
  assert.equal(denied.status, 401);
  const allowed = await fetch(`${srv.base}/api/status`, { headers: { authorization: 'Bearer super-secret' } });
  assert.equal(allowed.status, 200);
  await srv.close();
});

// ---------------------------------------------------------------------------
// Catalog (OmniRoute-scale model coverage)

test('catalog: providers.json ships a large pool list with free tiers', async () => {
  const { PROVIDER_DEFS, catalogStats } = await import('../src/providers.mjs');
  assert.ok(PROVIDER_DEFS.length >= 40, `expected ≥40 provider pools, got ${PROVIDER_DEFS.length}`);
  const stats = catalogStats();
  assert.ok(stats.totalProviders >= 40);
  assert.ok(stats.freeProviders >= 15, `expected ≥15 free tiers, got ${stats.freeProviders}`);
  // every pool has the required shape
  for (const d of PROVIDER_DEFS) {
    assert.ok(d.id && d.name, `pool ${d.id} has id/name`);
    assert.ok(!d.baseUrl || /^https?:\/\//.test(d.baseUrl), `pool ${d.id} baseUrl valid`);
    assert.ok(!d.format || ['openai', 'anthropic'].includes(d.format), `pool ${d.id} format valid`);
  }
});

test('catalog: bundled openrouter.json has 300+ models incl. free ones', async () => {
  const { loadModelCatalog } = await import('../src/providers.mjs');
  const models = loadModelCatalog();
  assert.ok(models.length >= 300, `expected ≥300 models, got ${models.length}`);
  assert.ok(models.some((m) => m.free), 'some models are free');
  for (const m of models) {
    assert.ok(m.id && typeof m.id === 'string');
    assert.ok(typeof m.free === 'boolean');
  }
});

test('catalog: /api/catalog exposes stats + model list', async () => {
  const srv = await start(makeConfig());
  const res = await fetch(`${srv.base}/api/catalog`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.stats.totalModels >= 300);
  assert.ok(Array.isArray(json.models) && json.models.length >= 300);
  assert.ok(Array.isArray(json.providers) && json.providers.length >= 40);
  await srv.close();
});

test('catalog: models() lists catalog models via the OpenRouter pool', async () => {
  const srv = await start(makeConfig({
    providers: {
      mock: { enabled: true },
      openrouter: { enabled: true, apiKey: 'sk-or-test' },
    },
    customProviders: [],
  }));
  const res = await fetch(`${srv.base}/v1/models`);
  const json = await res.json();
  const ids = json.data.map((m) => m.id);
  assert.ok(ids.length >= 300, `expected 300+ models, got ${ids.length}`);
  assert.ok(ids.some((m) => m.includes(':free')), 'catalog :free models present');
  await srv.close();
});

test('catalog: unknown model that is in the catalog routes via OpenRouter pool (falls back to mock offline)', async () => {
  const srv = await start(makeConfig({
    providers: {
      mock: { enabled: true },
      openrouter: { enabled: true, apiKey: 'sk-or-test' },
    },
    customProviders: [],
    routing: { strategy: 'priority', order: ['openrouter', 'mock'], cooldownSeconds: { 429: 60, '5xx': 15, 401: 1800 } },
  }));
  const { loadModelCatalog } = await import('../src/providers.mjs');
  const someModel = loadModelCatalog().find((m) => !m.id.includes(':'))?.id || 'openai/gpt-4o-mini';
  const res = await fetch(`${srv.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: someModel, messages: [{ role: 'user', content: 'hi' }] }),
  });
  // offline: openrouter fetch fails → falls back to mock → 200 with mock provider
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-socksroute-provider'), 'mock');
  await srv.close();
});
