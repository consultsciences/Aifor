# Red Team v2 — Clinical R&D Forecasting Environment

Supersedes v1. v1 applied the wrong frame: it treated "the subject matter is medicine" as "the data is
health data" and assumed clinical decision-making. For the product actually described — a B2B research and
due-diligence environment where LLM agents project whether trial designs, protocols and programmes can work,
grounded in published evidence — most of v1's GDPR/AI Act conclusions do not hold. Corrections and the
risks that replace them are below.

## 1. Where v1 was wrong

**GDPR.** GDPR governs *personal data*, not subject matter. Trial registries, protocols, publications,
FDA/EMA documents and company pipelines are not personal data, so the core corpus is out of scope. Art. 9
(special category) only bites if patient-level or identifiable health data is processed — which the product
does not need. Art. 22 only covers decisions about a *natural person* with legal or similarly significant
effect; scoring a programme or a company is not that. Calling the product "health-adjacent" was imprecise and
led to a proportionality error.

**EU AI Act.** v1's "likely high-risk" was wrong. High-risk is set by intended purpose (Annex I devices,
Annex III listed uses), not by domain. A programme-level R&D/DD forecasting tool is neither a medical device
nor an Annex III use (creditworthiness, insurance pricing, employment, education, migration, justice,
biometrics). It sits at **minimal risk** with **Art. 50 transparency** duties (disclose AI interaction; mark
AI-generated content where published). Art. 2(6) may even exempt deployments used solely for scientific R&D,
though commercial DD is mixed use — assume in scope, low tier. Note Annex III obligations are already
applying now, which is exactly why the classification matters: had this been high-risk, conformity work
would be overdue, not optional.

**MDR/SaMD.** Not a device while the intended purpose is research and investment diligence. The boundary is
the claim, not the technology.

So: the compliance load is ordinary B2B SaaS plus claim discipline, not a health-data regime. v1's DPIA-heavy
posture was over-engineered for this scope.

## 2. What still applies — and the narrow ways health re-enters

| Regime | Status | Trigger that changes it |
|---|---|---|
| GDPR (ordinary) | Applies to accounts, logs, uploaded plans | customer uploads patient-level data → you become Art. 9 **processor**; named-person scoring → Art. 22 exposure |
| AI Act | Minimal risk + Art. 50 | clinical decision support, patient triage, individual credit/insurance/employment scoring |
| MDR | Out of scope | any claim of diagnosis, prognosis of a patient, or treatment selection |
| Securities / MAR | **Applies and is the top legal risk** | platform carries MNPI; outputs function as investment recommendations; users trade on them |
| Contract/tort | Applies | public negative forecasts about named sponsors; reliance without warranty |
| Gambling | Out of scope | any real-money staking on outcomes |

Realistic health-data entry points, worth policing rather than fearing: (a) customers uploading their own
patient-level trial data "just to test the design"; (b) building analyst scores of named investigators/KOLs;
(c) drifting into eligibility or dose guidance. Each is a product-boundary decision, not an inevitability.

## 3. The stack — verified facts

| Component | What it is | Licence | What it buys |
|---|---|---|---|
| [K-Dense `scientific-agent-skills`](https://github.com/K-Dense-AI/scientific-agent-skills) | 177 skills + 100+ scientific DB connectors; repo claims 250k+ users | MIT | domain tool layer (genomics, chem, clinical research, drug discovery) |
| [`k-dense-byok`](https://github.com/K-Dense-AI/k-dense-byok) | desktop co-scientist, local-first, BYOK, LiteLLM/Google ADK/MCP | MIT | reference architecture for multi-model orchestration |
| [`science-superpowers`](https://github.com/K-Dense-AI/science-superpowers) | methodology skills, "pre-registration over TDD" | **NOASSERTION** — read LICENSE before reuse | directly supports prediction pre-registration |
| [`claude-scientific-writer`](https://github.com/K-Dense-AI/claude-scientific-writer) | scientific writing agent | MIT | dossier/report generation |
| [Feynman](https://www.feynman.is/) ([repo](https://github.com/Companion-Inc/feynman)) | open-source research agent; `/lit`, `/review`, `/audit`, `/replicate`, `/compare`; Semantic Scholar, OpenAlex, PubMed, Europe PMC, bioRxiv/medRxiv, Crossref; claims link to sources | MIT | the evidence-grounding and citation layer |
| [Awesome-Scientific-Skills](https://github.com/InternScience/Awesome-Scientific-Skills) | curated skill catalogue | MIT | discovery only — curation ≠ validation |

Consequences:
- **Licensing is mostly solved.** MIT/Apache-2.0 code is reusable with notice retention. Exceptions:
  `science-superpowers` (NOASSERTION) and unlicensed repos such as `rowan-autosearch` (no licence = all
  rights reserved). Do not reuse those without permission, and do not use project names/marks as branding.
- **Hosted apps ≠ repos.** Reverse-engineering k-dense.ai/feynman.is web surfaces is unnecessary when the
  engines are open source; scraping the hosted products adds ToS risk for little gain.
- The architecture is now credible: DojoZero-style arena/leaderboard + Feynman-style grounded retrieval +
  K-Dense skill execution + pre-registered ledgers.

## 4. Re-ranked risk register (what actually kills this)

| # | Risk | Severity | Why it dominates |
|---|---|---|---|
| 1 | **MNPI / insider dealing** | Critical | a biotech uploads an unreleased protocol; a fund user sees or trades on the projection. Tipper/tippee and MAR exposure, plus market-abuse optics. No GDPR control fixes this |
| 2 | **Prompt injection → tool execution** | Critical | 100+ DB connectors, MCP servers and PDF ingestion form an injection-to-action path; a hostile paper can instruct an agent |
| 3 | **Unfalsifiable forecasts** | High | no pre-registration, no resolution data → accuracy claims are marketing, and DD buyers will discover it |
| 4 | **LLM consensus is fake independence** | High | shared training data means nine models are ~one signal; sycophancy inflates "this will work" |
| 5 | **Contamination / hindsight** | High | backtests on readouts already in the weights measure recall, not prediction |
| 6 | **Citation theatre** | High | DOI present ≠ claim supported; needs entailment checks, not link checks |
| 7 | **Trade-secret exposure** | High | customer protocols are the crown jewels; multi-tenant leakage or provider training on them is fatal commercially |
| 8 | **Defamation / trade libel** | Medium-high | public negative forecasts on named small sponsors invite claims |
| 9 | **Advice regulation** | Medium | personalised investment recommendations pull in MiFID/MAR research rules |
| 10 | GDPR / AI Act | Low | ordinary SaaS + Art. 50, provided boundaries hold |

## 5. Claim boundaries (sentence-level rules)

Safe: "estimated probability that this design reaches its primary endpoint, given published evidence";
"design critique with cited support"; "scenario comparison across assumptions".
Unsafe: "predicts patient outcomes"; "guides treatment"; "validated clinical predictor"; "tells you whether
to invest"; "this company will fail".

Also: no patient-level data ingestion in shared workspaces; no cross-tenant visibility; no trading
integration or order language; scores attach to programmes/assets, never to named individuals.

## 6. Commercialisation, reworked

Wedge: **protocol/design stress-test with an evidence dossier**, not "readout oracle". Lower legal surface,
immediate utility, and it is the stated need ("test our ideas, protocols, study designs, pitches").

| Segment | Offer | ACV (indicative) | Note |
|---|---|---|---|
| VC / hedge fund DD | per-programme dossier + scenario runs | $15–40k/seat/yr | fastest sales; highest MNPI discipline required |
| Biotech | pitch/design review, evidence pack | $10–30k/yr | low ACV, good reference logos |
| Pharma R&D | design optimisation, portfolio scenarios, private deployment | $150k–1M pilot→enterprise | slow procurement, real money |
| CRO / consultancy | white-label analysis | revenue share | distribution without brand risk |

Portfolio fit: `regsignal.aeah.ai` supplies catalyst/regulatory events; `curebiology.com` supplies research
community and protocol expertise; `pharmaterminal` handles training/onboarding; the dojo is the forecast and
accountability layer. Do not duplicate regulatory intelligence or literature search — consume them.

Moat: resolution database + pre-registered ledger + calibration history. Not model access; K-Dense and
Feynman are MIT and will be forked by competitors.

Positioning vs the stack: they provide tools and agents; this provides the arena, the scoreboard, and the
outcome record. Compete on resolution, not on skills.

## 7. Gates

| Gate | Pass condition |
|---|---|
| G1 integrity | prediction hash-timestamped before readout; public ledger |
| G2 calibration | beats reference-class base rates on ≥100 resolved forecasts (Brier/log-loss, with CI) |
| G3 evidence | span-level entailment for every cited claim; no uncited assertions in dossiers |
| G4 security | sandboxed skill execution, tool allowlist, injection regression suite, tenant isolation |
| G5 MNPI | contractual prohibition + technical isolation + audit; no trading linkage |
| G6 claims | legal sign-off on marketing copy against §5 |

## 8. What would change this assessment

- adding patient-level data or clinical decision support → MDR + AI Act high-risk, re-scope entirely
- publishing stock recommendations or integrating brokerage → MiFID/MAR regime
- real-money markets → gambling/derivatives
- selling per-sponsor rankings → conflicts and defamation exposure jump

## 9. Scientific caveat worth stating to customers

The strongest baseline is not another LLM; it is the historical base rate for the phase, indication and
design. If the panel cannot beat that baseline out-of-sample, the honest product is "structured design
critique", not "projection". Publishing that comparison is also the cheapest credibility available.
