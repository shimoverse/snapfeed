# ─────────────────────────────────────────────────────────────────────────────
# snapfeed self-hosted worker — multi-stage Docker build
#
# Stage 1 (builder):  install all deps, build dist/ via tsup
# Stage 2 (runtime):  copy dist/, production node_modules, and docker/worker.cjs
#                     run as the non-root `node` user
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install full deps (including dev deps for the build).
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build.
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# Re-install with production deps only, into a clean prefix we can copy from.
RUN rm -rf node_modules && npm ci --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# curl is needed for the HEALTHCHECK; tini gives us a proper init for PID 1.
RUN apk add --no-cache curl tini

WORKDIR /app

# Copy production artifacts from the builder.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Copy the worker entrypoint (plain JS — no compile step at runtime).
COPY docker/worker.cjs ./docker/worker.cjs

# Data dirs the worker writes to (audit log, file uploads).
RUN mkdir -p /data/audit /data/uploads \
    && chown -R node:node /data /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8787/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "docker/worker.cjs"]
