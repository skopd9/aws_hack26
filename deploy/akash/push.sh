#!/usr/bin/env bash
# Tag + push the Chainguard-built IP-Pulse images to your Chainguard
# customer registry (cgr.dev/<org>/...) and stamp the resulting image
# refs into the SDL files under deploy/akash/.
#
# Prereqs:
#   * docker logged in to cgr.dev: `docker login cgr.dev` (use a
#     pull/push token from the Chainguard console).
#   * Local images already built: `docker compose build web worker`.
#   * `CHAINGUARD_ORG` env var set, e.g. `export CHAINGUARD_ORG=acme-co`.
#
# Usage:
#   CHAINGUARD_ORG=acme-co bash deploy/akash/push.sh
#
# Idempotent: re-running just re-pushes :latest and rewrites the SDLs.

set -euo pipefail

if [[ -z "${CHAINGUARD_ORG:-}" ]]; then
  echo "ERROR: set CHAINGUARD_ORG to your Chainguard registry org/namespace." >&2
  echo "       e.g. CHAINGUARD_ORG=acme-co bash deploy/akash/push.sh" >&2
  exit 1
fi

REGISTRY="cgr.dev/${CHAINGUARD_ORG}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Tagging local images for ${REGISTRY}"
docker tag ippulse-web:latest    "${REGISTRY}/ippulse-web:latest"
docker tag ippulse-worker:latest "${REGISTRY}/ippulse-worker:latest"

echo "==> Pushing to ${REGISTRY}"
docker push "${REGISTRY}/ippulse-web:latest"
docker push "${REGISTRY}/ippulse-worker:latest"

echo "==> Rewriting SDL image refs (CHAINGUARD_ORG -> ${CHAINGUARD_ORG})"
# macOS sed needs `-i ''` and Linux sed needs `-i`; use a portable form.
for f in stack.sdl.yml web.sdl.yml worker.sdl.yml; do
  if [[ -f "${SCRIPT_DIR}/${f}" ]]; then
    sed -e "s|cgr.dev/CHAINGUARD_ORG/|cgr.dev/${CHAINGUARD_ORG}/|g" \
      "${SCRIPT_DIR}/${f}" > "${SCRIPT_DIR}/${f}.tmp"
    mv "${SCRIPT_DIR}/${f}.tmp" "${SCRIPT_DIR}/${f}"
    echo "    rewrote ${f}"
  fi
done

echo "==> Done."
echo
echo "Next steps:"
echo "  1. Open https://console.akash.network and connect your Keplr/Leap wallet."
echo "  2. Click 'Deploy' -> upload deploy/akash/stack.sdl.yml"
echo "  3. Set the env values (ANTHROPIC_API_KEY, etc.) in the configuration step."
echo "  4. Accept a provider bid; watch the deployment logs for the readiness signal."
