/**
 * Subgraph runner — boots all five federated subgraphs in one Node process
 * for local development. In production each subgraph ships as its own
 * docker-compose service (see docker-compose.yml).
 *
 * Run: `npm run subgraphs:dev`
 *
 * After they're up, the Cosmo Router (port 3002) federates them. See
 * `cosmo/README.md` for the wgc onboarding flow that publishes their
 * schemas to Cosmo Cloud.
 */
import { startSubgraph, type SubgraphSpec } from './_shared';
import { patentsSchema } from './patents';
import { priorartSchema } from './priorart';
import { litigationSchema } from './litigation';
import { verificationSchema } from './verification';
import { analysisSchema } from './analysis';

const SUBGRAPHS: SubgraphSpec[] = [
  { name: 'patents', port: 4001, schema: patentsSchema },
  { name: 'priorart', port: 4002, schema: priorartSchema },
  { name: 'litigation', port: 4003, schema: litigationSchema },
  { name: 'verification', port: 4004, schema: verificationSchema },
  { name: 'analysis', port: 4005, schema: analysisSchema }
];

async function main() {
  await Promise.all(SUBGRAPHS.map(startSubgraph));
  console.log(
    `[cosmo] all ${SUBGRAPHS.length} subgraphs ready — point Cosmo Router at them`
  );
}

main().catch((err) => {
  console.error('[cosmo] subgraph runner crashed:', err);
  process.exit(1);
});
