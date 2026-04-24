import 'server-only';

/**
 * Cosmo Router client — Mode B (federated GraphQL).
 *
 * When `COSMO_ROUTER_URL` is set, every MCP tool runs as a GraphQL operation
 * against the Cosmo Router. The router is configured in `docker-compose.yml`
 * as `ghcr.io/wundergraph/cosmo/router:latest`, listens on port 3002, and
 * fetches the latest valid composition of our 5 subgraphs from Cosmo Cloud
 * (publishing flow: see `cosmo/README.md`).
 *
 * When `COSMO_ROUTER_URL` is unset (the default for `npm run dev`), tools
 * fall back to direct in-process integration calls. Same data shape, no
 * router dependency — keeps the hackathon demo bootable on a laptop.
 */

const ROUTER_URL = process.env.COSMO_ROUTER_URL ?? '';
const ROUTER_TOKEN = process.env.COSMO_ROUTER_TOKEN ?? '';

type GqlResponse<T> = {
  data: T | null;
  errors?: Array<{ message: string; path?: Array<string | number> }>;
};

export function isCosmoEnabled(): boolean {
  return ROUTER_URL.length > 0;
}

export async function cosmoGql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  operationName?: string
): Promise<T> {
  if (!ROUTER_URL) {
    throw new Error('COSMO_ROUTER_URL not set; cannot reach Cosmo Router');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/graphql-response+json, application/json'
  };
  // The router itself only requires a token if you've enabled router auth;
  // by default in-network traffic is open. Forward one if provided.
  if (ROUTER_TOKEN) headers['Authorization'] = `Bearer ${ROUTER_TOKEN}`;

  const res = await fetch(ROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables, operationName })
  });
  if (!res.ok) {
    throw new Error(`cosmo-router ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(
      `cosmo-router GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`
    );
  }
  if (json.data == null) {
    throw new Error('cosmo-router returned null data');
  }
  return json.data;
}
