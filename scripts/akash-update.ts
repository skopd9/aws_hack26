#!/usr/bin/env tsx
/**
 * Update an existing Akash deployment in-place via PUT /v1/deployments/{dseq}.
 * Reuses the same SDL substitution logic as akash-deploy.ts so secrets stay
 * out of the on-disk SDL.
 *
 * Required env: AKASH_CONSOLE_API_KEY
 * Optional env: AKASH_DSEQ (default: read from .akash-dseq), AKASH_SDL.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API_BASE = process.env.AKASH_CONSOLE_API_BASE ?? 'https://console-api.akash.network';

async function main() {
  const apiKey = process.env.AKASH_CONSOLE_API_KEY;
  if (!apiKey) {
    console.error('ERROR: missing AKASH_CONSOLE_API_KEY');
    process.exit(1);
  }
  let dseq = process.env.AKASH_DSEQ;
  if (!dseq) {
    try {
      dseq = (await readFile('.akash-dseq', 'utf8')).trim();
    } catch {
      console.error('ERROR: no AKASH_DSEQ and no .akash-dseq file');
      process.exit(1);
    }
  }

  const sdlPath = resolve(process.env.AKASH_SDL ?? 'deploy/akash/ippulse-live.sdl.yml');
  let sdl = await readFile(sdlPath, 'utf8');

  const placeholderRe = /__([A-Z][A-Z0-9_]*)__/g;
  const missing: string[] = [];
  sdl = sdl.replace(placeholderRe, (_m, name: string) => {
    const v = process.env[name];
    if (!v) {
      missing.push(name);
      return '';
    }
    return v;
  });
  if (missing.length > 0) {
    console.warn(`warn: missing env: ${missing.join(', ')}`);
  }

  console.log(`==> PUT /v1/deployments/${dseq}`);
  const res = await fetch(`${API_BASE}/v1/deployments/${dseq}`, {
    method: 'PUT',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data: { sdl } })
  });
  if (!res.ok) {
    console.error(`ERROR ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();
  console.log('Update accepted.');
  const leases = json.data?.leases ?? [];
  for (const l of leases) {
    console.log(`  lease: provider=${l.id.provider} state=${l.state}`);
    const services = l.status?.services ?? {};
    for (const [n, s] of Object.entries(services) as [string, { uris?: string[]; ready_replicas: number; total: number }][]) {
      console.log(`    ${n}: ${s.ready_replicas}/${s.total} ready`);
      for (const u of s.uris ?? []) console.log(`      https://${u}`);
    }
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
