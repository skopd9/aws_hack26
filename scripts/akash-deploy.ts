#!/usr/bin/env tsx
/**
 * Akash Console API deploy orchestrator.
 *
 * Reference: https://akash.network/docs/api-documentation/console-api/api-reference/
 *
 * Flow:
 *   1. POST /v1/deployments  { sdl, deposit }   -> { dseq, manifest }
 *   2. Poll GET /v1/bids?dseq=...               -> wait for >= 1 bid
 *   3. POST /v1/leases       { manifest, leases } with the cheapest bid
 *   4. Poll GET /v1/deployments/{dseq}          -> wait for service URIs
 *   5. Print the live URL.
 *
 * Required env:
 *   AKASH_CONSOLE_API_KEY   x-api-key from console.akash.network
 *
 * Optional env:
 *   AKASH_SDL               path to the SDL file (default deploy/akash/stack.sdl.yml)
 *   AKASH_DEPOSIT           USD deposit (default 5; minimum 5)
 *   AKASH_TARGET_SERVICE    service name to print URL for (default 'web')
 *   AKASH_BID_TIMEOUT_MS    how long to wait for bids (default 90000)
 *   AKASH_LEASE_TIMEOUT_MS  how long to wait for service URIs (default 300000)
 *
 * Usage:
 *   tsx scripts/akash-deploy.ts
 *   AKASH_SDL=deploy/akash/web.sdl.yml AKASH_DEPOSIT=10 tsx scripts/akash-deploy.ts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API_BASE = process.env.AKASH_CONSOLE_API_BASE ?? 'https://console-api.akash.network';

type CreateDeploymentResponse = {
  data: { dseq: string; manifest: string };
};

type Bid = {
  bid: {
    id: {
      owner: string;
      dseq: string;
      gseq: number;
      oseq: number;
      provider: string;
      bseq: number;
    };
    state: string;
    price: { denom: string; amount: string };
    created_at: string;
  };
};

type ServiceStatus = {
  name: string;
  available: number;
  total: number;
  uris: string[];
  ready_replicas: number;
  available_replicas: number;
};

type LeaseStatus = {
  forwarded_ports: Record<string, unknown>;
  ips: Record<string, unknown>;
  services: Record<string, ServiceStatus>;
};

type Lease = {
  id: {
    owner: string;
    dseq: string;
    gseq: number;
    oseq: number;
    provider: string;
    bseq: number;
  };
  state: string;
  price: { denom: string; amount: string };
  status: LeaseStatus | null;
};

type DeploymentDetail = {
  data: {
    deployment: { id: { dseq: string }; state: string };
    leases: Lease[];
  };
};

function need(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(`ERROR: missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

async function api<T>(
  path: string,
  init: RequestInit = {},
  apiKey: string
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(init.headers ?? {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`Akash API ${res.status} ${res.statusText} on ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function pollForBids(
  apiKey: string,
  dseq: string,
  timeoutMs: number
): Promise<Bid[]> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`  polling bids (attempt ${attempt}, ${elapsed}s)…\r`);
    const res = await api<{ data: Bid[] }>(`/v1/bids?dseq=${dseq}`, {}, apiKey).catch(
      () => ({ data: [] as Bid[] })
    );
    if (res.data.length > 0) {
      process.stdout.write('\n');
      return res.data;
    }
    await sleep(3000);
  }
  process.stdout.write('\n');
  throw new Error(`No bids received within ${timeoutMs}ms`);
}

function pickCheapest(bids: Bid[]): Bid {
  return [...bids].sort(
    (a, b) => Number(a.bid.price.amount) - Number(b.bid.price.amount)
  )[0];
}

async function pollForServiceUris(
  apiKey: string,
  dseq: string,
  serviceName: string,
  timeoutMs: number
): Promise<string[]> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(
      `  polling service '${serviceName}' for URIs (attempt ${attempt}, ${elapsed}s)…\r`
    );
    const res = await api<DeploymentDetail>(
      `/v1/deployments/${dseq}`,
      {},
      apiKey
    ).catch(() => null);
    const status = res?.data.leases.find((l) => l.status)?.status;
    const svc = status?.services?.[serviceName];
    if (svc && svc.uris.length > 0 && svc.ready_replicas >= 1) {
      process.stdout.write('\n');
      return svc.uris;
    }
    await sleep(5000);
  }
  process.stdout.write('\n');
  throw new Error(
    `Service '${serviceName}' did not expose URIs within ${timeoutMs}ms`
  );
}

async function main() {
  const apiKey = need('AKASH_CONSOLE_API_KEY');
  const sdlPath = resolve(process.env.AKASH_SDL ?? 'deploy/akash/stack.sdl.yml');
  const deposit = Number(process.env.AKASH_DEPOSIT ?? '5');
  const targetService = process.env.AKASH_TARGET_SERVICE ?? 'web';
  const bidTimeoutMs = Number(process.env.AKASH_BID_TIMEOUT_MS ?? '90000');
  const leaseTimeoutMs = Number(process.env.AKASH_LEASE_TIMEOUT_MS ?? '300000');

  if (deposit < 5) {
    console.error('ERROR: AKASH_DEPOSIT must be >= $5 (Akash Console minimum).');
    process.exit(1);
  }

  console.log(`==> Reading SDL from ${sdlPath}`);
  let sdl = await readFile(sdlPath, 'utf8');
  if (sdl.includes('CHAINGUARD_ORG')) {
    console.error(
      'ERROR: SDL still contains the literal CHAINGUARD_ORG placeholder. ' +
        'Run `CHAINGUARD_ORG=<your-org> bash deploy/akash/push.sh` first, ' +
        'or hand-edit the SDL with a publicly-pullable image reference.'
    );
    process.exit(1);
  }

  // Substitute __ENV_VAR__ placeholders with values from process.env so the
  // SDL on disk stays commit-safe (no secrets) and the live deployment gets
  // the real keys. Missing env vars are replaced with the empty string and
  // logged so MOCK_FALLBACK=true keeps the demo functional.
  const placeholderRe = /__([A-Z][A-Z0-9_]*)__/g;
  const missing: string[] = [];
  sdl = sdl.replace(placeholderRe, (_match, name: string) => {
    const v = process.env[name];
    if (v === undefined || v === '') {
      missing.push(name);
      return '';
    }
    return v;
  });
  if (missing.length > 0) {
    console.warn(
      `    warn: missing env vars (substituted with empty): ${missing.join(', ')}`
    );
  }

  console.log(`==> Creating deployment (deposit $${deposit})`);
  const created = await api<CreateDeploymentResponse>(
    '/v1/deployments',
    {
      method: 'POST',
      body: JSON.stringify({ data: { sdl, deposit } })
    },
    apiKey
  );
  const { dseq, manifest } = created.data;
  console.log(`    dseq=${dseq}`);

  // Persist the dseq early so akash-status.ts can pick it up after a crash
  // mid-bid. Idempotent — overwritten by the next deploy.
  await writeFile('.akash-dseq', dseq, 'utf8');

  console.log('==> Waiting for provider bids');
  const bids = await pollForBids(apiKey, dseq, bidTimeoutMs);
  console.log(`    received ${bids.length} bid(s)`);

  const winner = pickCheapest(bids);
  const ratePerBlockUakt = Number(winner.bid.price.amount);
  const dailyAkt = (ratePerBlockUakt * 14400) / 1_000_000; // ~14400 blocks/day
  console.log(
    `    cheapest bid: provider=${winner.bid.id.provider} ` +
      `price=${ratePerBlockUakt} ${winner.bid.price.denom}/block ` +
      `(~${dailyAkt.toFixed(3)} AKT/day)`
  );

  console.log('==> Accepting bid (creating lease)');
  await api(
    '/v1/leases',
    {
      method: 'POST',
      body: JSON.stringify({
        manifest,
        leases: [
          {
            dseq,
            gseq: winner.bid.id.gseq,
            oseq: winner.bid.id.oseq,
            provider: winner.bid.id.provider
          }
        ]
      })
    },
    apiKey
  );
  console.log('    lease created');

  console.log(`==> Waiting for service '${targetService}' to come online`);
  const uris = await pollForServiceUris(apiKey, dseq, targetService, leaseTimeoutMs);

  console.log('\n========================================');
  console.log(' Deployment is live');
  console.log('========================================');
  console.log(` dseq:     ${dseq}`);
  console.log(` provider: ${winner.bid.id.provider}`);
  console.log(' URIs:');
  for (const u of uris) console.log(`   https://${u}`);
  console.log('========================================');
  console.log('\nHealthcheck:');
  console.log(`  curl -sS https://${uris[0]}/api/health | jq .`);
  console.log('\nWatch / manage:');
  console.log(`  tsx scripts/akash-status.ts`);
  console.log(`  open https://console.akash.network/deployments/${dseq}`);
}

main().catch((err) => {
  console.error('\nERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
