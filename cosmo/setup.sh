#!/usr/bin/env bash
# Cosmo Cloud onboarding for IP-Pulse — mirrors the official tutorial:
#   https://cosmo-docs.wundergraph.com/getting-started/cosmo-cloud-onboarding
#
# Prereqs:
#   - wgc CLI installed: `npm i -g wgc@latest`
#   - Logged in: `wgc auth login && wgc auth whoami`
#
# Idempotent: re-running just publishes the latest SDL for each subgraph.
set -euo pipefail

NS="${COSMO_NAMESPACE:-development}"
GRAPH="${COSMO_GRAPH:-ip-pulse}"
ROUTING_URL="${COSMO_ROUTING_URL:-http://localhost:3002/graphql}"
SUBGRAPH_HOST="${COSMO_SUBGRAPH_HOST:-localhost}"

# name | port (the routing URL the Cosmo Router will use)
SUBGRAPHS=(
  "patents|4001"
  "priorart|4002"
  "litigation|4003"
  "verification|4004"
  "analysis|4005"
)

echo ">>> Exporting subgraph SDL to cosmo/schemas/"
npx tsx --conditions=react-server cosmo/export-schemas.ts

echo ">>> Ensuring namespace '${NS}' exists"
wgc namespace create "${NS}" 2>/dev/null || echo "    namespace '${NS}' already exists"

echo ">>> Ensuring federated graph '${GRAPH}' exists in '${NS}'"
wgc federated-graph create "${GRAPH}" \
  --namespace "${NS}" \
  --routing-url "${ROUTING_URL}" \
  2>/dev/null || echo "    federated-graph '${GRAPH}' already exists"

for entry in "${SUBGRAPHS[@]}"; do
  name="${entry%%|*}"
  port="${entry##*|}"
  url="http://${SUBGRAPH_HOST}:${port}/graphql"

  echo ">>> Creating subgraph '${name}' → ${url}"
  wgc subgraph create "${name}" \
    --namespace "${NS}" \
    --routing-url "${url}" \
    2>/dev/null || echo "    subgraph '${name}' already exists"

  echo ">>> Publishing schema for '${name}'"
  wgc subgraph publish "${name}" \
    --namespace "${NS}" \
    --schema "cosmo/schemas/${name}.graphqls"
done

echo ""
echo "Cosmo setup complete. Next:"
echo "  1. Generate a router token:"
echo "       wgc router token create local --graph-name ${GRAPH} --namespace ${NS}"
echo "  2. Start the router (point at the host running the subgraphs):"
echo "       COSMO_GRAPH_API_TOKEN=<token> docker compose up cosmo-router"
echo "  3. Set COSMO_ROUTER_URL=http://localhost:3002/graphql in .env"
echo "     and restart 'npm run dev'."
echo ""
echo "Tip: if running the router in docker against subgraphs on the host,"
echo "     re-run with COSMO_SUBGRAPH_HOST=host.docker.internal so the"
echo "     router can reach them."
