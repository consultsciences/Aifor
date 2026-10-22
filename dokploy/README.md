# Dokploy deployment notes — clinical-dojo

PostgreSQL + Docker deployment path. One entrypoint (`server.mjs`); `server.pg.mjs` is a shim that starts
it, so an existing service stays valid.

## Dokploy setup (Hostinger VPS)

1. **Create the PostgreSQL service** (Dokploy UI → Database → PostgreSQL 16).
   - Service name `postgres` (must match `DB_HOST`).
   - Database `clinical` (`DB_NAME`), user `postgres`, and a real password — `DB_PASSWORD` has no default.
   - Note the connection string Dokploy prints; use it as `DATABASE_URL`.

2. **Create the app service** (App → Create App):
   - Source `git@github.com:consultsciences/Aifor`, branch `main`, root directory `.`, build = Dockerfile.
   - Port mapping `4319:4319`.
   - Environment: `DATABASE_URL`, `NODE_ENV=production`, `HOST=0.0.0.0`, `DATA_DIR=/app/data`.
   - Health check path `/api/health` (checks the store; `/api/meta` only checks the process).

3. **Persistence**: PostgreSQL keeps the ledger in `pgdata`. Fixture-mode `data/registrations.json` is
   runtime-only and gitignored; a container rebuild discards it, which is why the database path exists.

## Migration (once, before the first user)

```bash
# Dokploy UI → app → console
DATABASE_URL="<dokploy connection string>" node migrate.mjs
```

`migrate.mjs` applies `postgres-schema.sql` (the single source of truth) and then loads personas, models,
programmes, evidence, design flags (with their rubric cell), the ledger and any registrations present in
`data/`. It is idempotent and prints row counts — compare them to the fixture files before going live:

```
rows in database: { programs: 6, evidence: 25, design_flags: 18, personas: 6, models: 6, ledger: 144, registrations: 0 }
```

If `design_flags` comes back with `cell = NULL` rows the migration warns: those flags will not appear in
`/api/divergence`.

## Behaviour when the database is down

If `DATABASE_URL` is set and the connection fails, the process exits with a non-zero status and the
container restarts — it does **not** serve synthetic fixtures on a live URL. `ALLOW_FIXTURE_FALLBACK=1`
restores the old behaviour for a demo, and `/api/meta` will then report `mode: "fixture"` so the banner
says so.

## Security / compliance (production checklist)

Re-check `docs/RED_TEAM.md` gates before exposing to pilot users:
- [G2] No real patient-level data — fixtures or aggregated evidence only.
- [G3] Auth / multi-tenancy — add before any external data. Every write route is currently open.
- [G4] MNPI / MAR firewall — no trading links, no real-time trading data.
- [G5] EU AI Act Art. 50 disclosure — `/api/meta` returns `mode`/`fixture: true`; the banner in
  `public/index.html` is driven from it.
- [G6] Audit / pre-registration — `registrations` is append-only, `UNIQUE (program_id, hash)`, and
  `/api/registrations/:id/verify` recomputes each hash.

The database port is not published by the compose file. If you expose it, put a firewall rule in front of
it — the default credentials in `env.example` are placeholders, not a working configuration.

## Operations

- Restart: Dokploy restarts on non-zero exit; `SIGTERM` closes the HTTP server and the pool.
- Logs: stdout (`store: postgresql|fixtures`, one line on boot), plus `unhandled error on …` for 500s.
- Health: `GET /api/health` → `{ok: true, mode: "database"}`.
- Backup: `pg_dump "$DATABASE_URL"` on a schedule; fixtures are reproducible with `node gen-ledger.mjs`.
- Verify the ledger after any restore: `GET /api/registrations/:id/verify` for a sample of ids.
