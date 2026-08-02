// SocksRoute — provider registry + chat adapters.
//
// Provider pools are data-driven: the curated catalog lives in
// src/catalog/providers.json (~50 pools), and the model catalog in
// src/catalog/openrouter.json (337 real models, refreshed with
// `npm run catalog:sync`). Live model discovery (GET /models) enriches
// every pool at runtime. Every provider speaks either the OpenAI
// chat-completions API (`format: 'openai'`, default) or the Anthropic
// messages API (`format: 'anthropic'`).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from './tokens.mjs';

const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'catalog');

let _providersJson = null;
function catalogProviders() {
  if (_providersJson) return _providersJson;
  try {
    const raw = JSON.parse(readFileSync(join(CATALOG_DIR, 'providers.json'), 'utf8'));
    _providersJson = (raw.providers || []).map((p) => ({ ...p }));
  } catch {
    _providersJson = [];
  }
  return _providersJson;
}

let _modelsJson = null;
/** Bundled OpenRouter model catalog: [{id,name,context,prompt,completion,free,provider}] */
export function loadModelCatalog() {
  if (_modelsJson) return _modelsJson;
  try {
    _modelsJson = JSON.parse(readFileSync(join(CATALOG_DIR, 'openrouter.json'), 'utf8'));
  } catch {
    _modelsJson = [];
  }
  return _modelsJson;
}

/** Catalog stats used by the dashboard chips. */
export function catalogStats() {
  const models = loadModelCatalog();
  const pools = catalogProviders();
  return {
    totalModels: models.length,
    freeModels: models.filter((m) => m.free).length,
    totalProviders: pools.length,
    freeProviders: pools.filter((p) => p.free || p.keyless).length,
  };
}

export const PROVIDER_DEFS = catalogProviders();

export function getCustomDefs(config) {
  return (config.customProviders || []).map((p) => ({
    id: p.id,
    name: p.name || p.id,
    custom: true,
    baseUrl: (p.baseUrl || '').replace(/\/+$/, ''),
    apiKey: p.apiKey || '',
    models: Array.isArray(p.models) ? p.models : ['custom-model'],
    free: !!p.free,
    format: p.format === 'anthropic' ? 'anthropic' : 'openai',
    note: p.note || 'Custom provider (any OpenAI-compatible API).',
  }));
}

/** Combine built-in + custom provider definitions. */
export function getAllDefs(config) {
  return [...PROVIDER_DEFS, ...getCustomDefs(config)];
}

// ---------------------------------------------------------------------------
// helpers

export function withTimeout(signal, ms = 120000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`Upstream timeout after ${ms}ms`)), ms);
  timer.unref?.(); // don't keep the process alive just for a pending timeout
  const onAbort = () => ac.abort(signal?.reason || new Error('Client aborted'));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  ac.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }, { once: true });
  return ac.signal;
}

/** Normalize any OpenAI-style response into a clean chat.completion shape. */
export function normalizeOpenAI(json, model) {
  const choice = json?.choices?.[0] || {};
  let content = choice.message?.content ?? choice.text ?? '';
  if (Array.isArray(content)) {
    content = content
      .map((c) => c?.text ?? c?.content ?? '')
      .filter(Boolean)
      .join('');
  }
  const usage = json?.usage || {};
  return {
    id: json?.id || `chatcmpl-socks-${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: json?.created ?? Math.floor(Date.now() / 1000),
    model: json?.model || model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: String(content) },
      finish_reason: choice.finish_reason ?? 'stop',
    }],
    usage: {
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-format adapter

export async function openAIChat(def, key, { model, messages, temperature, maxTokens, stream, extra = {}, signal, timeoutMs = 120000 }) {
  const base = (def.baseUrl || '').replace(/\/+$/, '');
  const body = { model, messages };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (stream) body.stream = true;
  for (const k of [
    'top_p', 'stop', 'presence_penalty', 'frequency_penalty', 'tools',
    'tool_choice', 'seed', 'response_format', 'logit_bias', 'user', 'n',
    'parallel_tool_calls', 'reasoning_effort',
  ]) {
    if (extra[k] !== undefined) body[k] = extra[k];
  }

  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;

  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: withTimeout(signal, timeoutMs),
    });
  } catch (err) {
    const e = new Error(`[${def.id}] network error: ${err?.message || err}`);
    e.status = 0;
    throw e;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`[${def.id}] upstream ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  if (stream) return { stream: res.body };
  const json = await res.json().catch(() => ({}));
  return { json: normalizeOpenAI(json, model) };
}

// ---------------------------------------------------------------------------
// Anthropic-format adapter (real Claude API)

/**
 * Anthropic SSE events → OpenAI SSE chunks, transformed on the fly so the
 * rest of SocksRoute only ever deals with OpenAI-shaped streams.
 * Returns a ReadableStream of OpenAI-style SSE bytes.
 */
function anthropicToOpenAISse(upstream, model) {
  const enc = new TextEncoder();
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const chunk = (delta, finish) =>
    enc.encode(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    })}\n\n`);

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finished = false;
      const send = (c) => {
        if (!finished) controller.enqueue(c);
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            let ev;
            try { ev = JSON.parse(data); } catch { continue; }
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              send(chunk({ content: ev.delta.text }));
            } else if (ev.type === 'message_delta') {
              const stop = ev.delta?.stop_reason === 'max_tokens' ? 'length' : null;
              if (stop) { send(chunk({}, stop)); finished = true; }
            } else if (ev.type === 'message_stop') {
              send(chunk({}, 'stop'));
              finished = true;
            }
          }
        }
      } catch {
        // upstream died mid-stream — close cleanly
      } finally {
        reader.releaseLock();
      }
      if (!finished) send(chunk({}, 'stop'));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function anthropicToOpenAIJson(json, model) {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  const usage = json?.usage || {};
  return normalizeOpenAI({
    id: json?.id,
    created: 0,
    model: json?.model,
    choices: [{ message: { content: text }, finish_reason: json?.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
    usage: {
      prompt_tokens: usage.input_tokens ?? 0,
      completion_tokens: usage.output_tokens ?? 0,
      total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    },
  }, model);
}

export async function anthropicChat(def, key, { model, messages, temperature, maxTokens, stream, signal, timeoutMs = 120000 }) {
  const base = (def.baseUrl || '').replace(/\/+$/, '');
  const system = messages.filter((m) => m.role === 'system').map((m) => String(m.content ?? '')).join('\n\n');
  const msgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') }));

  const body = { model, max_tokens: maxTokens ?? 1024, messages: msgs };
  if (system) body.system = system;
  if (temperature !== undefined) body.temperature = temperature;
  if (stream) body.stream = true;

  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };

  let res;
  try {
    res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: withTimeout(signal, timeoutMs),
    });
  } catch (err) {
    const e = new Error(`[${def.id}] network error: ${err?.message || err}`);
    e.status = 0;
    throw e;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`[${def.id}] upstream ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  if (stream) return { stream: anthropicToOpenAISse(res.body, model) };
  const json = await res.json().catch(() => ({}));
  return { json: anthropicToOpenAIJson(json, model) };
}

// ---------------------------------------------------------------------------
// model discovery (GET /models) — used by Ollama/LM Studio (no static list)
// and to enrich every provider with its live model catalog.

export async function discoverModels(def, key, timeoutMs = 6000) {
  const base = (def.baseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  const headers = {};
  if (key && def.format === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else if (key) {
    headers.authorization = `Bearer ${key}`;
  }
  try {
    const res = await fetch(`${base}/models`, { headers, signal: withTimeout(null, timeoutMs) });
    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json?.data)
      ? json.data.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean)
      : [];
    return list.length ? list : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// built-in mock

export function mockChat({ model, messages }) {
  const last = messages?.[messages.length - 1];
  const text = String(last?.content ?? '').slice(0, 300);
  const reply = `🧦 SocksRoute mock reply (model "${model}").
You said: ${text || '(nothing)'}

Add a provider key in the dashboard (or config.json) and SocksRoute will route through it instead.`;
  const promptText = (messages || []).map((m) => String(m.content ?? '')).join('\n');
  return {
    json: {
      id: `chatcmpl-mock-${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || 'socks-mock',
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: estimateTokens(promptText),
        completion_tokens: estimateTokens(reply),
        total_tokens: estimateTokens(promptText) + estimateTokens(reply),
      },
    },
  };
}
