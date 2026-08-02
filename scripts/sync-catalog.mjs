#!/usr/bin/env node
// SocksRoute — catalog sync.
//
// Refreshes src/catalog/openrouter.json from OpenRouter's live model API,
// so SocksRoute's "one endpoint, 500+ models" catalog stays current:
//
//   npm run catalog:sync
//
// (Run it on any machine with internet — your phone in Termux works too.
//  The sandbox/CI can't reach OpenRouter, so the repo ships with a bundled
//  snapshot; this script refreshes it whenever you want.)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'catalog', 'openrouter.json');
const URL = 'https://openrouter.ai/api/v1/models';

async function main() {
  console.log('🧦 SocksRoute catalog sync');
  console.log(`→ fetching ${URL}`);
  const res = await fetch(URL, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    console.error(`✗ OpenRouter returned ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const json = await res.json();
  const list = Array.isArray(json) ? json : json?.data;
  if (!Array.isArray(list) || !list.length) {
    console.error('✗ Unexpected payload shape — nothing to save.');
    process.exit(1);
  }

  const out = [];
  for (const m of list) {
    let prompt = 0, completion = 0;
    try { prompt = parseFloat(m.pricing?.prompt) || 0; } catch { /* ignore */ }
    try { completion = parseFloat(m.pricing?.completion) || 0; } catch { /* ignore */ }
    const free = (prompt === 0 && completion === 0) || String(m.id).includes(':free');
    out.push({
      id: m.id,
      name: m.name || '',
      context: m.context_length ?? null,
      prompt,
      completion,
      free,
      provider: m.top_provider?.id || null,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
  const free = out.filter((m) => m.free).length;
  console.log(`✓ saved ${out.length} models (${free} free) → src/catalog/openrouter.json`);
}

main().catch((err) => {
  console.error('✗ sync failed:', err.message);
  process.exit(1);
});
