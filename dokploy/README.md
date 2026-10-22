# Dokploy deployment notes — clinical-dojo

This is the PostgreSQL + Docker deployment path for the clinical R&D forecasting environment. The fixture-based `server.mjs` remains the default; `server.mjs.pg` activates PostgreSQL when `DATABASE_URL` is set (see `Dockerfile`).

## Dokploy setup (Hostinger VPS with Dokploy interface)

1. **Create PostgreSQL service** (Dokploy UI: Database → PostgreSQL 16).
   - Service name: `postgres` (must match `DB_HOST` in `.env`).
   - Database: `clinical` (`DB_NAME`).
   - Note the connection string shown by Dokploy; copy into `.env` and `DATABASE_URL`.

2. **Create App service** (App → Create App):
   - Source: `git@github.com:consultsciences/Aifor` (public repository created earlier).
   - Branch: `main`.
   - Root directory: `.` (repo root; the Dockerfile is at root).
   - Build: Dockerfile (default).
   - Port mapping: `4319:4319` (`APP_PORT:4319` in `.env`).
   - Environment: set `DATABASE_URL` to the Dokploy-provided connection string; add `NODE_ENV=production`, `HOST=0.0.0.0`.

3. **Volume / persistence**:
   - Dokploy handles persistent volumes via its interface. For fixtures mode (no DB), the image includes fixtures; `data/registrations.json` is runtime-only and should either be excluded (current `.gitignore`) or backed to the DB after `migrate.mjs`.

## Migration path (fixtures → PostgreSQL)

Before the first user-facing session on the deployed instance, run the migration (once):

```bash
# Inside the Dokploy container (Dokploy UI → app → console / exec):
DATABASE_URL="<dokploy-provided-string>" node migrate.mjs
```

`migrate.mjs` reads `data/*.json` fixtures and writes to the connected PostgreSQL instance. It is idempotent (`ON CONFLICT DO NOTHING`). If fixtures change, re-run.

If `DATABASE_URL` is not set at runtime, the app falls back to fixtures mode (same behaviour as local `node server.mjs`). The `Dockerfile` defaults to fixtures mode (`DATABASE_URL` empty), so the app always starts safely even before the DB service is reachable.

## Security / compliance (production checklist)

Re-check `RED_TEAM.md` gates before exposing to pilot users:
- [G2] No real patient-level data — fixtures or aggregated evidence only.
- [G3] Auth / multi-tenancy — add before any external data.
- [G4] MNPI / MAR firewall — no trading links, no real-time trading data.
- [G5] EU AI Act Art. 50 disclosure — `/api/meta` already returns `fixture: true`; add visible banner in production.
- [G6] Audit / pre-registration hash kept immutable — `registrations` table is append-only.

## Operations

- Restart: Dokploy handles container restarts on exit 1.
- Logs: `console.log` output; use Dokploy's log view.
- Health check: `/api/meta` used by `Dockerfile` HEALTHCHECK.
- Backup: dump PostgreSQL via Dokploy or `pg_dump` pointing at `DATABASE_URL`; fixtures are reproducible (re-run `node gen-ledger.mjs`).
