# update.ps1 — Pull latest code, rebuild image, and restart container
# Usage: .\update.ps1 [-DockerHost <host>]
#
# Examples:
#   .\update.ps1                          # Local Docker
#   .\update.ps1 -DockerHost tcp://10.1.1.122:2375   # Remote Docker on VM

param(
    [string]$DockerHost = $env:DOCKER_HOST
)

# ─── Configuration ───────────────────────────────────────────────────────
$IMAGE_NAME = "fbm-sniper-community:latest"
$CONTAINER_NAME = "fbm-sniper"
$VOLUME_NAME = "fbm-sniper-data"
$PORT = "3340"
$DATA_DIR = "/app/data"
$CHROME_CACHE_DIR = "/app/chrome-cache"

if ($DockerHost) {
    $env:DOCKER_HOST = $DockerHost
    Write-Host "→ Using remote Docker host: $DockerHost"
}

Write-Host "→ Pulling latest code from git..."
git pull origin main

Write-Host "→ Rebuilding image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

Write-Host "→ Stopping old container..."
docker stop "$CONTAINER_NAME" 2>&1 | Out-Null
docker rm "$CONTAINER_NAME" 2>&1 | Out-Null

Write-Host "→ Starting updated container..."
docker run -d `
  --name "$CONTAINER_NAME" `
  -p "${PORT}:3340" `
  -v "${VOLUME_NAME}:${DATA_DIR}" `
  -e FBM_DATA_DIR="${DATA_DIR}" `
  -e PUPPETEER_CACHE_DIR="${CHROME_CACHE_DIR}" `
  --restart unless-stopped `
  "$IMAGE_NAME"

Write-Host "→ Waiting for health check..."
for ($i = 1; $i -le 30; $i++) {
    $STATUS = (docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>$null).Trim()
    if ($STATUS -eq "healthy") {
        Write-Host "✓ Update complete! Container is healthy."
        Write-Host "  URL: http://localhost:${PORT}"
        exit 0
    }
    Start-Sleep -Seconds 2
}

Write-Host "✗ Health check timed out. Check logs:"
docker logs --tail 20 "$CONTAINER_NAME"
exit 1
