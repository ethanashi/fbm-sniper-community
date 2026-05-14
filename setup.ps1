# setup.ps1 — Build and start the fbm-sniper container from scratch
# Usage: .\setup.ps1 [-DockerHost <host>]
#
# Examples:
#   .\setup.ps1                          # Local Docker
#   .\setup.ps1 -DockerHost tcp://10.1.1.122:2375   # Remote Docker on VM

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

Write-Host "→ Building image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

Write-Host "→ Ensuring volume exists: $VOLUME_NAME"
docker volume create "$VOLUME_NAME" 2>&1 | Out-Null

Write-Host "→ Stopping old container (if any)..."
docker stop "$CONTAINER_NAME" 2>&1 | Out-Null
docker rm "$CONTAINER_NAME" 2>&1 | Out-Null

Write-Host "→ Starting container: $CONTAINER_NAME"
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
        Write-Host "✓ Container is healthy!"
        Write-Host "  URL: http://localhost:${PORT}"
        Write-Host "  GeoIP test: curl http://localhost:${PORT}/api/geoip"
        exit 0
    }
    Start-Sleep -Seconds 2
}

Write-Host "✗ Health check timed out. Check logs:"
docker logs --tail 20 "$CONTAINER_NAME"
exit 1
