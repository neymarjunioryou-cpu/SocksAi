// SocksRoute — the brain: provider selection, cooldowns, fallback, compression.
import { getAllDefs, mockChat, openAIChat, anthropicChat, discoverModels, loadModelCatalog, catalogStats } from './providers.mjs';
import { estimateTokens, pruneMessages } from './tokens.mjs';

export class Router {
  constructor(config, usage) {
    this.config = config;
    this.usage = usage;
    this.cooldowns = new Map(); // providerId -> timestamp until which it is skipped
    this.latency = new Map();   // providerId -> smoothed avg latency (ms)
    this.applyConfig(config);
  }

  /** Hot-swap config (dashboard edits) without losing cooldowns/latency. */
  applyConfig(config) {
    this.config = config;
    this.defs = getAllDefs(config);
  }

  isEnabled(def) {
    if (def.custom) {
      return def.enabled !== false;
    }
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

  /** All (provider, model) pairs a client may request (static + discovered + catalog). */
  models() {
    const out = [];
    const seen = new Set();
    for (const def of this.orderedDefs()) {
      if (!this.usable(def)) continue;
      for (const m of new Set([...(def.models || []), ...(def.discovered || [])])) {
        if (seen.has(m)) continue;
        seen.add(m);
        out.push({ id: m, providerId: def.id, providerName: def.name });
      }
    }
    // Catalog models become routable through catalog-capable pools (OpenRouter)
    // even without an explicit provider:model prefix — this is what makes
    // "500+ models through one endpoint" real.
    const catalogPool = this.defs.find((d) => d.catalog && this.usable(d));
    if (catalogPool) {
      for (const m of loadModelCatalog()) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ id: m.id, providerId: catalogPool.id, providerName: catalogPool.name });
      }
    }
    return out;
  }

  /**
   * Decide which providers can serve a request:
   *  - "provider:model" → that exact provider
   *  - a known model name → providers that offer it
   *  - a model in the bundled catalog → the catalog pool (OpenRouter)
   *  - anything else / "auto" → all usable providers, each with its default model
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
      const wanted = defs.filter((d) => [...(d.models || []), ...(d.discovered || [])].includes(model));
      const usableWanted = wanted.filter((d) => this.usable(d));
      if (usableWanted.length) {
        return usableWanted.map((d) => ({ def: d, key: this.keyFor(d), model }));
      }
      // Catalog lookup — any bundled model routes through the catalog pool
      const inCatalog = loadModelCatalog().some((m) => m.id === model);
      const catalogPool = defs.find((d) => d.catalog && this.usable(d));
      const mockDef = defs.find((d) => d.id === 'mock' && this.usable(d));
      const mockCand = mockDef ? { def: mockDef, key: '', model: mockDef.models?.[0] || 'socks-mock' } : null;
      if (inCatalog && catalogPool) {
        return mockCand
          ? [{ def: catalogPool, key: this.keyFor(catalogPool), model }, mockCand]
          : [{ def: catalogPool, key: this.keyFor(catalogPool), model }];
      }
      if (inCatalog) {
        // model exists but catalog pool has no key → mock as last resort
        return mockCand ? [mockCand] : [];
      }
    }

    return defs
      .filter((d) => this.usable(d))
      .map((d) => ({ def: d, key: this.keyFor(d), model: d.discovered?.[0] || d.models?.[0] || null }))
      .filter((c) => c.model);
  }

  catalogStats() {
    return catalogStats();
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
    else seconds = 5;
    this.cooldowns.set(def.id, Date.now() + seconds * 1000);
  }

  /** Fetch live model lists (Ollama, LM Studio, and enrichment for the rest). */
  async refreshModels() {
    const defs = this.enabledDefs().filter((d) => d.baseUrl && d.id !== 'mock');
    await Promise.allSettled(defs.map(async (def) => {
      const discovered = await discoverModels(def, this.keyFor(def));
      if (discovered) def.discovered = discovered;
    }));
  }

  /**
   * Route one chat request with automatic fallback.
   * Options: { ignoreCooldown } — used by the dashboard "Test provider" button.
   * Returns { ok, providerId, providerName, model, result }.
   */
  async chat({ model, messages, temperature, maxTokens, stream = false, signal, extra = {}, ignoreCooldown = false }) {
    const compression = this.config.compression || {};
    if (compression.enabled !== false) {
      messages = pruneMessages(messages, compression);
    }

    let candidates = this.candidatesFor(model);

    const strategy = this.config.routing?.strategy || 'priority';
    if (strategy === 'round-robin' && candidates.length > 1) {
      const key = model || 'auto';
      const idx = ((this._rr ||= {})[key] = ((this._rr[key] || 0) + 1) % candidates.length);
      candidates = [...candidates.slice(idx), ...candidates.slice(0, idx)];
    } else if (strategy === 'latency' && candidates.length > 1) {
      const known = candidates.filter((c) => this.latency.has(c.def.id));
      const unknown = candidates.filter((c) => !this.latency.has(c.def.id));
      known.sort((a, b) => this.latency.get(a.def.id) - this.latency.get(b.def.id));
      candidates = [...known, ...unknown];
    }

    if (!candidates.length) {
      return {
        ok: false,
        status: 503,
        error: 'No usable provider. Add a key in the dashboard (or enable a keyless provider).',
      };
    }

    const errors = [];
    for (const cand of candidates) {
      if (!ignoreCooldown) {
        const cool = this.cooldownRemaining(cand.def);
        if (cool > 0) {
          errors.push(`${cand.def.id} (cooling down ${Math.ceil(cool / 1000)}s)`);
          continue;
        }
      }
      const t0 = Date.now();
      try {
        let result;
        if (cand.def.id === 'mock') {
          result = mockChat({ model: cand.model, messages, temperature, maxTokens });
        } else if (cand.def.format === 'anthropic') {
          result = await anthropicChat(cand.def, cand.key, {
            model: cand.model, messages, temperature, maxTokens, stream,
            signal, timeoutMs: this.config.timeoutMs ?? 120000,
          });
        } else {
          result = await openAIChat(cand.def, cand.key, {
            model: cand.model, messages, temperature, maxTokens, stream,
            extra, signal, timeoutMs: this.config.timeoutMs ?? 120000,
          });
        }
        const latencyMs = Date.now() - t0;
        this.cooldowns.delete(cand.def.id);
        this.latency.set(cand.def.id, this.latency.has(cand.def.id)
          ? Math.round(this.latency.get(cand.def.id) * 0.7 + latencyMs * 0.3)
          : latencyMs);

        if (!stream || !result.stream) {
          const tin = result.json?.usage?.prompt_tokens
            ?? estimateTokens((messages || []).map((m) => String(m.content ?? '')).join('\n'));
          const tout = result.json?.usage?.completion_tokens ?? 0;
          this.usage.record(cand.def.id, { tokensIn: tin, tokensOut: tout, latencyMs });
        } else {
          // streaming: record a request with latency; tokens counted in handler
          this.usage.record(cand.def.id, { latencyMs });
        }

        return { ok: true, providerId: cand.def.id, providerName: cand.def.name, model: cand.model, result };
      } catch (err) {
        this.usage.recordError(cand.def.id, err?.message || String(err));
        this.applyCooldown(cand.def, err);
        errors.push(`${cand.def.id}: ${err?.message || err}`);
      }
    }

    const msg = `All providers failed. ${errors.join(' | ')}`;
    this.usage.log('warn', msg.slice(0, 400));
    return { ok: false, status: 503, error: msg };
  }
}
