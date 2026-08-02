// SocksRoute — the brain: provider selection, cooldowns, fallback, compression.
import { getAllDefs, mockChat, openAIChat } from './providers.mjs';
import { estimateTokens, pruneMessages } from './tokens.mjs';

export class Router {
  constructor(config, usage) {
    this.config = config;
    this.usage = usage;
    this.cooldowns = new Map(); // providerId -> timestamp until which it is skipped
    this.defs = getAllDefs(config);
  }

  isEnabled(def) {
    if (def.custom) return true;
    const p = this.config.providers?.[def.id];
    if (p === undefined) return true;
    return p.enabled !== false;
  }

  keyFor(def) {
    const p = this.config.providers?.[def.id];
    if (p?.apiKey) return p.apiKey;
    if (def.envKey && process.env[def.envKey]) return process.env[def.envKey];
    if (def.apiKey) return def.apiKey;
    return '';
  }

  usable(def) {
    return !!def.keyless || !!this.keyFor(def);
  }

  enabledDefs() {
    return this.defs.filter((d) => this.isEnabled(d));
  }

  /** Providers in routing priority order (config.routing.order overrides). */
  orderedDefs() {
    const order = this.config.routing?.order;
    const defs = this.enabledDefs();
    if (Array.isArray(order) && order.length) {
      const pos = new Map(order.map((id, i) => [id, i]));
      return [...defs].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
    }
    return defs;
  }

  /** All (provider, model) pairs a client may request. */
  models() {
    const out = [];
    for (const def of this.orderedDefs()) {
      if (!this.usable(def)) continue;
      for (const m of def.models || []) {
        out.push({ id: m, providerId: def.id, providerName: def.name });
      }
    }
    return out;
  }

  /**
   * Decide which providers can serve a request:
   *  - "provider:model" → that exact provider
   *  - a known model name → providers that offer it
   *  - anything else / "auto" → all usable providers, each with its default model
   * `mock` only answers when explicitly requested.
   */
  candidatesFor(model) {
    const defs = this.orderedDefs();

    if (model && model.includes(':')) {
      const [pid, m] = model.split(':', 2);
      const def = defs.find((d) => d.id === pid);
      if (def && this.usable(def) && m) {
        return [{ def, key: this.keyFor(def), model: m }];
      }
      return [];
    }

    if (model && model !== 'auto') {
      const wanted = defs.filter((d) => (d.models || []).includes(model));
      const usableWanted = wanted.filter((d) => this.usable(d));
      if (usableWanted.length) {
        return usableWanted.map((d) => ({ def: d, key: this.keyFor(d), model }));
      }
      // wanted providers exist but none usable → fall through to auto mode
    }

    return defs
      .filter((d) => this.usable(d))
      .map((d) => ({ def: d, key: this.keyFor(d), model: d.models?.[0] || null }))
      .filter((c) => c.model);
  }

  cooldownRemaining(def) {
    const until = this.cooldowns.get(def.id);
    return until ? Math.max(0, until - Date.now()) : 0;
  }

  applyCooldown(def, err) {
    const cfg = this.config.routing?.cooldownSeconds || {};
    let seconds;
    if (err.status === 429) seconds = cfg['429'] ?? 60;
    else if (err.status === 401 || err.status === 403) seconds = cfg['401'] ?? 1800;
    else if (err.status >= 500) seconds = cfg['5xx'] ?? 15;
    else seconds = 5; // network error — try again soon
    this.cooldowns.set(def.id, Date.now() + seconds * 1000);
  }

  /**
   * Route one chat request with automatic fallback.
   * Returns { ok, providerId, providerName, model, result }
   * where result = { json } or { stream }.
   */
  async chat({ model, messages, temperature, maxTokens, stream = false, signal, extra = {} }) {
    const compression = this.config.compression || {};
    if (compression.enabled !== false) {
      messages = pruneMessages(messages, compression);
    }

    let candidates = this.candidatesFor(model);
    if (this.config.routing?.strategy === 'round-robin' && candidates.length > 1) {
      const key = model || 'auto';
      const idx = ((this._rr ||= {})[key] = ((this._rr[key] || 0) + 1) % candidates.length);
      candidates = [...candidates.slice(idx), ...candidates.slice(0, idx)];
    }

    if (!candidates.length) {
      return {
        ok: false,
        status: 503,
        error: 'No usable provider. Enable a keyless provider (pollinations) or add an API key in config.json / env vars.',
      };
    }

    const errors = [];
    for (const cand of candidates) {
      const cool = this.cooldownRemaining(cand.def);
      if (cool > 0) {
        errors.push(`${cand.def.id} (cooling down ${Math.ceil(cool / 1000)}s)`);
        continue;
      }
      try {
        let result;
        if (cand.def.id === 'mock') {
          result = mockChat({ model: cand.model, messages, temperature, maxTokens });
        } else {
          result = await openAIChat(cand.def, cand.key, {
            model: cand.model,
            messages,
            temperature,
            maxTokens,
            stream,
            extra,
            signal,
            timeoutMs: this.config.timeoutMs ?? 120000,
          });
        }

        this.cooldowns.delete(cand.def.id);

        // Non-streaming (or synthetic streaming) → record usage now.
        if (!stream || !result.stream) {
          const tin = result.json?.usage?.prompt_tokens
            ?? estimateTokens((messages || []).map((m) => String(m.content ?? '')).join('\n'));
          const tout = result.json?.usage?.completion_tokens ?? 0;
          this.usage.record(cand.def.id, { tokensIn: tin, tokensOut: tout });
        }
        // Real upstream streaming → the HTTP handler counts output tokens as they flow.

        return { ok: true, providerId: cand.def.id, providerName: cand.def.name, model: cand.model, result };
      } catch (err) {
        this.usage.recordError(cand.def.id, err?.message || String(err));
        this.applyCooldown(cand.def, err);
        errors.push(`${cand.def.id}: ${err?.message || err}`);
      }
    }

    return {
      ok: false,
      status: 503,
      error: `All providers failed. ${errors.join(' | ')}`,
    };
  }
}
