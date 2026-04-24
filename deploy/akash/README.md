# Akash deployment — IP-Pulse

Deploy the Chainguard-hardened IP-Pulse containers to the Akash decentralized
cloud via [console.akash.network](https://console.akash.network).

## SDL variants

| File | Topology | When to use |
|------|----------|-------------|
| `stack.sdl.yml` | web + worker + redis (with persistent volume) | **Demo/full-stack** — single deployment, no external services needed |
| `web.sdl.yml`   | web only                                      | Production — Redis runs externally (Upstash, ElastiCache, etc.) |
| `worker.sdl.yml`| worker only                                   | Production — web runs on Vercel/Fly, worker handles cron + telemetry rollups |

## Image strategy

All three SDLs reference your **Chainguard customer registry**:

```
cgr.dev/<YOUR_CHAINGUARD_ORG>/ippulse-web:latest
cgr.dev/<YOUR_CHAINGUARD_ORG>/ippulse-worker:latest
```

Redis uses the public `cgr.dev/chainguard/redis:latest` image (no push needed
— it's pullable by any Akash provider).

The base layers in both Dockerfiles are Chainguard distroless Node, so the
final images inherit Chainguard's 0-CVE, non-root, no-shell posture.

## One-time prerequisites

1. **Chainguard registry login**
   ```bash
   docker login cgr.dev
   # username: <your chainguard email>
   # password: <pull/push token from the Chainguard console>
   ```
2. **Akash wallet** with at least 5–10 AKT (or USDC on Akash) to fund the
   deployment escrow. Use [Keplr](https://www.keplr.app/) or
   [Leap](https://www.leapwallet.io/) — Console.akash.network supports both.
3. **Local images built**
   ```bash
   docker compose build web worker
   ```

## Deploy steps (Console flow)

### 1. Push images and stamp the SDLs

```bash
export CHAINGUARD_ORG=<your-chainguard-namespace>
bash deploy/akash/push.sh
```

`push.sh` will:
- `docker tag` each image into `cgr.dev/${CHAINGUARD_ORG}/...`
- `docker push` both images
- Rewrite `cgr.dev/CHAINGUARD_ORG/...` → `cgr.dev/${CHAINGUARD_ORG}/...`
  inside `stack.sdl.yml`, `web.sdl.yml`, and `worker.sdl.yml`.

### 2. Open Console and create the deployment

1. Visit [console.akash.network](https://console.akash.network) and connect
   your wallet.
2. Click **Deploy** → **Build your template** → **Upload SDL**.
3. Select `deploy/akash/stack.sdl.yml` (or `web.sdl.yml` / `worker.sdl.yml`).
4. In the **Update Configuration** screen, set the secret env values for the
   `web` and `worker` services:
   - `ANTHROPIC_API_KEY` — required for the Claude orchestrator
   - `TINYFISH_API_KEY` — required for `web` (TinyFish web research)
   - `GITHUB_TOKEN` — optional, raises GitHub API rate limits for prior-art search
   - `COSMO_ROUTER_URL` — optional, point at your Cosmo Router; leave blank for in-process fallback
   - `MOCK_FALLBACK=true` — already defaulted; keeps the demo running if any external API errors
5. Click **Create Deployment** → wait for bids (10–30s) → pick a provider →
   **Accept Bid**.

### 3. Verify health

Once the lease is active and the containers are running:

```bash
# Console gives you a public URL like:
#   https://<random>.<provider>.com  (port 80 -> service web port 3000)

curl -sS https://<your-akash-url>/api/health
# Expected:
# {
#   "status":"ok",
#   "uptimeSec": <int>,
#   "redis": { "reachable": true, "response": "PONG", "url": "redis://redis:6379" },
#   "latencyMs": <int>,
#   "ts": "..."
# }
```

The `redis: { reachable: true, response: "PONG" }` field confirms the web
container is talking to the in-deployment Redis service over the SDL's
private DNS (`redis://redis:6379`).

### 4. Watch logs

In Console → **Deployments** → your deployment → **Logs**:
- `web` should show Next.js startup banner + `[redis] connection established`
  on first health probe
- `worker` should show `[worker] heartbeat` lines every interval
- `redis` should show `Ready to accept connections`

## Pricing

Default bid caps in `stack.sdl.yml`:

| Service | CPU | RAM    | Disk            | Bid cap (uakt/block) | ~$ / month* |
|---------|-----|--------|-----------------|----------------------|-------------|
| web     | 1.0 | 1 Gi   | 2 Gi ephemeral  | 2000                 | ~$3–6       |
| worker  | 0.5 | 512 Mi | 1 Gi ephemeral  | 1000                 | ~$2–4       |
| redis   | 0.5 | 512 Mi | 1 Gi + 2 Gi SSD | 1000                 | ~$3–5       |

*Approximate — providers bid below the cap, and AKT price varies.
With $100 in Akash credits this comfortably covers weeks of full-stack uptime.

## Troubleshooting

- **No bids in 60s** — your bid caps may be too low for current market rates.
  Bump each `amount` field by 2–4× in the SDL and resubmit.
- **`ImagePullBackOff` in logs** — the provider can't pull from `cgr.dev`.
  Either (a) make the image public on cgr.dev, or (b) configure pull-secret
  injection through the Chainguard registry's anonymous-pull tier.
- **Healthcheck failing** — `curl /api/health` from inside the deployment
  shell. If Redis returns `ECONNREFUSED`, check that the `redis` service is
  in the same SDL deployment (intra-deployment DNS is what makes
  `redis://redis:6379` resolve).
- **Redis data loss after redeploy** — the persistent volume is tied to the
  lease. Closing the lease destroys the volume. For real durability, use an
  external Redis and switch to `web.sdl.yml` + `worker.sdl.yml`.

## Notes on the existing budget table

This README replaces the previous worker-only budget. Akash ML Kimi K2.6
inference (`lib/integrations/akashml.ts`) is billed separately as a
pay-per-token API and is unaffected by where the web/worker run.
