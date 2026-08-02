// SocksRoute — provider registry + OpenAI-compatible chat adapter.
//
// Every provider here speaks the OpenAI chat-completions API, so one
// adapter covers them all. Free-tier providers only need a free API key;
// `pollinations` is a public endpoint that needs NO key at all.
import { estimateTokens } from './tokens.mjs';

export const PROVIDER_DEFS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
    free: true,
    note: 'Free key at aistudio.google.com — generous daily free-tier limits.',
  },
  {
    id: 'groq',
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    free: true,
    note: 'Free tier key at console.groq.com. Blazing fast Llama models.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'deepseek/deepseek-r1:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'openai/gpt-4o-mini:free',
    ],
    free: true,
    note: 'Many :free models with a free key from openrouter.ai/keys.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    envKey: 'CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b'],
    free: true,
    note: 'Free tier key at cloud.cerebras.ai.',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    envKey: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['open-mistral-nemo', 'mistral-small-latest'],
    free: true,
    note: 'Free "Experiment" tier key at console.mistral.ai.',
  },
  {
    id: 'pollinations',
    name: 'Pollinations',
    keyless: true,
    baseUrl: 'https://text.pollinations.ai/openai',
    models: ['openai', 'mistral'],
    free: true,
    note: 'Truly free public endpoint, no API key. Shared community resource — be polite with it.',
  },
  {
    id: 'mock',
    name: 'Mock (built-in)',
    keyless: true,
    models: ['socks-mock'],
    free: true,
    note: 'Built-in test provider. No key, no network — last-resort fallback so SocksRoute never dies silently.',
  },
];

/** User-defined OpenAI-compatible providers from config.customProviders. */
export function getCustomDefs(config) {
  return (config.customProviders || []).map((p) => ({
    id: p.id,
    name: p.name || p.id,
    custom: true,
    baseUrl: (p.baseUrl || '').replace(/\/$/, ''),
    apiKey: p.apiKey || '',
    models: Array.isArray(p.models) ? p.models : ['custom-model'],
    free: !!p.free,
    note: p.note || 'Custom OpenAI-compatible provider.',
  }));
}

/** Combine built-in + custom provider definitions. */
export function getAllDefs(config) {
  return [...PROVIDER_DEFS, ...getCustomDefs(config)];
}

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

/**
 * Call any OpenAI-compatible provider.
 * Returns { json } for non-streaming, or { stream } (a ReadableStream
 * of raw upstream SSE bytes) for streaming.
 */
export async function openAIChat(def, key, { model, messages, temperature, maxTokens, stream, extra = {}, signal, timeoutMs = 120000 }) {
  const base = (def.baseUrl || '').replace(/\/+$/, '');
  const body = { model, messages };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (stream) body.stream = true;
  // Forward the useful extra OpenAI parameters (tools, top_p, stop, …)
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

/** Built-in mock provider — answers locally, never touches the network. */
export function mockChat({ model, messages }) {
  const last = messages?.[messages.length - 1];
  const text = String(last?.content ?? '').slice(0, 300);
  const reply = `🧦 SocksRoute mock reply (model "${model}").
You said: ${text || '(nothing)'}

Add a real provider key to config.json (e.g. GEMINI_API_KEY or GROQ_API_KEY) and SocksRoute will route through it instead.`;
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
