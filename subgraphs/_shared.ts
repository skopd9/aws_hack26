/**
 * Subgraph runner — wraps each Apollo Federation v2 schema in a GraphQL Yoga
 * HTTP server so the Cosmo Router can fetch it via `wgc subgraph create
 * --routing-url http://localhost:<port>/graphql`.
 *
 * Each subgraph owns a port (4001..4005). For dev we run all five inside one
 * Node process via `npm run subgraphs:dev`. In docker compose, each one ships
 * as its own service so the Cosmo Router can address them by service name.
 */
import { createYoga } from 'graphql-yoga';
import { createServer, type Server } from 'node:http';
import type { GraphQLSchema } from 'graphql';

export type SubgraphSpec = {
  name: string;
  port: number;
  schema: GraphQLSchema;
};

export async function startSubgraph(spec: SubgraphSpec): Promise<Server> {
  const yoga = createYoga({
    schema: spec.schema,
    graphiql: true,
    landingPage: false,
    // We intentionally do NOT mask errors. Each integration throws an
    // `IntegrationError` whose message is verbose by design — the Cosmo
    // Router forwards it to the agent layer (`lib/cosmo/tools.ts`), which
    // surfaces it to Claude as a tool result. Masking would degrade the
    // model's ability to recover (e.g. switch to a different tool, refine
    // arguments). Subgraphs are an internal control-plane and are not
    // exposed to untrusted callers.
    maskedErrors: false
  });
  const server = createServer(yoga);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(spec.port, '0.0.0.0', () => {
      const url = `http://localhost:${spec.port}/graphql`;
      console.log(`[cosmo:${spec.name}] subgraph listening at ${url}`);
      resolve();
    });
  });
  return server;
}
