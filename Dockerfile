# Build stage: production dependencies only
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Runtime image
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4319
ENV HOST=0.0.0.0
# Dokploy / Hostinger: DATABASE_URL is injected by Dokploy or .env.
# If it is set and the database will not answer, the process exits instead of
# serving synthetic fixtures on a live URL (ALLOW_FIXTURE_FALLBACK=1 overrides).
ENV DATABASE_URL=""
ENV DATA_DIR=/app/data

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server.mjs ./
COPY server.pg.mjs ./
COPY src ./src
COPY migrate.mjs ./
COPY gen-ledger.mjs ./
COPY public ./public
COPY data ./data
COPY postgres-schema.sql ./
COPY README.md ./
COPY DESIGN.md ./

# Writable data directory for fixture-mode registrations; the app runs as `node`.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 4319

# Readiness, not liveness: /api/health checks the store, /api/meta does not.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:'+(process.env.PORT||4319)+'/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.mjs"]
