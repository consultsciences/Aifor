# Clinical R&D Forecasting Environment — prototype

Evidence-first design review for clinical programmes: registry → dossier → panel projection →
pre-registration → calibration.

**Prototype on synthetic fixtures.** Research use only. Not medical, regulatory or investment advice.
No patient-level data. Every fixture record is labelled `fixture`/`synthetic`.

## Run

```bash
node server.mjs                     # http://127.0.0.1:4319, fixtures, no dependencies needed
PORT=4400 node server.mjs           # different port
npm test                            # 44 tests: scoring, hashing, dossier, divergence, API
```

Node 22+ (ESM, top-level await). Fixture mode needs no database and no network calls. The only
runtime dependency (`pg`) is imported lazily, so it is required only when `DATABASE_URL` is set.

There is one server. `server.pg.mjs` is a three-line shim that starts `server.mjs`, kept so an existing
Dokploy service pointing at it keeps working.

## Deployment (Dokploy / Hostinger VPS, PostgreSQL)

- **`Dockerfile`** — multi-stage Node 22-alpine, non-root, `HEALTHCHECK` on `/api/health`.
- **`docker-compose.yml`** — app + `postgres:16-alpine`, named volume, `DB_PASSWORD` required,
  database not published on the host.
- **`migrate.mjs`** — applies `postgres-schema.sql` and loads every fixture table. Idempotent.
- **`env.example`** — copy and fill.

```bash
DATABASE_URL=postgresql://… node migrate.mjs     # once, before first use
DATABASE_URL=postgresql://… node server.mjs
```

If `DATABASE_URL` is set and the database will not answer, the process **exits** rather than serving
fixtures on a live URL (`ALLOW_FIXTURE_FALLBACK=1` re-enables the old behaviour for a throwaway demo).
`/api/meta` reports `mode: "database" | "fixture"`, and the UI banner reads it.

See [`dokploy/README.md`](dokploy/README.md) for the step-by-step.

Regenerate the synthetic resolved-forecast ledger: `node gen-ledger.mjs`.

## Routes

| Route | What |
|---|---|
| `#/` | programme registry with area filter and search |
| `#/program/:id` | dossier: design findings, analyst panel, evidence ledger, projection, pre-register |
| `#/calibration` | Brier, log loss, base-rate baseline, skill, per-model table, reliability curve |
| `#/divergence` | rubric matrix: which models raise which design issue, per cell |
| `#/ledger` | pre-registered projections, newest first, with per-row hash verification |
| `#/method` | method, limits, licences |

## API

| Method + path | Returns |
|---|---|
| `GET /api/health` | `{ok, mode}` — checks the store, not just the process |
| `GET /api/meta` | name, version, mode, dbConnected, models, personas, disclaimer |
| `GET /api/programs` | registry summaries |
| `GET /api/programs/:id` | programme + findings + analysts + evidence + projection + existing `registration` |
| `POST /api/preregister` `{programId}` | `201` when created, `200` + `duplicate: true` when that forecast is already locked |
| `GET /api/registrations?programId&limit` | `{entries, total, limit}` |
| `GET /api/registrations/:id` | one registration |
| `GET /api/registrations/:id/verify` | recomputes the hash from stored fields: `{valid, scheme, hash, recomputedHash}` |
| `GET /api/calibration` | scores over resolved rows, including `baselineBrier` and `skill` |
| `GET /api/divergence` | rubric cells × per-model raise/not-raise |

Errors: `400` malformed input, `404` unknown id, `405` wrong method, `413` body over 64 KB, `500` for
genuine faults only (logged server-side, not reflected to the client).

## Scoring

- **Brier** — mean squared error of the probability.
- **Log loss** — clipped at 1e-6.
- **Base-rate baseline** — `mean((base_rate - outcome)²)`, i.e. what a forecast that simply quotes the
  reference class would have scored on the same rows.
- **Skill** — `baselineBrier - brier`. Positive means the panel beat the reference class; zero means it
  added nothing; negative means it was worse.
- **Calibration gap** — mean predicted − observed.
- **Reliability** — five fixed bins; bar = mean forecast, tick = observed rate.

Proof over assertion: on the fixture ledger the panel's Brier is **0.2369** against a base-rate baseline
of **0.2357**, so skill is **−0.0012**. The fixture board demonstrates the arithmetic; it does not
demonstrate model skill. The fixture outcomes are drawn from a process centred on each programme's base
rate, with a per-model bias injected, so the ordering on the calibration page reflects that bias. The
page says so.

## Pre-registration

The hash is SHA-256 over canonical JSON (sorted keys) of `{programId, projection, evidenceIds}` —
timestamp excluded. Consequences:

- the same forecast locked twice is reported as a duplicate, not minted as a second record
  (`UNIQUE (program_id, hash)` in PostgreSQL);
- any client can recompute the hash from what was stored — `GET /api/registrations/:id/verify` does
  exactly that, which matters because `jsonb` reorders keys on read-back;
- records sealed by the v0.1 code (timestamp inside a non-canonical string) still verify under
  `scheme: "legacy-v1"` and are labelled as such.

The ledger is append-only: no update or delete route exists, and the file backend writes the whole
array — the earlier `slice(0, 200)` silently dropped the oldest records at restart.

## Data model

`data/programs.json`
- `program`: id, title, sponsor, area, phase, indication, endpoint, comparator, n, durationMonths,
  readoutWindow, baseRate `{value, class, source}`, summary
- `designFlags[]`: id, **cell** (rubric cell for the divergence map), severity (`high|medium|low`),
  title, detail, evidenceIds
- `evidence[]`: id, claim, source, span, status (`supported|partial|contradicted|not_found`), synthetic

`data/panel.json`: models + analyst personas (lens, bias, rationale templates).
`data/ledger.json`: resolved forecasts — model, persona, p, outcome, base_rate, resolved_at.
`data/registrations.json`: written at runtime (gitignored); delete it to reset the ledger.

In PostgreSQL, `design_flags.id` is stored qualified as `<program_id>:<flag_id>` because fixture flag
ids (`f1`, `f2`, `f3`) repeat across programmes.

## Projection logic (deliberately simple)

Six persona × model analysts produce a probability from the reference-class base rate plus a seeded
persona bias and noise (deterministic per programme id). Aggregate is a trimmed mean; the interval is the
trimmed range, not a confidence interval; disagreement is the standard deviation across analysts.
Rationales are templates with the programme's own endpoint, n and base rate substituted, plus citation ids.

This is a stand-in for the real panel, kept deterministic so the UI, pre-registration and scoring could be
built and reviewed before any model is wired in.

Divergence attribution is likewise a fixture: a deterministic seeded draw per (programme, flag, model),
weighted by severity. A cell can read `0/6` — no flag is promoted to look contested.

## Visual language

`DESIGN.md` (root) is an IBM Carbon spec written for this app's data surfaces — tables, status chips,
heat cells, hash blocks — and lints clean (`npm run design:lint`: 0 errors, 0 warnings). Exports:
`tailwind.theme.json` (Tailwind theme) and `tokens.json` (W3C DTCG). Fonts are self-hosted IBM Plex
(SIL OFL 1.1, `public/fonts/OFL.txt`); the app makes no third-party requests at runtime.

## What is intentionally not here

- no model calls, no retrieval, no patient data, no auth, no multi-tenancy
- no investment or clinical recommendations, and no real-money mechanics
- no claim that synthetic scores mean anything about real performance

## Integration points (next)

1. replace `buildDossier()`'s seeded panel with a real orchestration call (K-Dense `k-dense-byok` pattern)
2. replace fixture evidence with Feynman `/lit` + `/compare` retrieval; add span-level entailment before a
   claim can be `supported`
3. add auth, tenant isolation and a per-tenant store before any pilot data touches it
4. keep pre-registration immutable — append-only, no edits after creation
