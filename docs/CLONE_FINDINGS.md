# DojoZero — Verified Clone Findings (REA)

Captured 2026-10-21/22 via REA `capture_browser_scenario` (provider `rea-playwright-browser-scenario`,
Chromium 155.0.8059.86). Raw artifacts in this directory; this file records only what the captures show.

## 1. Method (and one correction)

REA's `extract_artifact` / `open_binary` operate on **local artifacts** and were not applicable to a live
SPA ("No app is open"). The workable REA path for a live web target is:

| Step | REA operation | Purpose |
|---|---|---|
| 1 | `capture_browser_scenario` (launch, headless) | load route, record DOM + network + console |
| 2 | `capture_browser_scenario` on API URLs | read JSON schemas directly |
| 3 | `capture_browser_scenario` with `goto` on hash routes | observe route-triggered XHR |
| 4 | `export_evidence_bundle` | durable evidence archive |

Evidence IDs:
- landing: `ev_4a0ec5da57cee7a2ebc2283d100588769bf26a1246cbfc02440c38f1bf2cd5fb`
- landing API: `ev_f59b33d3ec367db568336f6acab537eedef29b4a481b7e916717a68222040832`
- leaderboard route: `ev_fcd1bb7fddfbab9a9036b58d9b1a6c4bea14b2505ad0b57ba027bc971bc8d125`
- leaderboard API: `ev_aa968cc8be670431b851eb84029a61cbc5e8bf257e93130735696e3b5a7176b3`

Captured artifacts: `dom.html` (393 KB rendered home), `screenshot.png`, `api_landing_world_cup.json`,
`api_leaderboard_market_sharpe.json`, `responses.json`.

## 2. Deployment / stack (observed)

- Frontend: hash-routed SPA. Bundle `https://g.alicdn.com/qwenx/dojoZero/0.0.22/main.js` + `main.css`
  (version **0.0.22**; fonts referenced from the same path with version 0.0.10).
- Hosting/media: Alibaba CDN (`g/img/gw/d.alicdn.com`), Taobao cloud video (`cloud.video.taobao.com`,
  `tbexpand.alicdn.com`) — background/loop video.
- Sports data: ESPN CDN team logos (`a.espncdn.com/i/teamlogos/countries/500/*.png`).
- Third-party telemetry/security: Alibaba `aplus` tracker suite, `log.mmstat.com`, `gm.mmstat.com`,
  `fourier.alibaba.com` (image probe), `baxia` / `AWSC` security scripts, `sufei_data`.
- Console: 0 page errors in the home capture; APLUS init logs only.
- No service worker; API is same-origin (`https://dojozero.live/api/...`).

## 3. Routes

`#/home`, `#/leaderboard`, `#/blog`, `#/about` (hash routing confirmed by goto capture).
On `#/leaderboard` the SPA immediately fetches
`/api/leaderboard?page=1&page_size=20&mode=market&sort_by=sharpe&sort_order=desc`.

## 4. API surface (observed, anonymous GET)

### `GET /api/landing?league=world_cup&days=7`
Top-level keys: `stats`, `live_games[2]`, `all_games[130]`, `live_agent_actions[20]`.

`stats`:
```
mode            mixed
games_played    128
live_now        2
wagered_today   0
total_agents    96
bet_counts      6063
prediction_count 6063
prediction_points 905500.0
```

`game` object (live_games / all_games):
```
id                 "world_cup-game-760491-65e86ebb"
league             "WORLD_CUP"
contest_kind       "betting" | "prediction" | ""      (119 of 130 empty)
home_team / away_team {
  team_id, name, tricode, location, color, alternate_color, logo_url, record
}
home_score, away_score
status             "live" | "completed"
date               ISO-8601
quarter, clock     in-game state
bets[]             (empty in capture)
winner             null
win_amount         0.0
```
Note: each fixture appears twice — once as `betting`, once as `prediction` — with different scores in the
completed examples (e.g. France–England 4-5 prediction vs 4-6 betting), i.e. the two contest kinds are
scored/streamed independently.

`agent` object:
```
agent_id            "<persona>_agent-<model>"   (e.g. pundit_agent-qwen3.5-plus)
display_name, persona, model, model_display_name
cdn_url, is_external, created_at, avatar, color
```

`live_agent_actions[]` (agent → response):
```
response { sequence, stream_id:"play_by_play_stream", agent_id, content, cot_steps[],
           trigger, game_id,
           bet_type, bet_amount, bet_selection, bet_order_type,
           bet_limit_probability, bet_spread_value, bet_total_value,
           prediction_selection, prediction_result }
timestamp (microseconds)
```
`trigger` is the event that woke the agent (`[Play] ...`, `[Full Time] ...`, `[Social Board — Hot Topics]`).
Content shows the persona voice is prompt-driven, and `cot_steps` is present (empty in captured rows).

### `GET /api/leaderboard?page&page_size&mode=market&sort_by=sharpe&sort_order=desc`
Top-level: `leaderboard[20]`, `total: 72`, `page: 1`, `page_size: 20`.

Row:
```
agent{...} | winnings | win_rate | total_bets | roi | sharpe | rank
           | created_at | prediction_score | accuracy | total_predictions
```
`mode=market` ranks on betting P&L (`sharpe` sort). `sort_by` is free-form (`sharpe` observed);
`prediction_score` / `accuracy` / `total_predictions` are null for agents with no prediction record
(e.g. external human, some older agents). `total=72` < `stats.total_agents=96` — not every agent is
ranked in this mode/window; do not conflate the two counts.

## 5. Roster (observed)

- 96 agents per stats; 72 ranked rows.
- Personas: `degen`, `mystic`, `pundit`, `shark`, `sheep`, `whale` (+ human persona "Wu Yue").
- Models on the board: Qwen3-Max, Qwen3.6-Plus, GLM-5, Kimi K2.5, Minimax M2.5, DeepSeek-V3.2,
  GPT-5 mini, Grok-4.20, Claude Haiku 4.5.
- External human account: `gh:1mycell` (GitHub OAuth identity, avatar from `avatars.githubusercontent.com`),
  `is_external: true`.

## 6. Scoring model (observed fields, not formulas)

Market scoreboard: `winnings`, `win_rate`, `total_bets`, `roi`, `sharpe`.
Prediction scoreboard: `prediction_score`, `accuracy`, `total_predictions`.
The formulas are **not** observable from the public payloads — treat them as unknowns to be defined for
the clinical build rather than reverse-engineered from three fields.

## 7. What the clone can and cannot reproduce

| Layer | Status |
|---|---|
| Routes, DOM structure, copy, visual language | captured (`dom.html`, `screenshot.png`) |
| Static bundles | URLs known; bytes not yet pulled (version-pinned 0.0.22) |
| Public read APIs + schemas | captured |
| Write paths (place bet / submit prediction), auth, agent orchestration, scheduler | **not observable** anonymously |
| LLM prompts / persona system prompts / `cot_steps` | **not observable** (only outputs) |
| Server implementation (AgentScope runtime, DB) | **not observable** from the client |
| Scoring formulas | **not observable** |

So "clone the website and engine" splits cleanly into: (a) faithfully rebuildable client + public read
contracts, and (b) an engine that must be **re-specified**, not copied — the agent loop, prompts, scoring
and write APIs are all black-box.

## 8. Clinical mapping (interface-level)

Keep the contract shapes; swap the domain semantics.

| DojoZero | Clinical prediction dojo |
|---|---|
| `league` (`world_cup`, `nba`, `nfl`) | `program` (`oncology`, `cns`, `rare_disease`, `vaccines`) |
| `game` (fixture) | `trial` / `regulatory_event` (NCT id, phase, sponsor, PDUFA date) |
| `home_team` / `away_team` | `sponsor` vs `comparator/standard-of-care`, or `drug` vs `endpoint` |
| `home_score` / `away_score` | observed endpoint values (ORR, OS HR, p-value) |
| `status` live/completed | recruiting / active / readout-pending / met / missed |
| `contest_kind` betting/prediction | `market` (probability trade) / `forecast` (binary call) |
| `bets[]`, `bet_selection`, `win_amount` | positions, YES/NO, payout |
| `prediction_selection`, `prediction_result` | forecast (hit/miss/void) |
| `trigger` (play-by-play) | catalyst feed (enrollment update, DSMB, AdCom, label) |
| `persona` (degen/mystic/…) | analyst archetypes (skeptic, bull, statistician, clinician, regulator) |
| `model` roster | LLM roster incl. clinical-tuned variants |
| `leaderboard.sharpe/roi` | Brier score, log loss, calibration, ROI on paper trades |
| `live_agent_actions.content` | agent rationale with mandatory citations to trial/registry records |

Two structural lessons worth copying exactly: (1) score **forecast accuracy and market P&L separately**
(they diverge, as the leaderboard shows), and (2) make every agent action carry the `trigger` that caused
it — that is what makes the feed auditable.

## 9. Compliance deltas that must be designed in, not bolted on

The source platform's domain (sports) has no equivalent of: health data, medical-advice risk, or
high-risk AI obligations. For the clinical build these become hard interface requirements:

- no patient-identifiable data in the prediction loop (registry/public trial data only);
- every prediction carries model id, version, timestamp, sources, and a "research-only, not medical
  advice" label as *fields*, not footer text;
- human-in-the-loop for anything framed as a recommendation (EU AI Act high-risk posture);
- immutable prediction ledger (predictions must be timestamped before outcomes — otherwise accuracy is
  unfalsifiable and the whole leaderboard is worthless).

## 10. Next REA steps (not yet done)

1. Pull `main.js` / `main.css` bytes (version-pinned) for static analysis of route table and API calls.
2. Capture `#/blog` and `#/about` DOM for copy/IA fidelity.
3. Enumerate `mode=prediction` and `sort_by` variants of `/api/leaderboard`.
4. `export_evidence_bundle` to `dojozero_clone/evidence.json`.
5. Only then write the reconstruction spec (component tree, API contract, agent-loop spec, scoring spec).
