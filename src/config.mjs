// SocksRoute — config loading (config.json + environment overrides).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const VERSION = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf8'),
).version;

const DEFAULTS = {
  port: 20128,
  host: '127.0.0.1',
  apiKey: '',
  routing: {
    strategy: 'priority', // 'priority' | 'round-robin'
    order: [], // optional explicit provider priority list, e.g. ["groq", "gemini", "pollinations"]
    cooldownSeconds: { 429: 60, '5xx': 15, 401: 1800 },
  },
  compression: {
    enabled: true,
    maxContextTokens: 32000,
    maxMessageChars: 60000,
  },
  timeoutMs: 120000,
  providers: {
    mock: { enabled: true },
    pollinations: { enabled: true },
    gemini: { enabled: false, envKey: 'GEMINI_API_KEY' },
    groq: { enabled: false, envKey: 'GROQ_API_KEY' },
    openrouter: { enabled: false, envKey: 'OPENROUTER_API_KEY' },
    cerebras: { enabled: false, envKey: 'CEREBRAS_API_KEY' },
    mistral: { enabled: false, envKey: 'MISTRAL_API_KEY' },
  },
  customProviders: [],
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(base?.[k])
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/**
 * Load configuration. Precedence (low → high):
 *   1. built-in defaults
 *   2. config.json next to the repo root (gitignored — safe for API keys)
 *   3. environment variables (PORT, HOST, SOCKSROUTE_API_KEY, provider keys)
 *      and provider-level "apiKey" fields in config.json
 */
export function loadConfig({ configPath = join(ROOT, 'config.json'), env = process.env } = {}) {
  let user = {};
  if (existsSync(configPath)) {
    try {
      user = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.warn(`[socksroute] Could not parse ${configPath}: ${err.message}. Using defaults.`);
    }
  }

  const config = deepMerge(DEFAULTS, user);

  // Environment overrides
  if (env.PORT) config.port = Number(env.PORT);
  if (env.HOST) config.host = env.HOST;
  if (env.SOCKSROUTE_API_KEY) config.apiKey = env.SOCKSROUTE_API_KEY;
  if (env.SOCKSROUTE_DATA_DIR) config.dataDir = env.SOCKSROUTE_DATA_DIR;
  if (env.SOCKSROUTE_STORAGE_KEY) config.storageKey = env.SOCKSROUTE_STORAGE_KEY;

  return config;
}

/**
 * Merge the runtime state (dashboard-managed settings + keys) on top of the
 * base config. Precedence (low → high):
 *   config.json / env  ←  settings.json  ←  keys.json
 */
export function buildRuntimeConfig(base, settings = {}, keys = {}) {
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.providers = { ...(base.providers || {}) };

  for (const [id, st] of Object.entries(settings.providers || {})) {
    cfg.providers[id] = { ...(cfg.providers[id] || {}), ...st };
  }
  for (const [id, k] of Object.entries(keys || {})) {
    if (k) cfg.providers[id] = { ...(cfg.providers[id] || {}), apiKey: k };
  }
  if (settings.routing) cfg.routing = { ...(cfg.routing || {}), ...settings.routing };
  // customProviders only overrides when the dashboard has explicitly saved a list
  // (initial state has no customProviders key, so config.json's list stays active)
  if (Object.prototype.hasOwnProperty.call(settings, 'customProviders')) {
    cfg.customProviders = settings.customProviders;
  }

  return cfg;
}
