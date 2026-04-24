# Guild AI — pending sponsor confirmation

## Status

Scaffolded against raw Slack Events API as a safe default (`app/api/slack/events/route.ts` + `lib/slack.ts`). Guild AI SDK specifics need to be confirmed at the sponsor booth on hackathon day.

## Swap path (if Guild AI ships an SDK / framework)

Everything the agent needs is encapsulated in three functions in [`lib/slack.ts`](./lib/slack.ts):

- `verifySlackSignature(req)` — inbound request authentication
- `postMessage(channel, blocks)` — outbound response
- `buildRiskReportBlocks(report)` — rendering a `RiskReport` into Block Kit

To swap to Guild AI:

1. Create `lib/guild.ts` exposing the same three function signatures
2. In `app/api/slack/events/route.ts`, replace the import
3. No changes to `lib/agent/orchestrator.ts` or any MCP operation

The orchestrator is surface-agnostic; it only knows about messages in and a `RiskReport` out. Slack vs Guild AI is a rendering detail.

## Questions to confirm at the sponsor booth

- Does Guild AI provide its own webhook/event API, or does it sit on top of Slack Events?
- Is there a Node SDK? (`@guild-ai/sdk`?)
- How is signature verification handled? (Slack-compatible `v0` or their own?)
- Do they have a specific Block Kit variant / rich card format?
- Any required app manifest or installation flow?

## Prize eligibility

Even without the SDK swap, the current Slack-based integration should qualify for any "Slack-native agent" prize Guild AI is offering, since our bot behaves identically in Slack. The swap becomes relevant only if they require use of their specific client library.
