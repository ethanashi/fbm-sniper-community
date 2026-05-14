#!/bin/bash
# setup.sh — Build and start the fbm-sniper container from scratch
# Usage: ./setup.sh [DOCKER_HOST]
#
# Examples:
#   ./setup.sh                          # Local Docker
#   ./setup.sh tcp://10.1.1.122:2375   # Remote Docker on VM

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

echo "→ Building image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

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
    echo "  GeoIP test: curl http://localhost:${PORT}/api/geoip"
    exit 0
  fi
  sleep 2
done

echo "✗ Health check timed out. Check logs:"
docker logs --tail 20 "$CONTAINER_NAME"
exit 1
