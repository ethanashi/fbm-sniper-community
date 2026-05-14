#!/bin/bash
# build.sh — Build the fbm-sniper Docker image without starting it
# Usage: ./build.sh [DOCKER_HOST]
#
# Examples:
#   ./build.sh                          # Local Docker
#   ./build.sh tcp://10.1.1.122:2375   # Remote Docker on VM

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────
DOCKER_HOST="${1:-${DOCKER_HOST:-}}"
IMAGE_NAME="fbm-sniper-community:latest"

if [ -n "$DOCKER_HOST" ]; then
  export DOCKER_HOST
  echo "→ Using remote Docker host: $DOCKER_HOST"
fi

echo "→ Building image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

echo "✓ Build complete: $IMAGE_NAME"
echo "  Run ./run.sh to start the container."
