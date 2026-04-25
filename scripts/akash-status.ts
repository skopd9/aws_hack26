#!/usr/bin/env tsx
/**
 * Inspect an existing Akash deployment and print the live URL(s).
 *
 * Required env:
 *   AKASH_CONSOLE_API_KEY
 *
 * Optional env:
 *   AKASH_DSEQ      deployment sequence (default: read from .akash-dseq)
 *
 * Usage:
 *   tsx scripts/akash-status.ts
 *   AKASH_DSEQ=12345 tsx scripts/akash-status.ts
 */

import { readFile } from 'node:fs/promises';

const API_BASE = process.env.AKASH_CONSOLE_API_BASE ?? 'https://console-api.akash.network';

type ServiceStatus = {
  name: string;
  available: number;
  total: number;
  uris: string[];
  ready_replicas: number;
  available_replicas: number;
};

type Lease = {
  id: { provider: string; dseq: string };
  state: string;
  price: { denom: string; amount: string };
  status: { services: Record<string, ServiceStatus> } | null;
};

type DeploymentDetail = {
  data: {
    deployment: { id: { dseq: string }; state: string };
    leases: Lease[];
    escrow_account: {
      state: { funds: { denom: string; amount: string }[] };
    };
  };
};

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
      console.error(
        'ERROR: no AKASH_DSEQ env var and no .akash-dseq file. ' +
          'Run `tsx scripts/akash-deploy.ts` first, or set AKASH_DSEQ.'
      );
      process.exit(1);
    }
  }

  const res = await fetch(`${API_BASE}/v1/deployments/${dseq}`, {
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    console.error(`Akash API ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const detail = (await res.json()) as DeploymentDetail;

  console.log(`Deployment dseq=${dseq}`);
  console.log(`  state: ${detail.data.deployment.state}`);
  const funds = detail.data.escrow_account.state.funds[0];
  if (funds) {
    const akt = Number(funds.amount) / 1_000_000;
    console.log(`  escrow: ${akt.toFixed(3)} ${funds.denom.replace(/^u/, '').toUpperCase()}`);
  }
  console.log(`  leases: ${detail.data.leases.length}`);
  for (const lease of detail.data.leases) {
    console.log(`    provider=${lease.id.provider} state=${lease.state}`);
    if (!lease.status) {
      console.log('      (no service status yet — provisioning)');
      continue;
    }
    for (const [name, svc] of Object.entries(lease.status.services)) {
      console.log(
        `      ${name}: ${svc.ready_replicas}/${svc.total} ready, ${svc.available} available`
      );
      for (const uri of svc.uris ?? []) {
        console.log(`        https://${uri}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
