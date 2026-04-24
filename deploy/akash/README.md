# Akash deployment — IP-Pulse worker

## What runs here

The IP-Pulse worker (`workers/index.ts`) leases compute on the Akash decentralized cloud. For v0 it's a heartbeat stub that future cron jobs (Nexla delta processor, tool-call telemetry rollup) will attach to.

## Budget (with $100 Akash credits)


| Line item                                                        | Monthly                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Worker lease (0.5 vCPU, 512Mi RAM)                               | ~$2-4                                                             |
| Buffer for bidding retries                                       | ~$1                                                               |
| **Worker total**                                                 | **~$5/mo**                                                        |
| Akash ML Kimi K2.6 inference (see `lib/integrations/akashml.ts`) | pay-per-token, estimate $10-30 per demo week depending on traffic |


With $100 in credits this covers weeks of continuous worker uptime plus generous Kimi K2.6 inference for demo traffic.

## Deploy

1. Build and push the worker image:
  ```bash
   docker build -f Dockerfile.worker -t <your-registry>/ippulse-worker:latest .
   docker push <your-registry>/ippulse-worker:latest
  ```
2. Edit `worker.sdl.yml`:
  - Replace `image: ippulse-worker:latest` with your pushed image reference.
  - Fill in the `env` values or inject them via Akash CLI `--env-file`.
3. Deploy via [console.akash.network](https://console.akash.network):
  - Upload `worker.sdl.yml`
  - Accept a provider bid
  - Open the deployment logs; `[worker ...] heartbeat` lines confirm liveness

## Notes

- The worker connects outbound to Redis and Anthropic; no inbound ports are required in production (port 3001 is reserved for future health-check HTTP).
- Chainguard base image (`cgr.dev/chainguard/node:latest`) runs non-root by default and produces 0-CVE builds via `npm run security:scan`.

