# IP-Pulse

**Real-time agentic patent-intelligence for software engineers.**

IP-Pulse solves the "Latency Gap" in intellectual property by shifting from reactive search to proactive, agentic defense. It turns the daily flood of legal filings into real-time, voice-activated strategic alerts — grounded in your specific stack, invalidated against open-source prior art, and weighted by the litigation history of the patent holder.

## The pitch in one breath

> Traditional IP defense is a reactive bottleneck. IP-Pulse is the proactive agentic shield — Claude orchestrates MCP tools over a **WunderGraph Cosmo federated graph** (5 subgraphs, one router) to search USPTO + Google Patents, invalidate with GitHub prior-art, weight with PTAB history, summarize 500-page filings in one Kimi K2.6 call on Akash GPUs, verify product-in-market with TinyFish, cache in Ghost, and stream a structured Risk Report to you in Slack, in a browser chat, or over a phone call.

## Architecture at a glance

| Layer | Tech |
|---|---|
| UI surfaces | Web chat (primary), Slack / Guild AI, Vapi voice |
| Framework | Next.js 14 App Router + TypeScript + Tailwind |
| Agent | Vercel AI SDK + Anthropic Claude (orchestrator) |
| Bulk reasoning | Kimi K2.6 on Akash ML (claim summarization, prior-art rerank) |
| Tool layer | WunderGraph Cosmo federated graph — 5 Apollo Federation v2 subgraphs behind a Cosmo Router, exposed to Claude as MCP tools |
| Memory | Redis (session, stack profile, tool-call telemetry stream, rate limits) |
| Vector cache | Ghost AI DB |
| Data sources | USPTO PatentsView, patents.google.com (via TinyFish), GitHub, PTAB, CourtListener, TinyFish crawl, Nexla USPTO bulk feed |
| Containers | Chainguard hardened base images |
| Compute | Akash Network (worker lease) + Akash ML (Kimi K2.6 inference) |

## Quick start

```bash
cp .env.example .env          # fill in what you have; missing keys produce verbose tool errors that the agent reasons over rather than crashing
npm install
npm run dev                   # http://localhost:3000 — open, chat, watch MCP tools fire in the right pane
```

Or with Docker (brings up Redis, the 5 Cosmo subgraphs, the Cosmo Router, web, and worker in Chainguard containers):

```bash
docker compose up --build
```

### Wiring the Cosmo federated graph (sponsor track)

Local dev (`npm run dev`) calls integrations in-process — zero Cosmo
dependency. To run the **real** federated graph end-to-end:

```bash
npm i -g wgc@latest && wgc auth login        # one-time
npm run subgraphs:dev                         # ports 4001..4005
npm run cosmo:setup                           # creates namespace, graph, publishes 5 subgraphs
wgc router token create local --graph-name ip-pulse --namespace development
COSMO_GRAPH_API_TOKEN=<token> docker compose up cosmo-router
echo "COSMO_ROUTER_URL=http://localhost:3002/graphql" >> .env
```

See [`cosmo/README.md`](./cosmo/README.md) for the full onboarding flow,
day-to-day `wgc subgraph check` workflow, and the example federated query
that crosses subgraph boundaries via `Patent.summarize` (analysis subgraph
extending the patents subgraph's `Patent` entity).

## Keys checklist

See [`.env.example`](./.env.example). Tiered by need:

- **Tier 1 (web chat demo)**: `ANTHROPIC_API_KEY` + `REDIS_URL` (Redis runs in docker so this auto-resolves)
- **Tier 1 (Slack + Vapi)**: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`
- **Tier 2 (light up live tools)**: `USPTO_API_KEY`, `GITHUB_TOKEN`, `TINYFISH_API_KEY`, `AKASHML_API_KEY`, `GHOST_DATABASE_URL` (see [`deploy/ghost/README.md`](./deploy/ghost/README.md))
- **Tier 3 (gated)**: `PACER_USERNAME`/`PACER_PASSWORD` (paid) or `COURTLISTENER_TOKEN` (free alternative)

Missing keys do not crash the demo. Each tool throws a verbose
`IntegrationError` ("USPTO_API_KEY not set; cannot reach upstream", etc.);
`lib/cosmo/tools.ts` retries transient failures up to 3 times with
exponential backoff and then returns a structured `__toolError` envelope
to the model. The agent reads the envelope and pivots — calling a
complementary tool, refining arguments, or noting the gap explicitly in
the final RiskReport instead of fabricating data. See the "Tool failures"
section of `lib/agent/prompts.ts` for the contract the model follows.

## Security posture

All services run on `cgr.dev/chainguard/*` distroless, non-root base images. Run the scan to generate SBOMs and verify the 0-CVE posture:

```bash
npm run security:scan
# outputs grype report + syft SBOM to ./artifacts/
```

## Sponsor prize surface

| Sponsor | Where |
|---|---|
| WunderGraph Cosmo | `subgraphs/*` — 5 federated GraphQL subgraphs (Apollo Federation v2) + `cosmo/` onboarding playbook + `lib/cosmo/` runtime client. All external data flows through the Cosmo Router. |
| Vapi | `app/api/vapi/callback/route.ts` + `deploy/vapi/assistant.json` |
| Guild AI / Slack | `app/api/slack/events/route.ts` + `lib/slack.ts` (swap-ready for Guild AI SDK) |
| Redis | session / stack-profile / `tool:calls` stream / token-bucket rate limit |
| Nexla | `deploy/nexla/README.md` (UI flow) + `subgraphs/patents` (`nexlaLatestFilings` query) |
| Ghost AI DB | agent-provisioned Postgres at `<name>.ghost.build` — `patents` cache table + `ghostSimilarPatents` query / `ghostCachePatent` mutation on the patents subgraph. Setup: `deploy/ghost/README.md` |
| TinyFish | backbone of web research (`googlePatents.search` + `tinyfish.verifyProduct`) |
| Akash (compute) | `deploy/akash/worker.sdl.yml` |
| Akash ML (Kimi K2.6) | `lib/integrations/akashml.ts` + the `analysis` Cosmo subgraph (extends `Patent.summarize` via `@key`, plus `rerankPriorArt`) |
| Chainguard | `Dockerfile.web`, `Dockerfile.worker`, `scripts/security-scan.sh` |
| Anthropic | orchestrator in `lib/agent/orchestrator.ts` (Claude + Vercel AI SDK) |

## Layout

```
app/                   Next.js App Router — UI + API routes
  api/chat/            primary demo: streaming web chat
  api/vapi/callback/   Vapi voice webhook
  api/slack/events/    Slack / Guild AI events
  api/agent/query/     shared internal agent entrypoint
  api/telemetry/stream SSE reading Redis tool:calls stream
components/chat/       chat UI + RiskReportCard + ToolCallStrip
lib/
  redis.ts + redis/    client, streams telemetry, rate limit
  vapi.ts              HMAC verify + voice formatter
  slack.ts             signature verify + Block Kit
  cosmo/               Cosmo Router GraphQL client + MCP tool adapter (Claude-facing)
  integrations/        typed clients for each external service (throw verbose IntegrationError on failure)
  agent/               Vercel AI SDK orchestrator + system prompt + RiskReport schema
  context/stackProfile conversational stack description persisted in Redis
subgraphs/             5 Apollo Federation v2 subgraphs (patents, priorart,
                       litigation, verification, analysis) + Yoga runner
cosmo/                 wgc onboarding playbook + setup.sh + router.yaml
workers/               Chainguard worker (heartbeat stub for future cron)
deploy/                Akash SDL, Nexla flow README, Vapi assistant config
scripts/               security-scan.sh (grype + syft)
```
