// SocksRoute — OpenAI-compatible endpoint (/v1/chat/completions, /v1/models).
import { sendJson, readBody, pump, requestSignal } from './http-utils.mjs';
import { estimateTokens } from './tokens.mjs';
import { countStream, sseFromJson } from './streams.mjs';

export function handleModels(router) {
  const data = router.models().map(({ id, providerId, providerName }) => ({
    id,
    object: 'model',
    created: 0,
    owned_by: providerId,
    provider: providerName,
  }));
  return { object: 'list', data };
}

export async function handleChatCompletions(req, res, router, config, usage) {
  const raw = await readBody(req, 25 * 1024 * 1024).catch((e) => {
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

  const { model, messages, stream, temperature, max_tokens } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return sendJson(res, 400, {
      error: { message: 'messages must be a non-empty array', type: 'invalid_request_error', code: 'invalid_messages' },
    });
  }

  const result = await router.chat({
    model,
    messages,
    temperature,
    maxTokens: max_tokens,
    stream: !!stream,
    extra: body,
    signal: requestSignal(req, res),
  });

  if (!result.ok) {
    res.setHeader('X-SocksRoute-Error', String(result.error).slice(0, 500));
    return sendJson(res, result.status || 503, {
      error: { message: result.error, type: 'upstream_error', code: 'all_providers_failed' },
    });
  }

  res.setHeader('X-SocksRoute-Provider', result.providerId);

  if (!stream) {
    return sendJson(res, 200, result.result.json);
  }

  // ---- streaming ----
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  if (result.result.stream) {
    // real upstream SSE → pass through, counting output tokens
    const tin = estimateTokens((messages || []).map((m) => String(m.content ?? '')).join('\n'));
    const { stream: passthrough, getTokens } = countStream(result.result.stream);
    await pump(res, passthrough);
    usage.record(result.providerId, { tokensIn: tin, tokensOut: getTokens() });
  } else {
    // provider answered non-streaming → synthesize SSE chunks
    const src = sseFromJson(result.result.json, result.model);
    await pump(res, src);
    const tout = result.result.json?.usage?.completion_tokens ?? 0;
    usage.record(result.providerId, { tokensIn: result.result.json?.usage?.prompt_tokens ?? 0, tokensOut: tout });
  }
  res.end();
}
