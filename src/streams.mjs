// SocksRoute — stream helpers: SSE parsing, passthrough counting, synthetic SSE.
import { estimateTokens } from './tokens.mjs';

/** Async-generate SSE events ({ json } or { done: true }) from a ReadableStream. */
export async function* iterSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
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
        if (data === '[DONE]') {
          yield { done: true };
          return;
        }
        try {
          yield { json: JSON.parse(data) };
        } catch {
          // ignore malformed events
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Count tokens in OpenAI SSE chunks of the form {"choices":[{"delta":{"content":"…"}}]}. */
function countContentTokens(text) {
  let count = 0;
  const re = /"content":"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    count += estimateTokens(m[1].replace(/\\n/g, '\n'));
  }
  return count;
}

/**
 * Pass an upstream SSE byte stream through unchanged, counting output
 * tokens on the fly. Returns { stream, getTokens }.
 */
export function countStream(upstream) {
  const decoder = new TextDecoder();
  let count = 0;
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          count += countContentTokens(decoder.decode(value, { stream: true }));
          controller.enqueue(value);
        }
      } catch (err) {
        try { controller.error(err); } catch { /* already closed */ }
        return;
      }
      try { controller.close(); } catch { /* already closed */ }
    },
  });
  return { stream, getTokens: () => count };
}

/** Build an OpenAI SSE event stream from a single completion JSON (non-streaming source). */
export function sseFromJson(json, model) {
  const content = typeof json?.choices?.[0]?.message?.content === 'string'
    ? json.choices[0].message.content
    : '';
  const created = json?.created ?? Math.floor(Date.now() / 1000);
  const id = json?.id || `chatcmpl-socks-${Date.now().toString(36)}`;
  const enc = new TextEncoder();
  const chunk = (delta, finish) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model: json?.model || model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  });

  const events = [];
  events.push(chunk({ role: 'assistant', content: '' }));
  if (content) {
    // split long replies so clients see incremental progress
    for (let i = 0; i < content.length; i += 120) {
      events.push(chunk({ content: content.slice(i, i + 120) }));
    }
  }
  events.push(chunk({}, 'stop'));

  return new ReadableStream({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}
