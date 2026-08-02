// SocksRoute — tiny JSON persistence for usage stats (no database, no native deps).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class UsageStore {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'usage.json');
    this.data = {
      providers: {},
      totals: { requests: 0, tokensIn: 0, tokensOut: 0, errors: 0 },
    };
    try {
      if (existsSync(this.file)) {
        this.data = JSON.parse(readFileSync(this.file, 'utf8'));
      }
    } catch {
      // start fresh
    }
    this._timer = null;
  }

  _touch(id) {
    if (!this.data.providers[id]) {
      this.data.providers[id] = {
        requests: 0, tokensIn: 0, tokensOut: 0, errors: 0,
        lastUsed: null, lastError: null,
      };
    }
    return this.data.providers[id];
  }

  record(id, { tokensIn = 0, tokensOut = 0 } = {}) {
    const p = this._touch(id);
    p.requests += 1;
    p.tokensIn += tokensIn;
    p.tokensOut += tokensOut;
    p.lastUsed = Date.now();
    this.data.totals.requests += 1;
    this.data.totals.tokensIn += tokensIn;
    this.data.totals.tokensOut += tokensOut;
    this._schedule();
  }

  recordError(id, message) {
    const p = this._touch(id);
    p.errors += 1;
    p.lastError = String(message).slice(0, 500);
    this.data.totals.errors += 1;
    this._schedule();
  }

  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 2000);
  }

  flush() {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.file);
    } catch {
      // non-fatal — stats are best-effort
    }
  }

  close() {
    if (this._timer) clearTimeout(this._timer);
    this.flush();
  }

  /** Snapshot of provider health + usage, for the dashboard and /api/status. */
  status(router) {
    const providers = router.orderedDefs().map((def) => {
      const p = this.data.providers[def.id] || {};
      return {
        id: def.id,
        name: def.name,
        keyless: !!def.keyless,
        hasKey: router.usable(def),
        enabled: router.isEnabled(def),
        models: def.models || [],
        free: !!def.free,
        note: def.note || '',
        cooldownSeconds: Math.round(router.cooldownRemaining(def) / 1000),
        requests: p.requests || 0,
        tokensIn: p.tokensIn || 0,
        tokensOut: p.tokensOut || 0,
        errors: p.errors || 0,
        lastUsed: p.lastUsed || null,
        lastError: p.lastError || null,
      };
    });
    return {
      service: 'socksroute',
      providers,
      totals: this.data.totals,
      routing: router.config.routing || {},
      compression: router.config.compression || {},
      port: router.config.port,
      host: router.config.host,
      authEnabled: !!router.config.apiKey,
    };
  }
}
