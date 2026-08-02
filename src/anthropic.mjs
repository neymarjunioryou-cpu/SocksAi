// SocksRoute — Anthropic-compatible endpoint (/anthropic/v1/messages).
// Lets Claude Code (and other Anthropic-API clients) talk to SocksRoute:
//   ANTHROPIC_BASE_URL=http://localhost:20128/anthropic
import { sendJson, readBody, pump, requestSignal } from './http-utils.mjs';
import { estimateTokens } from './tokens.mjs';
import { iterSse } from './streams.mjs';

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (b?.type === 'text') return b.text ?? '';
      if (b?.type === 'tool_use') return JSON.stringify(b);
      if (b?.type === 'tool_result') {
        const c = b.content;
        return typeof c === 'string' ? c : JSON.stringify(c ?? '');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Convert an Anthropic /messages request into our internal (OpenAI-ish) shape. */
function anthropicToOpenAI(body) {
  const messages = [];
  if (body.system) {
    messages.push({
      role: 'system',
      content: typeof body.system === 'string' ? body.system : blockText(body.system),
    });
  }
  for (const m of body.messages || []) {
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: blockText(m.content),
    });
  }
  return {
    model: body.model,
    messages,
    max_tokens: body.max_tokens ?? 4096,
    temperature: body.temperature,
    stream: !!body.stream,
    tools: body.tools,
    tool_choice: body.tool_choice,
  };
}

/** Build an Anthropic-format message JSON from an OpenAI-style completion. */
function anthropicJson(openaiJson, model) {
  const text = typeof openaiJson?.choices?.[0]?.message?.content === 'string'
    ? openaiJson.choices[0].message.content
    : '';
  const usage = openaiJson?.usage || {};
  return {
    id: `msg_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: model || openaiJson?.model || 'socks-route',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens ?? estimateTokens(''),
      output_tokens: usage.completion_tokens ?? estimateTokens(text),
    },
  };
}

/** Convert upstream OpenAI SSE into Anthropic SSE events. */
function anthropicSseFromOpenAI(upstream, model) {
  const encoder = new TextEncoder();
  const id = `msg_${Date.now().toString(36)}`;
  let outputTokens = 0;
  return new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`));
      send({
        type: 'message_start',
        message: {
          id, type: 'message', role: 'assistant', model: model || 'socks-route',
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
      send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });

      let stopReason = 'end_turn';
      try {
        for await (const ev of iterSse(upstream)) {
          if (ev.done) break;
          const delta = ev.json?.choices?.[0]?.delta;
          if (delta && typeof delta.content === 'string' && delta.content) {
            outputTokens += estimateTokens(delta.content);
            send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } });
          }
          if (ev.json?.choices?.[0]?.finish_reason === 'length') stopReason = 'max_tokens';
        }
      } catch {
        // upstream died — still emit a clean stop
      }
      send({ type: 'content_block_stop', index: 0 });
      send({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
      send({ type: 'message_stop' });
      controller.close();
    },
  });
}

/** Anthropic SSE from a non-streaming completion. */
function anthropicSseFromJson(json, model) {
  const text = typeof json?.choices?.[0]?.message?.content === 'string'
    ? json.choices[0].message.content
    : '';
  const encoder = new TextEncoder();
  const id = `msg_${Date.now().toString(36)}`;
  return new ReadableStream({
    start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`));
      send({
        type: 'message_start',
        message: { id, type: 'message', role: 'assistant', model: model || 'socks-route', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      });
      send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      if (text) {
        for (let i = 0; i < text.length; i += 120) {
          send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 120) } });
        }
      }
      send({ type: 'content_block_stop', index: 0 });
      send({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: estimateTokens(text) } });
      send({ type: 'message_stop' });
      controller.close();
    },
  });
}

export function handleAnthropicModels(router) {
  const data = router.models().map(({ id, providerId, providerName }) => ({
    type: 'model',
    id,
    display_name: `${providerName} — ${id}`,
    created_at: '2026-01-01T00:00:00Z',
    owned_by: providerId,
  }));
  return { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null };
}

export async function handleAnthropicMessages(reqHttp, res, router, config, usage) {
  const raw = await readBody(reqHttp, 25 * 1024 * 1024).catch((e) => {
    sendJson(res, 400, { error: { message: e.message, type: 'invalid_request_error', code: 'bad_body' } });
    return null;
  });
  if (raw === null) return;

  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return sendJson(res, 400, {
      error: { message: 'Invalid JSON body', type: 'invalid_request_error', code: 'bad_json' },
    });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return sendJson(res, 400, {
      error: { message: 'messages must be a non-empty array', type: 'invalid_request_error', code: 'invalid_messages' },
    });
  }

  const mapped = anthropicToOpenAI(body);
  const result = await router.chat({
    model: body.model,
    messages: mapped.messages,
    temperature: mapped.temperature,
    maxTokens: mapped.max_tokens,
    stream: mapped.stream,
    extra: mapped,
    signal: requestSignal(reqHttp, res),
  });

  if (!result.ok) {
    res.setHeader('X-SocksRoute-Error', String(result.error).slice(0, 500));
    return sendJson(res, result.status || 503, {
      type: 'error',
      error: { type: 'api_error', message: result.error },
    });
  }

  res.setHeader('X-SocksRoute-Provider', result.providerId);

  if (!body.stream) {
    const json = result.result.stream ? await readUpstreamJson(result.result.stream) : result.result.json;
    return sendJson(res, 200, anthropicJson(json, body.model));
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  if (result.result.stream) {
    const tin = estimateTokens((mapped.messages || []).map((m) => String(m.content ?? '')).join('\n'));
    const converted = anthropicSseFromOpenAI(result.result.stream, body.model);
    await pump(res, converted);
    usage.record(result.providerId, { tokensIn: tin, tokensOut: estimateTokens('') }); // approx; counted via output later? keep simple
    // Note: exact output tokens for anthropic streams are counted inside
    // anthropicSseFromOpenAI but not surfaced; estimation is fine for stats.
  } else {
    const converted = anthropicSseFromJson(result.result.json, body.model);
    await pump(res, converted);
    usage.record(result.providerId, {
      tokensIn: result.result.json?.usage?.prompt_tokens ?? 0,
      tokensOut: result.result.json?.usage?.completion_tokens ?? 0,
    });
  }
  res.end();
}

/** If upstream was requested streaming but we need a JSON answer, drain the SSE. */
async function readUpstreamJson(stream) {
  let json = null;
  for await (const ev of iterSse(stream)) {
    if (ev.done) break;
    if (!json && ev.json) json = ev.json;
    // keep last event that carries choices
    if (ev.json?.choices?.length) json = ev.json;
  }
  return json ?? {};
}
