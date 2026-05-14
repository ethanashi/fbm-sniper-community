# build.ps1 — Build the fbm-sniper Docker image without starting it
# Usage: .\build.ps1 [-DockerHost <host>]
#
# Examples:
#   .\build.ps1                          # Local Docker
#   .\build.ps1 -DockerHost tcp://10.1.1.122:2375   # Remote Docker on VM

param(
    [string]$DockerHost = $env:DOCKER_HOST
)

# ─── Configuration ───────────────────────────────────────────────────────
$IMAGE_NAME = "fbm-sniper-community:latest"

if ($DockerHost) {
    $env:DOCKER_HOST = $DockerHost
    Write-Host "→ Using remote Docker host: $DockerHost"
}

Write-Host "→ Building image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

Write-Host "✓ Build complete: $IMAGE_NAME"
Write-Host "  Run .\run.ps1 to start the container."
