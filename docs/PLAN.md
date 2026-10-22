# Clinical R&D Forecasting Environment — Build Plan v2

Supersedes v1. v1 was organised around a "readout oracle" (will this trial succeed / will this NDA be
approved). Following the red-team, the product is reorganised around the **evidence dossier and design
stress-test**, with forecasting as one output among several. The oracle framing is demoted because it is
hard to validate, legally exposed, and not what the stated users actually need.

Companions: `RED_TEAM.md` (v2), `dojozero_clone/CLONE_FINDINGS.md` (verified source-platform facts).

---

## 1. Positioning

**Is:** a B2B research environment where R&D teams, VCs and biotech diligence teams stress-test protocols,
study designs and pitches against a panel of LLM analysts whose claims must be grounded in retrievable
public evidence; every projection is pre-registered, timestamped and later scored.

**Is not:** clinical decision support, a diagnostic, a validated clinical predictor, investment advice, or a
real-money market. Those exclusions are contractual and product-enforced, not just disclaimers.

Three user jobs, in priority order:

1. **Design review** — where is this protocol weak, and what does the literature say about the specific
   choices (endpoint, comparator, population, sample size, duration)?
2. **Scenario comparison** — same asset, different assumptions; what changes the conclusion?
3. **Calibrated projection** — a probability with uncertainty, benchmarked against the historical base rate
   for that phase/indication/design, scored after readout.

The wedge is job 1. Jobs 2–3 are what make it a platform rather than a checklist.

## 2. Source platform: what is cloned vs specified

Verified from live capture (see CLONE_FINDINGS): hash-routed SPA, `main.js` at
`g.alicdn.com/qwenx/dojoZero/0.0.22`, endpoints `/api/landing` and `/api/leaderboard`, 96 agents,
personas × model roster, separate market and forecast scoreboards, per-action `trigger` field.

| Layer | Decision |
|---|---|
| Client shell, route shape, card/leaderboard patterns | rebuild in the same shape (original code, no assets) |
| Read API contracts | adapt (programs/trials instead of games; dossiers instead of bets) |
| Agent arena + persona roster + `trigger`-driven feed | reuse the pattern; triggers become catalysts (enrolment, DSMB, AdCom, readout) |
| Scoring split (market vs forecast) | reuse; forecast scoring becomes Brier/log-loss/calibration |
| Write APIs, scheduler, prompts, scoring formulas, server runtime | **not observable** — specified fresh, not cloned |

## 3. Product surface

| Surface | Content | Purpose |
|---|---|---|
| **Program registry** | indication, phase, sponsor, endpoint, comparator, N, duration, readout window, base rate | the object everything attaches to |
| **Design dossier** | structured critique: endpoint validity, comparator choice, population, power, operational risk; each finding cites evidence with a supporting span | the wedge |
| **Panel projection** | per-analyst probability + rationale + cited evidence; aggregate with uncertainty; base-rate delta | job 3 |
| **Evidence ledger** | claim → source id → verifying span → entailment status (supported / partial / contradicted / not found) | makes citations auditable |
| **Pre-registration** | SHA-256 over payload + UTC timestamp, immutable entry | makes accuracy falsifiable |
| **Calibration board** | Brier, log loss, calibration slope, coverage, n, by therapeutic area | the moat |
| **Method/about** | scoring rules, model roster, limitations, licences | trust |

## 4. Stack (concrete components)

| Layer | Component | Licence | Role |
|---|---|---|---|
| Skills / domain tools | [K-Dense `scientific-agent-skills`](https://github.com/K-Dense-AI/scientific-agent-skills) | MIT | 177 skills + DB connectors: variant, pathway, chemistry, clinical-research helpers |
| Orchestration reference | [`k-dense-byok`](https://github.com/K-Dense-AI/k-dense-byok) | MIT | local-first multi-model runner (LiteLLM/ADK/MCP), BYOK |
| Methodology | [`science-superpowers`](https://github.com/K-Dense-AI/science-superpowers) | NOASSERTION → verify before reuse | pre-registration-over-TDD discipline for the ledger |
| Writing | [`claude-scientific-writer`](https://github.com/K-Dense-AI/claude-scientific-writer) | MIT | dossier rendering |
| Evidence agent | [Feynman](https://www.feynman.is/) ([repo](https://github.com/Companion-Inc/feynman)) | MIT | `/lit`, `/review`, `/audit`, `/compare`; Semantic Scholar, OpenAlex, PubMed, Europe PMC, bioRxiv/medRxiv, Crossref; claim→source links |
| Skill discovery | [Awesome-Scientific-Skills](https://github.com/InternScience/Awesome-Scientific-Skills) | MIT | catalogue only; curation ≠ validation |
| Arena / scoreboard | rebuilt (this repo) | original | routes, dossier UX, ledger, calibration |

Rules: retain MIT/Apache notices; do not reuse NOASSERTION/unlicensed code without permission; do not use
upstream names as branding; treat the Awesome list as discovery, never as evidence.

## 5. Engine pipeline

```
program record ──▶ retrieval (Feynman /lit /compare over PubMed, Europe PMC, OpenAlex, Crossref)
                        │
                        ├─▶ claim extraction ──▶ span-level entailment check
                        │        └─✗ unsupported → dropped or flagged "not found"
                        ▼
              evidence pack (claims + sources + spans + status)
                        │
                        ▼
        analyst panel (N personas × M models, K-Dense skills for domain checks)
                        │  per-analyst: probability, rationale, citations, confidence
                        ▼
        aggregation (trimmed mean + spread; base-rate anchor; disagreement reported)
                        │
                        ▼
        design critique (endpoint/comparator/population/power/operational findings)
                        │
                        ▼
        pre-register (hash + timestamp) ──▶ ledger
                        │
                        ▼
        resolution at readout ──▶ Brier / log loss / calibration / coverage
```

Non-negotiables: no uncited assertion in a dossier; every citation carries a span and an entailment status;
the projection is hashed before the readout is known; the base-rate benchmark is displayed next to the panel
number, always.

## 6. Phases (rewritten)

### Phase 0 — Boundaries and harness (weeks 1–2)
- claim-boundary copy deck (legal sign-off), prohibited-use list in ToS
- synthetic program fixtures + seeded panel + ledger (so the UI and scoring exist before any model call)
- calibration harness: Brier, log loss, reliability curve, base-rate delta
- exit: a dossier can be generated end-to-end on fixtures, deterministically

### Phase 1 — Evidence layer (weeks 3–6)
- Feynman integration for retrieval; claim extraction; span-level entailment
- source registry with stable identifiers (PMID/DOI/NCT); deduplication; retraction check
- evidence status taxonomy; "not found" is a first-class result
- exit: ≥95% of dossier claims carry a verified span or an explicit not-found flag

### Phase 2 — Panel and benchmark (weeks 7–10)
- analyst personas (skeptic, statistician, clinician, regulator, operator) × model roster
- prompt contracts: adversarial, anti-sycophancy, forced base-rate comparison, explicit uncertainty
- aggregation + disagreement reporting; skill-based domain checks via K-Dense
- exit: panel beats base rate out-of-sample on ≥100 historical programmes (or the product repositions to
  critique-only, honestly)

### Phase 3 — Product surface (weeks 11–14)
- registry, dossier, projection, evidence ledger, calibration board, pre-registration
- trigger feed (enrolment update, DSMB, AdCom, readout) with per-item provenance
- exit: a design review is produced in <10 minutes; every number traceable to a source

### Phase 4 — Hardening and pilots (weeks 15–18)
- sandboxed skill execution, tool allowlist, prompt-injection regression suite
- tenant isolation, no-training-on-customer-data guarantees, private deployment option
- MNPI controls: no cross-tenant visibility, no trading linkage, audit trail
- 3–5 pilot accounts (2 VC, 2 biotech, 1 pharma R&D)
- exit: security review passed; pilots produce dossiers they would pay for

## 7. Scoring and validation

- **Forecast:** Brier score, log loss, reliability curve, calibration slope/intercept, n, by area.
- **Benchmark:** historical base rate for phase × indication × design class. Panel must beat it, with CI.
- **Coverage:** share of claims with verified spans; share of dossiers with no unsupported assertion.
- **Design value:** pilot rubric — would the team change the protocol? (leading indicator, not accuracy).
- **Never** report accuracy without n, uncertainty, and the base rate beside it.

## 8. Security and governance

- treat retrieved documents as hostile input; strip instructions; tool allowlist; sandbox skills; no network
  from skill sandboxes
- per-tenant encryption and isolation; provider no-retention/no-training terms; deletion on schedule
- MNPI: contractual prohibition, technical isolation, no brokerage integration, no "buy/sell" output
- claims: no patient-outcome language; programme/asset-level scoring only; no named-individual scoring
- publication: probabilistic framing, methodology first, right-of-reply and corrections policy

## 9. Commercial sequencing

1. design-review pilots (biotech + VC) → reference dossiers
2. consortium subscriptions (academic/translational centres)
3. pharma R&D private deployment
4. data/insight licensing last (highest exposure)

Pricing indicative: VC $15–40k/seat/yr; biotech $10–30k/yr; pharma pilot $150k+; CRO white-label rev-share.

Portfolio fit: `regsignal.aeah.ai` (catalysts) → triggers; `curebiology.com` (community) → protocols and
expert review; `pharmaterminal` (training) → onboarding; dojo = forecast + accountability layer.

## 10. REA integration (verified workflow)

`capture_browser_scenario` for live targets (artifact tools do not apply to an SPA), then
`export_evidence_bundle`. Reuse for regression: capture the built app's routes and diff against the intended
IA; capture upstream pages only to verify licences/claims, never to copy assets.

## 11. Gates

| Gate | Condition |
|---|---|
| G1 integrity | pre-registration hash + timestamp before readout |
| G2 calibration | beats base rate on ≥100 resolved forecasts, CI reported |
| G3 evidence | span-level entailment; no uncited assertion |
| G4 security | injection regression suite + sandbox + tenant isolation |
| G5 MNPI | prohibition + isolation + audit, no trading linkage |
| G6 claims | legal sign-off against the claim deck |

## 12. Immediate next actions

1. build the prototype shell (registry → dossier → projection → ledger → calibration) on fixtures
2. wire the calibration harness to the ledger
3. stand up Feynman retrieval in a spike; measure claim-entailment rate on 20 real programmes
4. legal review of claim deck and prohibited-use list
5. recruit 2 design-partner teams (1 biotech, 1 VC) for dossier feedback
