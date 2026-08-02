// SocksRoute — rough token estimation + simple context compression.

/**
 * Very rough token estimator: ~4 chars per token for Latin text,
 * CJK/wide characters count as ~1 token each. Good enough for
 * budgeting; real providers report exact usage in responses.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  let n = 0;
  for (const ch of String(text)) {
    n += ch.charCodeAt(0) > 127 ? 1 : 0.25;
  }
  return Math.max(1, Math.round(n));
}

function textOf(content) {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

/**
 * Keep the conversation inside a token budget:
 *  - truncate any single message longer than maxMessageChars
 *  - drop oldest non-system messages until under maxContextTokens
 * This is SocksRoute's lightweight answer to "token compression".
 */
export function pruneMessages(messages, { maxContextTokens = 32000, maxMessageChars = 60000 } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  let msgs = messages.map((m) => ({ ...m }));
  msgs = msgs.map((m) => {
    if (typeof m.content === 'string' && m.content.length > maxMessageChars) {
      return {
        ...m,
        content: `${m.content.slice(0, maxMessageChars)}\n…[truncated by SocksRoute]…`,
      };
    }
    return m;
  });

  let total = msgs.reduce((s, m) => s + estimateTokens(textOf(m.content)), 0);

  while (total > maxContextTokens && msgs.length > 1) {
    const idx = msgs.findIndex((m) => m.role !== 'system');
    if (idx === -1) break;
    total -= estimateTokens(textOf(msgs[idx].content));
    msgs.splice(idx, 1);
  }

  return msgs;
}
