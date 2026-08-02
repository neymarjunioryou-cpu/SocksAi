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
