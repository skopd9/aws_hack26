# WunderGraph MCP Gateway

This directory defines IP-Pulse's external data layer as MCP tools. Every external data source in the system is reached through exactly one operation file here — **never** via direct `fetch` from API routes or from the agent orchestrator.

## Two modes

IP-Pulse is designed to run either with or without a WunderGraph node process.

**Mode A — in-process (default, used for the hackathon demo):**
- The Next.js agent orchestrator calls MCP tools defined in `lib/wundergraph/mcp.ts`, which delegate directly to the functions in `lib/integrations/*`.
- The files in `.wundergraph/operations/*` are the **canonical sponsor-facing declarations** of each tool (its name, input schema, delegate); they re-export the same integration functions so the tool contract is single-sourced.

**Mode B — federated (optional, for `docker compose up`):**
- Run `wunderctl generate && wunderctl up` (or `docker compose up wundergraph`) to spin up a wundernode that serves the operations in this directory as HTTP endpoints at `http://localhost:9991/operations/<name>`.
- `lib/wundergraph/client.ts` can then be switched from the direct-import mode to the network-client mode.
- This is how you would deploy MCP as a standalone service in prod.

## Tool inventory

| Operation file | MCP tool name | Backing integration |
|---|---|---|
| `uspto.search.ts` | `uspto_search` | `lib/integrations/uspto.ts:searchUspto` |
| `uspto.claim.ts` | `uspto_claim` | `lib/integrations/uspto.ts:getClaimText` |
| `uspto.citations.ts` | `uspto_citations` | `lib/integrations/uspto.ts:getCitations` |
| `ptab.history.ts` | `ptab_history` | `lib/integrations/uspto.ts:getPtabHistory` |
| `googlePatents.search.ts` | `googlePatents_search` | `lib/integrations/googlePatents.ts:searchPatents` (via TinyFish) |
| `github.priorArt.ts` | `github_priorArt` | `lib/integrations/github.ts:findPriorArt` |
| `pacer.litigationHistory.ts` | `pacer_litigationHistory` | `lib/integrations/pacer.ts:litigationHistory` |
| `tinyfish.verifyProduct.ts` | `tinyfish_verifyProduct` | `lib/integrations/tinyfish.ts:verifyProductUsage` |
| `nexla.latestFilings.ts` | `nexla_latestFilings` | `lib/integrations/nexla.ts:latestFilings` |
| `ghost.similarPatents.ts` | `ghost_similarPatents` | `lib/integrations/ghost.ts:similarPatents` |
| `ghost.cachePatent.ts` | `ghost_cachePatent` | `lib/integrations/ghost.ts:upsertPatentEmbedding` |
| `akashml.summarizeClaim.ts` | `akashml_summarizeClaim` | `lib/integrations/akashml.ts:summarizeClaim` |
| `akashml.rerankPriorArt.ts` | `akashml_rerankPriorArt` | `lib/integrations/akashml.ts:rerankPriorArt` |

## Not in TypeScript include

This directory is excluded from the root `tsconfig.json` because WunderGraph has its own compile step. Edit files here freely — `npm run typecheck` won't complain.
