const app = document.getElementById('app');

const state = {
  programs: null,
  meta: null,
  calibration: null,
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = (x) => `${Math.round(Number(x) * 100)}%`;
const num = (x, d = 2) => Number(x).toFixed(d);
const signed = (x, d = 3) => `${Number(x) >= 0 ? '+' : ''}${Number(x).toFixed(d)}`;

async function api(path, options) {
  const res = await fetch(path, {
    headers: { accept: 'application/json', ...(options?.body ? { 'content-type': 'application/json' } : {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.error || detail;
    } catch {}
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json();
}

function setNav(route) {
  for (const a of document.querySelectorAll('nav[aria-label="Primary"] a')) {
    const href = a.getAttribute('href').replace('#', '');
    const active = route === href || (href !== '/' && route.startsWith(href));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function fail(err) {
  app.innerHTML = `
    <div class="panel">
      <h1>Something went wrong</h1>
      <p class="muted">${esc(err.message || err)}</p>
      <p><a class="btn secondary" href="#/">Back to registry</a></p>
    </div>`;
}

/* ---------------- registry ---------------- */

async function renderRegistry() {
  const [programs, calibration] = await Promise.all([
    state.programs ? Promise.resolve(state.programs) : api('/api/programs'),
    state.calibration ? Promise.resolve(state.calibration) : api('/api/calibration'),
  ]);
  state.programs = programs;
  state.calibration = calibration;

  const areas = [...new Set(programs.map((p) => p.area))].sort();

  app.innerHTML = `
    <section class="hero">
      <div>
        <h1>Stress-test a protocol before you fund it.</h1>
        <p class="lede">
          A panel of LLM analysts reviews study design against published evidence. Every claim carries a
          source and a supporting span. Every projection is pre-registered before readout and scored after.
        </p>
        <p class="muted small">
          Start with a programme below. The dossier tells you where the design is weak; the projection tells
          you what the panel thinks, against the historical base rate.
        </p>
      </div>
      <aside class="hero-aside">
        <p class="kicker">What this is for</p>
        <p><strong>Design review</strong> — endpoint, comparator, population, power, operations.</p>
        <p><strong>Scenario comparison</strong> — what changes the conclusion.</p>
        <p><strong>Calibrated projection</strong> — a probability with uncertainty, scored after readout.</p>
      </aside>
    </section>

    <section class="stats-row" aria-label="Registry summary">
      <div class="stat"><span class="value">${programs.length}</span><span class="label">Programmes</span></div>
      <div class="stat"><span class="value">${calibration.total}</span><span class="label">Resolved forecasts</span></div>
      <div class="stat"><span class="value">${state.meta?.models?.length ?? 6}</span><span class="label">Panel models</span></div>
      <div class="stat"><span class="value">${num(calibration.overall.brier, 3)}</span><span class="label">Panel Brier</span></div>
    </section>

    <div class="toolbar">
      <label for="area">Therapeutic area</label>
      <select id="area">
        <option value="">All areas</option>
        ${areas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
      </select>
      <label class="visually-hidden" for="q">Search programmes</label>
      <input id="q" type="search" placeholder="Search programme, sponsor, indication" />
      <span class="muted small" id="count">${programs.length} shown</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Programme</th>
            <th>Area / phase</th>
            <th>Readout</th>
            <th class="num">Base rate</th>
            <th class="num">Findings</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  `;

  const rows = document.getElementById('rows');
  const count = document.getElementById('count');
  const areaSel = document.getElementById('area');
  const q = document.getElementById('q');

  const draw = () => {
    const area = areaSel.value;
    const term = q.value.trim().toLowerCase();
    const filtered = programs.filter(
      (p) =>
        (!area || p.area === area) &&
        (!term || `${p.title} ${p.sponsor} ${p.indication}`.toLowerCase().includes(term)),
    );
    count.textContent = `${filtered.length} shown`;
    rows.innerHTML = filtered
      .map(
        (p) => `
      <tr class="clickable" data-href="#/program/${encodeURIComponent(p.id)}">
        <td><a class="row-link" href="#/program/${encodeURIComponent(p.id)}">${esc(p.title)}</a>
            <div class="muted small">${esc(p.sponsor)} · ${esc(p.indication)}</div></td>
        <td>${esc(p.area)}<div class="muted small">${esc(p.phase)}</div></td>
        <td>${esc(p.readoutWindow)}</td>
        <td class="num">${pct(p.baseRate)}</td>
        <td class="num">${p.findings}</td>
      </tr>`,
      )
      .join('') || `<tr><td colspan="5" class="muted">No programmes match.</td></tr>`;
  };

  areaSel.addEventListener('change', draw);
  q.addEventListener('input', draw);
  draw();

  rows.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href.slice(1);
  });
}

/* ---------------- programme dossier ---------------- */

function statusChip(status) {
  const map = {
    supported: ['good', 'supported'],
    partial: ['partial', 'partial'],
    contradicted: ['warn', 'contradicted'],
    not_found: ['ghost', 'not found'],
  };
  const [cls, label] = map[status] || ['ghost', status];
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}

function storedRegistration(id) {
  try {
    return JSON.parse(sessionStorage.getItem(`prereg:${id}`) || 'null');
  } catch {
    return null;
  }
}

async function renderProgram(id) {
  const d = await api(`/api/programs/${encodeURIComponent(id)}`);
  const p = d.program;
  const reg = storedRegistration(id);

  const evidenceById = new Map(d.evidence.map((e) => [e.id, e]));

  app.innerHTML = `
    <div class="page-head">
      <div>
        <p class="crumb"><a href="#/">Registry</a> / ${esc(p.area)}</p>
        <h1>${esc(p.title)}</h1>
        <p class="muted">${esc(p.sponsor)} · ${esc(p.phase)} · readout ${esc(p.readoutWindow)}</p>
      </div>
      <div>
        <span class="chip">fixture programme</span>
        <span class="chip ghost">n = ${p.n}</span>
      </div>
    </div>

    <dl class="meta-grid">
      <div><dt>Indication</dt><dd>${esc(p.indication)}</dd></div>
      <div><dt>Primary endpoint</dt><dd>${esc(p.endpoint)}</dd></div>
      <div><dt>Comparator</dt><dd>${esc(p.comparator)}</dd></div>
      <div><dt>Duration</dt><dd>${p.durationMonths} months</dd></div>
      <div><dt>Reference class</dt><dd>${esc(p.baseRate.class)}</dd></div>
      <div><dt>Base rate</dt><dd>${pct(p.baseRate.value)} <span class="muted small">(${esc(p.baseRate.source)})</span></dd></div>
    </dl>

    <div class="columns">
      <div>
        <section class="panel">
          <div class="panel-title">
            <h2>Design findings</h2>
            <span class="small muted">${d.findings.length} findings</span>
          </div>
          ${d.findings
            .map(
              (f) => `
            <article class="finding sev-${esc(f.severity)}">
              <h3>${esc(f.title)} <span class="chip sev-${esc(f.severity)}">${esc(f.severity)}</span></h3>
              <p>${esc(f.detail)}</p>
              <p class="refs">Evidence: ${f.citations.map((c) => esc(c)).join(', ') || '—'}</p>
            </article>`,
            )
            .join('')}
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>Analyst panel</h2>
            <span class="small muted">${d.analysts.length} analysts · disagreement ${num(d.projection.disagreement, 2)}</span>
          </div>
          ${d.analysts
            .map(
              (a) => `
            <article class="analyst">
              <div class="analyst-head">
                <span class="name">${esc(a.persona.name)}</span>
                <span class="chip ghost">${esc(a.model.name)}</span>
                <span class="muted small">${esc(a.persona.lens)}</span>
                <span class="p">${pct(a.p)}</span>
              </div>
              <p>${esc(a.rationale)}</p>
              <p class="refs">Cites ${a.citations.map((c) => esc(c)).join(', ') || 'nothing — flagged'} · confidence ${num(a.confidence, 2)}</p>
            </article>`,
            )
            .join('')}
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>Evidence ledger</h2>
            <span class="small muted">${pct(d.coverage)} supported</span>
          </div>
          <div class="table-wrap" style="border:0">
            <table>
              <thead>
                <tr><th>Claim</th><th>Status</th><th>Source &amp; span</th></tr>
              </thead>
              <tbody>
                ${d.evidence
                  .map(
                    (e) => `
                  <tr>
                    <td>${esc(e.claim)}<div class="refs">${esc(e.id)}</div></td>
                    <td>${statusChip(e.status)}</td>
                    <td class="small">${esc(e.source)}<div class="muted">“${esc(e.span)}”</div></td>
                  </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside>
        <section class="panel">
          <div class="panel-title"><h2>Projection</h2><span class="chip">pre-readout</span></div>
          <div class="projection">
            <div class="prob">${pct(d.projection.aggregate)}<small> panel</small></div>
            <div class="kv">
              <div><span class="k">Interval</span><span class="v">${pct(d.projection.low)}–${pct(d.projection.high)}</span></div>
              <div><span class="k">Base rate</span><span class="v">${pct(d.projection.baseRate)}</span></div>
              <div><span class="k">Delta</span><span class="v">${signed(d.projection.delta)}</span></div>
              <div><span class="k">Analysts</span><span class="v">${d.projection.n}</span></div>
            </div>
          </div>
          <p class="small muted" style="margin-top:0.9rem">
            Aggregate is a trimmed mean. Interval is the trimmed range, not a confidence interval.
          </p>
        </section>

        <section class="panel">
          <div class="panel-title"><h3>Pre-register this projection</h3></div>
          <p class="small">
            Hashing locks the numbers and evidence set before readout. Accuracy claims without this step are
            not falsifiable.
          </p>
          <button class="btn" id="prereg" ${reg ? 'disabled' : ''}>${reg ? 'Registered' : 'Pre-register'}</button>
          <div id="regOut">${reg ? regBlock(reg) : ''}</div>
        </section>

        <div class="callout">
          <strong>How to read this.</strong> Findings are design critiques, not outcome predictions.
          Projections are research opinions benchmarked to a reference class — not medical, regulatory or
          investment advice. Every claim should be checked against its source span.
        </div>
      </aside>
    </div>
  `;

  const btn = document.getElementById('prereg');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Registering…';
    try {
      const entry = await api('/api/preregister', {
        method: 'POST',
        body: JSON.stringify({ programId: id }),
      });
      sessionStorage.setItem(`prereg:${id}`, JSON.stringify(entry));
      document.getElementById('regOut').innerHTML = regBlock(entry);
      btn.textContent = 'Registered';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Pre-register';
      document.getElementById('regOut').innerHTML = `<p class="small" style="color:var(--warn)">${esc(err.message)}</p>`;
    }
  });

  function regBlock(entry) {
    return `
      <p class="small muted" style="margin-top:0.8rem">Locked ${esc(new Date(entry.createdAt).toLocaleString())}</p>
      <p class="hash">${esc(entry.hash)}</p>`;
  }
}

/* ---------------- calibration ---------------- */

async function renderCalibration() {
  const c = state.calibration || (await api('/api/calibration'));
  state.calibration = c;
  const rows = [...c.rows].sort((a, b) => a.brier - b.brier);

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Calibration board</h1>
        <p class="muted">Resolved forecasts only. Lower Brier and log loss are better. The base-rate column is what a
        reference-class forecast would have scored.</p>
      </div>
      <span class="chip">${c.total} resolved · fixture</span>
    </div>

    <section class="stats-row" aria-label="Panel calibration summary">
      <div class="stat"><span class="value">${num(c.overall.brier, 3)}</span><span class="label">Panel Brier</span></div>
      <div class="stat"><span class="value">${num(c.overall.logloss, 3)}</span><span class="label">Log loss</span></div>
      <div class="stat"><span class="value">${pct(c.overall.meanP)} → ${pct(c.overall.observed)}</span><span class="label">Predicted → observed</span></div>
      <div class="stat"><span class="value">${signed(c.overall.calibrationGap)}</span><span class="label">Calibration gap</span></div>
    </section>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th class="num">n</th>
            <th class="num">Brier</th>
            <th class="num">Log loss</th>
            <th class="num">Mean P</th>
            <th class="num">Observed</th>
            <th class="num">Gap</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${esc(r.model)}</td>
              <td class="num">${r.n}</td>
              <td class="num">${num(r.brier, 3)}</td>
              <td class="num">${num(r.logloss, 3)}</td>
              <td class="num">${pct(r.meanP)}</td>
              <td class="num">${pct(r.observed)}</td>
              <td class="num">${signed(r.calibrationGap)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <h2>Reliability</h2>
    <p class="muted small">Bars show the mean forecast in each bin; the tick marks the observed outcome rate.
    Alignment means calibration; a bar longer than its tick means overconfidence.</p>
    <div class="panel">
      <div class="bars">
        ${c.buckets
          .map(
            (b) => `
          <div class="bar-row">
            <span>${esc(b.bucket)} <span class="muted">n=${b.n}</span></span>
            <div class="bar" role="img" aria-label="predicted ${pct(b.meanP)}, observed ${pct(b.observed)}">
              <span class="pred" style="width:${Math.max(2, b.meanP * 100)}%"></span>
              <span class="obs" style="left:calc(${Math.max(0, Math.min(100, b.observed * 100))}% - 1px)"></span>
            </div>
            <span class="muted">${pct(b.meanP)} / ${pct(b.observed)}</span>
          </div>`,
          )
          .join('')}
      </div>
    </div>

    <div class="callout">
      Forecasts in this prototype are synthetic. The scoring implementation is real: Brier, log loss,
      calibration gap and a reliability curve over resolved rows. Replace the ledger with resolved live
      forecasts and the same board applies.
    </div>
  `;
}

/* ---------------- ledger ---------------- */

async function renderLedger() {
  const entries = await api('/api/registrations');

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Pre-registration ledger</h1>
        <p class="muted">Every projection locked before readout, newest first. The hash covers the projection,
        the evidence set and the timestamp.</p>
      </div>
      <span class="chip">${entries.length} entries</span>
    </div>

    ${
      entries.length
        ? `<div class="table-wrap">
            <table>
              <thead><tr><th>Locked</th><th>Programme</th><th class="num">Panel</th><th class="num">Base</th><th>Hash</th></tr></thead>
              <tbody>
                ${entries
                  .map(
                    (e) => `
                  <tr>
                    <td class="small">${esc(new Date(e.createdAt).toLocaleString())}</td>
                    <td><a class="row-link" href="#/program/${encodeURIComponent(e.programId)}">${esc(e.programId)}</a></td>
                    <td class="num">${pct(e.projection.aggregate)}</td>
                    <td class="num">${pct(e.projection.baseRate)}</td>
                    <td class="small"><span class="hash">${esc(e.hash.slice(0, 24))}…</span></td>
                  </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : `<div class="panel">
            <p>No projections locked yet. Open a programme and pre-register its projection.</p>
            <p><a class="btn secondary" href="#/">Browse the registry</a></p>
          </div>`
    }
  `;
}

/* ---------------- divergence map ---------------- */

async function renderDivergence() {
  const d = await api('/api/divergence');

  const statusChipCls = (s) => (s === 'split' || s === 'lone' ? 'warn' : s === 'unanimous' ? 'good' : 'partial');

  // Open on the programme with the most contested cells (the product's highlight).
  const pick = [...d.programs].sort(
    (a, b) =>
      b.cells.flatMap((c) => c.flags).filter((f) => f.status === 'split' || f.status === 'lone').length -
      a.cells.flatMap((c) => c.flags).filter((f) => f.status === 'split' || f.status === 'lone').length,
  )[0]?.id;

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Divergence map</h1>
        <p class="muted">Which models raise which design issue, per rubric cell. Where models converge the critique
        is solid; where they split, the design is contestable — and that split is the deliverable.</p>
      </div>
      <span class="chip">${d.modelCount} models × ${d.cells.length} cells · fixture</span>
    </div>

    <section class="stats-row" aria-label="Divergence summary">
      <div class="stat"><span class="value">${d.modelCount}</span><span class="label">Panel models</span></div>
      <div class="stat"><span class="value">${d.totals.flags}</span><span class="label">Flags raised</span></div>
      <div class="stat"><span class="value">${d.totals.unanimous}</span><span class="label">Unanimous</span></div>
      <div class="stat"><span class="value">${d.totals.contested}</span><span class="label">Split or lone</span></div>
    </section>

    <div class="legend" aria-label="Legend">
      <span><i class="heat-chip h-unanimous">6/6</i> unanimous</span>
      <span><i class="heat-chip h-mostly">4–5/6</i> mostly agree</span>
      <span><i class="heat-chip h-split">2–3/6</i> split — contestable</span>
      <span><i class="heat-chip h-lone">1/6</i> lone call</span>
      <span><i class="heat-chip h-clean">—</i> no issue in cell</span>
      <span class="muted">Click a row for the per-model split.</span>
    </div>

    <div class="table-wrap">
      <table class="matrix">
        <thead>
          <tr>
            <th>Programme</th>
            ${d.cells.map((c) => `<th class="num">${esc(c.label)}</th>`).join('')}
          </tr>
        </thead>
        <tbody id="mrows">
          ${d.programs
            .map(
              (p) => `
          <tr class="clickable" data-pid="${esc(p.id)}">
            <td><a class="row-link" href="#/program/${encodeURIComponent(p.id)}">${esc(p.title)}</a>
                <div class="muted small">${esc(p.area)} · ${esc(p.phase)}</div></td>
            ${p.cells
              .map((c) => {
                const f = c.flags[0];
                if (!f) return `<td class="num"><span class="heat-chip h-clean">—</span></td>`;
                return `<td class="num"><span class="heat-chip h-${esc(f.status)}" title="${esc(f.title)}">${f.raised.length}/${d.modelCount}</span></td>`;
              })
              .join('')}
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <div id="detail"></div>

    <div class="callout">
      <strong>How this is produced.</strong> Fixture attribution: every design flag is voted on by all six panel
      models with a deterministic seeded draw weighted by flag severity — a one-for-one stand-in for real model
      calls, swapped when the panel is wired. No outcome predictions: disagreement about a design is not a
      forecast of trial success.
    </div>
  `;

  const detail = document.getElementById('detail');
  const rows = document.getElementById('mrows');

  function show(pid) {
    const prog = d.programs.find((x) => x.id === pid);
    if (!prog) return;
    for (const tr of rows.querySelectorAll('tr')) tr.classList.toggle('sel', tr.dataset.pid === pid);
    const flaggedCells = prog.cells.filter((c) => c.flags.length);
    const contested = prog.cells.flatMap((c) => c.flags).filter((f) => f.status === 'split' || f.status === 'lone').length;
    detail.innerHTML = `
      <section class="panel" id="div-detail">
        <div class="panel-title">
          <h2>${esc(prog.title)}</h2>
          <span class="small muted">${contested} contested of ${prog.stats.flags} flags · <a href="#/program/${encodeURIComponent(prog.id)}">open dossier</a></span>
        </div>
        ${
          flaggedCells.length
            ? flaggedCells
                .map((c) =>
                  c.flags
                    .map(
                      (f) => `
            <article class="finding sev-${esc(f.severity)}">
              <h3>${esc(c.label)} — ${esc(f.title)}
                <span class="chip sev-${esc(f.severity)}">${esc(f.severity)}</span>
                <span class="chip ${statusChipCls(f.status)}">${f.raised.length}/${d.modelCount} ${esc(f.status)}</span>
              </h3>
              <p>${esc(f.detail)}</p>
              <p class="refs models">
                <span class="muted">Raised by:</span>
                ${f.raised.map((m) => `<span class="chip good">${esc(m.name)}</span>`).join(' ')}
                <span class="muted" style="margin-left:0.7rem">Not raised:</span>
                ${f.notRaised.map((m) => `<span class="chip ghost">${esc(m.name)}</span>`).join(' ')}
              </p>
              <p class="refs">Evidence: ${f.evidenceIds.map((e) => esc(e)).join(', ') || '—'}</p>
            </article>`,
                    )
                    .join(''),
                )
                .join('')
            : `<p class="muted">No issues raised in any rubric cell for this programme.</p>`
        }
      </section>`;
  }

  rows.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-pid]');
    if (tr) show(tr.dataset.pid);
  });

  if (pick) show(pick);
}

/* ---------------- method ---------------- */

function renderMethod() {
  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Method</h1>
        <p class="muted">What the system does, how a dossier is produced, and what it refuses to claim.</p>
      </div>
    </div>

    <div class="prose">
      <h2>What it is</h2>
      <p>
        A research environment for stress-testing clinical study designs. It retrieves published evidence,
        checks that each claim is actually supported by the cited span, runs a panel of analyst personas
        across several models, and pre-registers the resulting projection before the readout is known.
      </p>

      <h2>What it is not</h2>
      <ul>
        <li>Not clinical decision support and not a diagnostic. No patient-level data is processed.</li>
        <li>Not a validated clinical predictor. Projections are research opinions with uncertainty.</li>
        <li>Not investment, regulatory or medical advice.</li>
        <li>Not a real-money market. Scores are probabilistic, not wagers.</li>
      </ul>

      <h2>Pipeline</h2>
      <ul>
        <li><strong>Retrieve</strong> — literature and registry sources with stable identifiers (PMID, DOI, NCT).</li>
        <li><strong>Extract claims</strong> — each design-relevant assertion becomes a separate record.</li>
        <li><strong>Check spans</strong> — a claim is supported, partial, contradicted or not found. “Not found” is a valid result.</li>
        <li><strong>Panel</strong> — persona × model analysts produce a probability, a rationale and citations.</li>
        <li><strong>Aggregate</strong> — trimmed mean, trimmed range, disagreement; base rate shown alongside.</li>
        <li><strong>Pre-register</strong> — SHA-256 over projection, evidence set and timestamp.</li>
        <li><strong>Resolve</strong> — at readout, score with Brier, log loss and calibration.</li>
      </ul>

      <h2>Scoring</h2>
      <p>
        Brier score is the mean squared error of the probability. Log loss penalises confident errors more
        heavily. The calibration gap is mean forecast minus observed rate; the reliability curve shows where
        the panel is over- or under-confident. The base-rate comparison is the number that matters: a panel
        that cannot beat the reference class is not adding information.
      </p>

      <h2>Limits worth knowing</h2>
      <ul>
        <li>Models share training data; agreement between them is not independent evidence.</li>
        <li>Retrospective tests can leak outcomes the model already knows. Live pre-registration avoids that.</li>
        <li>A citation existing is not the same as a citation supporting the sentence. Span checks are mandatory.</li>
        <li>Small samples make calibration unstable; confidence intervals belong next to every score.</li>
      </ul>

      <h2>Stack and licences</h2>
      <ul>
        <li><a href="https://github.com/K-Dense-AI/scientific-agent-skills" rel="noopener">K-Dense scientific-agent-skills</a> (MIT) — domain skills and database connectors.</li>
        <li><a href="https://github.com/K-Dense-AI/k-dense-byok" rel="noopener">k-dense-byok</a> (MIT) — multi-model orchestration reference.</li>
        <li><a href="https://github.com/Companion-Inc/feynman" rel="noopener">Feynman</a> (MIT) — literature retrieval and claim-to-source linking.</li>
        <li><a href="https://github.com/InternScience/Awesome-Scientific-Skills" rel="noopener">Awesome Scientific Skills</a> (MIT) — skill discovery only.</li>
        <li><a href="https://github.com/K-Dense-AI/science-superpowers" rel="noopener">science-superpowers</a> — pre-registration discipline; licence unasserted, not reused here.</li>
      </ul>

      <h2>Data</h2>
      <p>
        This build runs on synthetic fixtures: six programmes, six models, six analyst personas and 144
        resolved forecasts. Every fixture record is labelled. The scoring and pre-registration code is real.
      </p>

      <div class="callout">
        Research use only. Not medical, regulatory or investment advice. No patient-level data.
      </div>
    </div>
  `;
}

/* ---------------- router ---------------- */

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  setNav(hash);
  window.scrollTo(0, 0);
  try {
    if (hash === '/' || hash === '') return await renderRegistry();
    if (hash.startsWith('/program/')) return await renderProgram(decodeURIComponent(hash.slice('/program/'.length)));
    if (hash === '/calibration') return await renderCalibration();
    if (hash === '/divergence') return await renderDivergence();
    if (hash === '/ledger') return await renderLedger();
    if (hash === '/method') return renderMethod();
    app.innerHTML = `<div class="panel"><h1>Not found</h1><p><a href="#/">Back to registry</a></p></div>`;
  } catch (err) {
    fail(err);
  }
}

window.addEventListener('hashchange', route);
state.meta = await api('/api/meta').catch(() => null);
route();
