# Build stage: install dependencies
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Runtime image
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4319
ENV HOST=0.0.0.0
# Dokploy / Hostinger: DATABASE_URL is injected by Dokploy or .env; leave open.
ENV DATABASE_URL=""

COPY --from=build /app/node_modules ./node_modules
COPY server.mjs server.mjs
COPY server.pg.mjs server.pg.mjs
COPY migrate.mjs migrate.mjs
COPY gen-ledger.mjs gen-ledger.mjs
COPY public ./public
COPY data ./data
COPY docs ./docs
COPY README.md README.md
# Ensure data/ dir exists at runtime; fixture JSONs are part of image for fixtures mode
RUN mkdir -p /app/data

# Security: run as non-root (Dokploy supports container user settings)
USER node

EXPOSE 4319
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "require('node:http').get('http://localhost:4319/api/meta', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.pg.mjs"]
