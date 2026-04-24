/**
 * Print each subgraph's federation SDL to `cosmo/schemas/<name>.graphqls` so
 * `wgc subgraph publish` has a stable file to point at. The output is the
 * same SDL the Yoga server would expose at runtime via introspection.
 *
 * Run via `npm run cosmo:setup` (which calls this) — never invoke directly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { printSubgraphSchema } from '@apollo/subgraph';
import { patentsSchema } from '../subgraphs/patents';
import { priorartSchema } from '../subgraphs/priorart';
import { litigationSchema } from '../subgraphs/litigation';
import { verificationSchema } from '../subgraphs/verification';
import { analysisSchema } from '../subgraphs/analysis';

const subgraphs = [
  { name: 'patents', schema: patentsSchema },
  { name: 'priorart', schema: priorartSchema },
  { name: 'litigation', schema: litigationSchema },
  { name: 'verification', schema: verificationSchema },
  { name: 'analysis', schema: analysisSchema }
];

mkdirSync('cosmo/schemas', { recursive: true });
for (const { name, schema } of subgraphs) {
  const sdl = printSubgraphSchema(schema);
  writeFileSync(`cosmo/schemas/${name}.graphqls`, sdl);
  console.log(`[cosmo] wrote cosmo/schemas/${name}.graphqls (${sdl.length} chars)`);
}
