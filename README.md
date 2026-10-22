# Clinical R&D Forecasting Environment — prototype

Evidence-first design review for clinical programmes. Built as the Phase 3 surface described in
[`docs/PLAN.md`](docs/PLAN.md): registry → dossier → panel projection → pre-registration → calibration.

**Prototype on synthetic fixtures.** Research use only. Not medical, regulatory or investment advice.
No patient-level data. Every fixture record is labelled `fixture`/`synthetic`.

## Run

```bash
node server.mjs            # http://127.0.0.1:4319
PORT=4400 node server.mjs  # different port
```

No dependencies, no build step, no network calls. Node 18+ (ESM, top-level await).

Regenerate the synthetic resolved-forecast ledger:

```bash
node gen-ledger.mjs
```

## Routes

| Route | What |
|---|---|
| `#/` | programme registry with area filter and search |
| `#/program/:id` | dossier: design findings, analyst panel, evidence ledger, projection, pre-register |
| `#/calibration` | Brier, log loss, calibration gap, per-model table, reliability curve |
| `#/ledger` | pre-registered projections, newest first |
| `#/method` | method, limits, licences |

## API

| Method + path | Returns |
|---|---|
| `GET /api/programs` | registry summaries |
| `GET /api/programs/:id` | programme + findings + analysts + evidence + projection |
| `POST /api/preregister` `{programId}` | SHA-256 over projection + evidence ids + timestamp; persists |
| `GET /api/registrations` | last 50 registrations |
| `GET /api/calibration` | scores computed from `data/ledger.json` |
| `GET /api/meta` | models, personas, disclaimer |

## Data model

`data/programs.json`
- `program`: id, title, sponsor, area, phase, indication, endpoint, comparator, n, durationMonths,
  readoutWindow, baseRate `{value, class, source}`, summary
- `designFlags[]`: id, severity (`high|medium|low`), title, detail, evidenceIds
- `evidence[]`: id, claim, source, span, status (`supported|partial|contradicted|not_found`), synthetic

`data/panel.json`: models + analyst personas (lens, bias, rationale templates).
`data/ledger.json`: resolved forecasts — model, persona, p, outcome, base_rate, resolved_at.
`data/registrations.json`: written at runtime; safe to delete to reset the ledger.

## Projection logic (deliberately simple)

Per programme, six persona×model analysts produce a probability from the reference-class base rate plus a
seeded persona bias and noise (deterministic per programme id). Aggregate is a trimmed mean; the interval is
the trimmed range, not a confidence interval; disagreement is the standard deviation across analysts.
Rationales are templates with the programme's own endpoint, n and base rate substituted, plus citation ids.

This is a **stand-in for the real panel**, kept deterministic so the UI, pre-registration and scoring can be
built and reviewed before any model is wired in.

## Scoring

- Brier: mean squared error of probability
- Log loss: clipped at 1e-6
- Calibration gap: mean predicted − observed
- Reliability: five fixed bins; bar = mean forecast, tick = observed rate
- Base-rate comparison is carried on every ledger row so a panel can be checked against the naive baseline

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
