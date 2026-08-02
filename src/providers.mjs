// SocksRoute — provider registry + chat adapters.
//
// Every provider here speaks either the OpenAI chat-completions API
// (`format: 'openai'`, default) or the Anthropic messages API
// (`format: 'anthropic'`). One adapter per format covers all of them.
// `pollinations` needs no key at all; Ollama/LM Studio talk to local
// models; OpenRouter alone unlocks 400+ models with one free key.
import { estimateTokens } from './tokens.mjs';

export const PROVIDER_DEFS = [
  {
    id: 'mock',
    name: 'Mock (built-in)',
    keyless: true,
    models: ['socks-mock'],
    free: true,
    note: 'Built-in test provider. No key, no network — last-resort fallback so SocksRoute never dies silently.',
  },
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
    note: 'Free tier key at console.groq.com. Blazing-fast Llama models.',
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
    note: 'One free key = 400+ models (many :free). The "all AI websites" key.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
    format: 'anthropic',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
    free: false,
    note: 'Paid API — the real Claude models, reached through SocksRoute so Claude Code can use any provider.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    free: false,
    note: 'Very cheap (not free). Known for excellent code.',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    envKey: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-mini'],
    free: false,
    note: 'Free credits on signup at console.x.ai, then paid.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    envKey: 'CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b'],
    free: true,
    note: 'Free tier key at cloud.cerebras.ai — the fastest inference hardware around.',
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
    id: 'nvidia',
    name: 'NVIDIA NIM',
    envKey: 'NVIDIA_API_KEY',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-72b-instruct'],
    free: true,
    note: 'Free credits at build.nvidia.com; OpenAI-compatible NIM endpoints.',
  },
  {
    id: 'together',
    name: 'Together AI',
    envKey: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
    free: false,
    note: 'Free credits on signup at api.together.ai, then usage-based.',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    envKey: 'HF_TOKEN',
    baseUrl: 'https://router.huggingface.co/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-R1'],
    free: true,
    note: 'Free monthly credits with a Hugging Face token (hf_...).',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    envKey: 'FIREWORKS_API_KEY',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-v3'],
    free: false,
    note: 'Free credits on signup at fireworks.ai, then usage-based.',
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    envKey: 'GITHUB_TOKEN',
    baseUrl: 'https://models.github.ai/integration/openai',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'o3-mini'],
    free: true,
    note: 'Free rate-limited tier with a GitHub account (use a PAT as the key).',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    keyless: true,
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [],
    free: true,
    note: 'Runs 100% local models on this machine (or Termux). Start `ollama serve`, install a model, enable here.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    keyless: true,
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: [],
    free: true,
    note: 'Local models served by LM Studio on this machine.',
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
];

/** User-defined OpenAI-compatible providers from settings/config customProviders. */
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
