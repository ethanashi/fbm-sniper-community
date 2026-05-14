FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency manifests first (layer caching)
COPY package*.json ./

# Install dependencies (including devDependencies for ensure-browser.mjs)
RUN npm ci

# Copy source code
COPY server.cjs electron.cjs ./
COPY lib/ ./lib/
COPY ui/ ./ui/

FROM node:20-slim

# Install runtime dependencies (Chromium libraries needed by Puppeteer on first run)
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy node_modules and source from builder (no Chrome bundled)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/ui ./ui
COPY --from=builder /app/server.cjs ./
COPY --from=builder /app/electron.cjs ./

# Ensure Chrome cache dir exists (Chrome will be downloaded on first run)
RUN mkdir -p /app/chrome-cache

# Environment variables
ENV NODE_ENV=production
ENV FBM_DATA_DIR=/app/data
ENV PUPPETEER_CACHE_DIR=/app/chrome-cache
ENV PORT=3340

# Create data directory (volume mount point)
RUN mkdir -p /app/data && chown -R node:node /app/data /app/chrome-cache

# Switch to non-root user
USER node

# Expose the UI port
EXPOSE 3340

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3340/health || exit 1

# Run the server
CMD ["node", "server.cjs"]
