// SocksRoute — persistence: usage stats, dashboard settings, provider keys,
// and an in-memory event log. No database, no native modules — just JSON
// files in the (gitignored) data/ directory.
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

function readJson(file) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // corrupt file → start fresh
  }
  return null;
}

function atomicWrite(file, obj) {
  try {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Optional AES-256-GCM encryption at rest for keys.json
// (enabled with SOCKSROUTE_STORAGE_KEY — same idea as OmniRoute's
//  "encrypt credentials at rest", minus the insecure defaults).

function deriveKey(secret) {
  return createHash('sha256').update(String(secret)).digest();
}

function encrypt(plain, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') };
}

function decrypt(payload, secret) {
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Dashboard-managed settings + keys

export class SettingsStore {
  constructor(dataDir, { storageKey } = {}) {
    this.dir = dataDir;
    this.storageKey = storageKey;
    this.keysFile = join(dataDir, 'keys.json');
    this.settingsFile = join(dataDir, 'settings.json');
    this.keys = {};
    this.settings = { providers: {}, routing: {} };

    const rawKeys = readJson(this.keysFile);
    if (rawKeys && rawKeys.v) {
      try {
        this.keys = JSON.parse(decrypt(rawKeys, storageKey));
      } catch {
        console.warn('[socksroute] Could not decrypt keys.json — wrong SOCKSROUTE_STORAGE_KEY? Keys ignored.');
        this.keys = {};
      }
    } else if (rawKeys) {
      this.keys = rawKeys; // legacy plaintext
      if (storageKey) this._saveKeys(); // upgrade to encrypted
    }

    const rawSettings = readJson(this.settingsFile);
    if (rawSettings) this.settings = { providers: {}, routing: {}, ...rawSettings };
  }

  _saveKeys() {
    const payload = this.storageKey ? encrypt(JSON.stringify(this.keys), this.storageKey) : this.keys;
    atomicWrite(this.keysFile, payload);
  }

  _saveSettings() {
    atomicWrite(this.settingsFile, this.settings);
  }

  getKeys() { return this.keys; }
  getSettings() { return this.settings; }

  setKey(id, value) {
    this.keys[id] = value;
    this._saveKeys();
  }

  deleteKey(id) {
    delete this.keys[id];
    this._saveKeys();
  }

  setProviderEnabled(id, enabled) {
    this.settings.providers[id] = { ...(this.settings.providers[id] || {}), enabled: !!enabled };
    this._saveSettings();
  }

  setRouting(patch) {
    this.settings.routing = { ...(this.settings.routing || {}), ...patch };
    this._saveSettings();
  }

  setCustomProviders(list) {
    this.settings.customProviders = list;
    this._saveSettings();
  }
}

// ---------------------------------------------------------------------------
// Usage stats + event log

export class UsageStore {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'usage.json');
    this.data = {
      providers: {},
      totals: { requests: 0, tokensIn: 0, tokensOut: 0, errors: 0 },
    };
    const loaded = readJson(this.file);
    if (loaded) this.data = loaded;
    this.logs = [];
    this._timer = null;
  }

  log(level, msg) {
    this.logs.push({ ts: Date.now(), level, msg: String(msg).slice(0, 500) });
    if (this.logs.length > 100) this.logs.splice(0, this.logs.length - 100);
  }

  _touch(id) {
    if (!this.data.providers[id]) {
      this.data.providers[id] = {
        requests: 0, tokensIn: 0, tokensOut: 0, errors: 0,
        latencyAvg: null, lastUsed: null, lastError: null,
      };
    }
    return this.data.providers[id];
  }

  record(id, { tokensIn = 0, tokensOut = 0, latencyMs } = {}) {
    const p = this._touch(id);
    p.requests += 1;
    p.tokensIn += tokensIn;
    p.tokensOut += tokensOut;
    p.lastUsed = Date.now();
    if (latencyMs !== undefined) {
      p.latencyAvg = p.latencyAvg === null ? latencyMs : Math.round(p.latencyAvg * 0.7 + latencyMs * 0.3);
    }
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
    atomicWrite(this.file, this.data);
  }

  close() {
    if (this._timer) clearTimeout(this._timer);
    this.flush();
  }

  /** Snapshot of provider health + usage, for the dashboard and /api/status. */
  status(router) {
    // all defs (enabled + disabled) so the dashboard can re-enable anything
    const providers = router.defs.map((def) => {
      const p = this.data.providers[def.id] || {};
      const discovered = def.discovered || [];
      const models = [...new Set([...(def.models || []), ...discovered])];
      return {
        id: def.id,
        name: def.name,
        custom: !!def.custom,
        keyless: !!def.keyless,
        hasKey: router.usable(def),
        enabled: router.isEnabled(def),
        models,
        free: !!def.free,
        format: def.format || 'openai',
        note: def.note || '',
        cooldownSeconds: Math.round(router.cooldownRemaining(def) / 1000),
        requests: p.requests || 0,
        tokensIn: p.tokensIn || 0,
        tokensOut: p.tokensOut || 0,
        errors: p.errors || 0,
        latencyAvg: p.latencyAvg ?? null,
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
      uptimeSeconds: Math.round(process.uptime()),
      now: Date.now(),
      logs: this.logs,
      catalog: router.catalogStats ? router.catalogStats() : null,
    };
  }
}
