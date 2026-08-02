#!/usr/bin/env node
// SocksRoute — a tiny, dependency-free AI router/gateway.
//
//   npm run dev    → node --watch server.mjs (auto-restarts on edits)
//   npm start      → node server.mjs
//
// Endpoints:
//   GET  /                          dashboard (manage providers, keys, routing,
//                                   test providers, chat playground, logs)
//   GET  /health                    health check
//   GET  /v1/models                 OpenAI-style model list
//   POST /v1/chat/completions       OpenAI-style chat (streaming supported)
//   GET  /anthropic/v1/models       Anthropic-style model list
//   POST /anthropic/v1/messages     Anthropic-style chat (Claude Code compatible)
//   /api/*                          admin API used by the dashboard
//
// Auth: set SOCKSROUTE_API_KEY (env) or "apiKey" in config.json to require
//       `Authorization: Bearer <key>` on all /v1, /anthropic and /api routes.
//
// Optional: SOCKSROUTE_STORAGE_KEY encrypts data/keys.json at rest (AES-256-GCM).
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadConfig, buildRuntimeConfig, VERSION } from './src/config.mjs';
import { Router } from './src/router.mjs';
import { UsageStore, SettingsStore } from './src/store.mjs';
import { sendJson } from './src/http-utils.mjs';
import { handleModels, handleChatCompletions } from './src/openai.mjs';
import { handleAnthropicModels, handleAnthropicMessages } from './src/anthropic.mjs';
import { renderDashboard } from './src/dashboard.mjs';
import { handleAdmin } from './src/admin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)));

export function createServer(config = loadConfig()) {
  const dataDir = config.dataDir || join(ROOT, 'data');
  mkdirSync(dataDir, { recursive: true });
  const usage = new UsageStore(dataDir);
  const settings = new SettingsStore(dataDir, { storageKey: config.storageKey });
  const router = new Router(buildRuntimeConfig(config, settings.getSettings(), settings.getKeys()), usage);

  // After any dashboard edit: rebuild the runtime config and hot-swap it.
  const refreshRuntime = () => router.applyConfig(
    buildRuntimeConfig(config, settings.getSettings(), settings.getKeys()),
  );

  const ctx = { baseConfig: config, settings, usage, router, refreshRuntime, dataDir };

  const authorized = (req) => {
    if (!config.apiKey) return true;
    const h = req.headers.authorization || '';
    return h === `Bearer ${config.apiKey}` || h === config.apiKey;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname: path } = url;
    const method = (req.method || 'GET').toUpperCase();

    // CORS — harmless locally, needed by browser-based tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Anthropic-Version, X-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderDashboard(usage.status(router)));
        return;
      }

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true, service: 'socksroute', version: VERSION, uptimeSeconds: Math.round(process.uptime()) });
        return;
      }

      const needsAuth = path.startsWith('/v1') || path.startsWith('/anthropic') || path.startsWith('/api');
      if (needsAuth && !authorized(req)) {
        sendJson(res, 401, {
          error: { message: 'Unauthorized. Start SocksRoute with SOCKSROUTE_API_KEY and send `Authorization: Bearer <key>`.', type: 'auth_error', code: 'unauthorized' },
        });
        return;
      }

      // Admin API (dashboard writes)
      if (path.startsWith('/api/')) {
        const handled = await handleAdmin(req, res, url, ctx);
        if (handled) return;
      }

      if (method === 'GET' && path === '/v1/models') {
        sendJson(res, 200, handleModels(router));
        return;
      }
      if (method === 'POST' && path === '/v1/chat/completions') {
        await handleChatCompletions(req, res, router, config, usage);
        return;
      }
      if (method === 'GET' && path === '/anthropic/v1/models') {
        sendJson(res, 200, handleAnthropicModels(router));
        return;
      }
      if (method === 'POST' && path === '/anthropic/v1/messages') {
        await handleAnthropicMessages(req, res, router, config, usage);
        return;
      }

      sendJson(res, 404, {
        error: { message: `No route: ${method} ${path}`, type: 'not_found', code: 'not_found' },
      });
    } catch (err) {
      sendJson(res, 500, {
        error: { message: err?.message || 'Internal error', type: 'internal_error', code: 'internal_error' },
      });
    }
  });

  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return { server, usage, settings, router, config, refreshRuntime };
}

async function main() {
  const config = loadConfig();
  const { server, usage, router } = createServer(config);

  server.listen(config.port, config.host, () => {
    console.log('');
    console.log('  🧦  SocksRoute v' + VERSION);
    console.log('  ───────────────────────────────────────────────');
    console.log(`  Dashboard & API :  http://${config.host}:${config.port}`);
    console.log(`  OpenAI          :  http://${config.host}:${config.port}/v1`);
    console.log(`  Anthropic       :  http://${config.host}:${config.port}/anthropic`);
    console.log(`  Auth            :  ${config.apiKey ? 'enabled (SOCKSROUTE_API_KEY)' : 'disabled — set SOCKSROUTE_API_KEY if exposed'}`);
    console.log(`  Keys at rest    :  ${config.storageKey ? 'encrypted (SOCKSROUTE_STORAGE_KEY)' : 'plaintext data/keys.json — set SOCKSROUTE_STORAGE_KEY to encrypt'}`);
    console.log('  ───────────────────────────────────────────────');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  });

  // Discover live model lists (Ollama, LM Studio, and enrich the rest) —
  // non-blocking, failures are silently ignored.
  router.refreshModels().then(() => {
    if (router.defs.some((d) => (d.discovered || []).length)) {
      const total = router.defs.reduce((n, d) => n + (d.discovered || []).length, 0);
      usage.log('info', `📚 Discovered ${total} live models across providers`);
    }
  });

  const shutdown = () => {
    usage.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run directly only when executed as the entry point (so tests can import createServer).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('[socksroute] fatal:', err);
    process.exit(1);
  });
}
