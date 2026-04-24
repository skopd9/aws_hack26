# WunderGraph Cosmo onboarding for IP-Pulse

This directory contains everything needed to run IP-Pulse against a real
[WunderGraph Cosmo](https://cosmo-docs.wundergraph.com/) federated graph.
It mirrors the official
[Cosmo Cloud onboarding tutorial](https://cosmo-docs.wundergraph.com/getting-started/cosmo-cloud-onboarding)
applied to our 5 subgraphs:

| Subgraph        | Routing URL (local)              | Owns                                   |
| --------------- | -------------------------------- | -------------------------------------- |
| `patents`       | `http://localhost:4001/graphql`  | `Patent` entity, USPTO + Google + Nexla + Ghost cache |
| `priorart`      | `http://localhost:4002/graphql`  | GitHub + scholarly + tech-news prior art |
| `litigation`    | `http://localhost:4003/graphql`  | PACER / CourtListener litigation profile |
| `verification`  | `http://localhost:4004/graphql`  | TinyFish product-in-market verification  |
| `analysis`      | `http://localhost:4005/graphql`  | Akash ML (Kimi K2.6) — extends `Patent.summarize` |

The federated graph is `ip-pulse` and lives in the `development` namespace.

## One-time setup

1. Sign up at [cosmo.wundergraph.com](https://cosmo.wundergraph.com/login).
2. Install the [`wgc` CLI](https://cosmo-docs.wundergraph.com/cli/intro):

   ```bash
   npm install -g wgc@latest
   wgc auth login
   wgc auth whoami
   ```

3. Boot the subgraph servers locally so they're discoverable:

   ```bash
   npm run subgraphs:dev
   ```

4. Run the onboarding script — it creates the namespace, federated graph,
   and all 5 subgraphs, then publishes their schemas:

   ```bash
   bash cosmo/setup.sh
   ```

5. Generate a router token and start the Cosmo Router:

   ```bash
   wgc router token create local \
     --graph-name ip-pulse \
     --namespace development
   # copy the token, then:
   COSMO_GRAPH_API_TOKEN=<token> docker compose up cosmo-router
   ```

6. Point IP-Pulse at the router by setting `COSMO_ROUTER_URL` in `.env`:

   ```env
   COSMO_ROUTER_URL=http://localhost:3002/graphql
   ```

   Restart `npm run dev` and every MCP tool now flows through the Cosmo
   Router (`tool:calls` telemetry shows `outcome=ok` end-to-end).

## Day-to-day workflow

When you change a subgraph schema:

```bash
# Check the impact against recorded client traffic before merging:
wgc subgraph check <name> \
  --namespace development \
  --schema cosmo/schemas/<name>.graphqls

# Then publish:
wgc subgraph publish <name> \
  --namespace development \
  --schema cosmo/schemas/<name>.graphqls
```

If the check flags a breaking change tied to live operations, fix it
before publishing — the router will continue serving the last valid
composition until your fix lands.

## What the federation actually buys us

The textbook moment from the Cosmo onboarding doc — a single query that
crosses subgraph boundaries via the router — looks like this for IP-Pulse:

```graphql
query InvestigateThreat($query: String!, $stack: String!) {
  usptoSearch(query: $query, limit: 3) {       # → patents subgraph
    patentNo
    title
    assignee
    priorityDate
    summarize(claimText: "(...)", userStack: $stack) {  # → analysis subgraph
      summary                                  # via @key(patentNo) entity stitch
      roadmapImplication
    }
  }
  pacerLitigationHistory(assignee: $query) {   # → litigation subgraph
    isKnownNPE
    assigneeLitigationCount
  }
}
```

The router resolves `Patent.summarize` by sending an `_entities` query to
the `analysis` subgraph keyed on `patentNo`. This is the same
query-plan-inspection demo as the doc's `myEmployees` example, just with
patents instead of employees.
