#!/bin/bash
# run.sh — Start the fbm-sniper container (assumes image is already built)
# Usage: ./run.sh [DOCKER_HOST]
#
# Examples:
#   ./run.sh                          # Local Docker
#   ./run.sh tcp://10.1.1.122:2375   # Remote Docker on VM

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────
DOCKER_HOST="${1:-${DOCKER_HOST:-}}"
IMAGE_NAME="fbm-sniper-community:latest"
CONTAINER_NAME="fbm-sniper"
VOLUME_NAME="fbm-sniper-data"
PORT="3340"
DATA_DIR="/app/data"
CHROME_CACHE_DIR="/app/chrome-cache"

if [ -n "$DOCKER_HOST" ]; then
  export DOCKER_HOST
  echo "→ Using remote Docker host: $DOCKER_HOST"
fi

# Check if image exists
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "✗ Image not found: $IMAGE_NAME"
  echo "  Run ./setup.sh to build and start."
  exit 1
fi

echo "→ Ensuring volume exists: $VOLUME_NAME"
docker volume create "$VOLUME_NAME" >/dev/null 2>&1 || true

echo "→ Stopping old container (if any)..."
docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "→ Starting container: $CONTAINER_NAME"
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${PORT}:3340" \
  -v "${VOLUME_NAME}:${DATA_DIR}" \
  -e FBM_DATA_DIR="${DATA_DIR}" \
  -e PUPPETEER_CACHE_DIR="${CHROME_CACHE_DIR}" \
  --restart unless-stopped \
  "$IMAGE_NAME"

echo "→ Waiting for health check..."
for i in $(seq 1 30); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "missing")
  if [ "$STATUS" = "healthy" ]; then
    echo "✓ Container is healthy!"
    echo "  URL: http://localhost:${PORT}"
    exit 0
  fi
  sleep 2
done

echo "✗ Health check timed out. Check logs:"
docker logs --tail 20 "$CONTAINER_NAME"
exit 1
