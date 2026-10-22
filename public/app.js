const app = document.getElementById('app');

const state = {
  programs: null,
  meta: null,
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(Number(x) * 100)}%`);
const num = (x, d = 2) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const signed = (x, d = 3) =>
  x === null || x === undefined ? '—' : `${Number(x) >= 0 ? '+' : ''}${Number(x).toFixed(d)}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { accept: 'application/json', ...(options?.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.error || detail;
    } catch {}
    const err = new Error(`${res.status} ${detail}`);
    err.status = res.status;
    throw err;
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

function setBanner() {
  const el = document.getElementById('banner-text');
  if (!el) return;
  const mode = state.meta?.mode;
  if (mode === 'database') {
    el.textContent =
      'Prototype build, database-backed. Synthetic fixture records only — research use, not medical, regulatory or investment advice. No patient-level data.';
  } else {
    el.textContent =
      'Prototype on synthetic fixtures (no database connected). Research use only — not medical, regulatory or investment advice. No patient-level data.';
  }
}

function fail(err) {
  const status = err?.status ? `${err.status}` : 'Error';
  app.innerHTML = `
    <div class="panel">
      <h1>${esc(status)}</h1>
      <p class="muted">${esc(err.message || String(err))}</p>
      <p><a class="btn secondary" href="#/">Back to registry</a></p>
    </div>`;
}

/* ---------------- registry ---------------- */

async function renderRegistry() {
  const [programs, calibration] = await Promise.all([api('/api/programs'), api('/api/calibration')]);
  state.programs = programs;

  const areas = [...new Set(programs.map((p) => p.area).filter(Boolean))].sort();
  const overall = calibration.overall;

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
      <aside class="hero-aside" aria-label="What this is for">
        <p class="kicker">What this is for</p>
        <p><strong>Design review</strong> — endpoint, comparator, population, power, operations.</p>
        <p><strong>Scenario comparison</strong> — what changes the conclusion.</p>
        <p><strong>Calibrated projection</strong> — a probability with uncertainty, scored after readout.</p>
      </aside>
    </section>

    <section class="stats-row" aria-label="Registry summary">
      <div class="stat"><span class="value">${programs.length}</span><span class="label">Programmes</span></div>
      <div class="stat"><span class="value">${calibration.total}</span><span class="label">Resolved forecasts</span></div>
      <div class="stat"><span class="value">${state.meta?.models?.length ?? '—'}</span><span class="label">Panel models</span></div>
      <div class="stat"><span class="value">${num(overall?.brier, 3)}</span><span class="label">Panel Brier</span></div>
      <div class="stat"><span class="value">${overall ? signed(overall.skill, 3) : '—'}</span><span class="label">Skill vs base rate</span></div>
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
            <th scope="col">Programme</th>
            <th scope="col">Area / phase</th>
            <th scope="col">Readout</th>
            <th scope="col" class="num">Base rate</th>
            <th scope="col" class="num">Findings</th>
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
    rows.innerHTML =
      filtered
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
  const [cls, label] = map[status] || ['ghost', status || 'unknown'];
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}

function hashBlock(entry, verification) {
  const v = verification
    ? `<p class="verify ${verification.valid ? 'ok' : 'bad'}">
         ${verification.valid ? 'Hash verified — recomputed from the stored record.' : 'Hash mismatch — this record has been altered.'}
       </p>
       <p class="small muted">Recomputed ${esc(verification.recomputedHash || '—')}</p>`
    : '';
  return `
    <p class="small muted">Locked ${esc(when(entry.createdAt))}</p>
    <p class="hash">${esc(entry.hash)}</p>
    ${v}`;
}

async function verifyEntry(id) {
  try {
    return await api(`/api/registrations/${encodeURIComponent(id)}/verify`);
  } catch {
    return null;
  }
}

async function renderProgram(id) {
  const d = await api(`/api/programs/${encodeURIComponent(id)}`);
  const p = d.program;
  const existing = d.registration;

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
      <div><dt>Base rate</dt><dd>${pct(p.baseRate.value)} <span class="muted small">· ${esc(p.baseRate.source)}</span></dd></div>
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
                <tr><th scope="col">Claim</th><th scope="col">Status</th><th scope="col">Source &amp; span</th></tr>
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
          <div class="panel-title"><h2>Projection</h2><span class="small muted">pre-readout</span></div>
          <div class="projection">
            <div class="prob">${pct(d.projection.aggregate)}<small>panel</small></div>
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
          <div class="panel-title"><h2>Pre-register this projection</h2></div>
          <p class="small">
            The hash covers the projection, the evidence set and the programme — not the clock. Locking the
            same forecast twice is recorded as the same forecast, and anyone can recompute the hash later.
          </p>
          <button class="btn" id="prereg" ${existing ? 'disabled' : ''}>${existing ? 'Registered' : 'Pre-register'}</button>
          <div id="regOut">${existing ? hashBlock(existing) : ''}</div>
        </section>

        <div class="callout">
          <strong>How to read this.</strong> Findings are design critiques, not outcome predictions.
          Projections are research opinions benchmarked to a reference class — not medical, regulatory or
          investment advice. Every claim should be checked against its source span.
        </div>
      </aside>
    </div>
  `;

  if (existing) {
    verifyEntry(existing.id).then((v) => {
      if (v) document.getElementById('regOut').innerHTML = hashBlock(existing, v);
    });
  }

  const btn = document.getElementById('prereg');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Registering…';
    try {
      const entry = await api('/api/preregister', {
        method: 'POST',
        body: JSON.stringify({ programId: id }),
      });
      const v = await verifyEntry(entry.id);
      document.getElementById('regOut').innerHTML = hashBlock(entry, v);
      btn.textContent = 'Registered';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Pre-register';
      document.getElementById('regOut').innerHTML = `<p class="small" style="color:var(--error-ink)">${esc(err.message)}</p>`;
    }
  });
}

/* ---------------- calibration ---------------- */

async function renderCalibration() {
  const c = await api('/api/calibration');
  const rows = [...c.rows].sort((a, b) => (b.skill ?? -9) - (a.skill ?? -9));
  const o = c.overall;

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Calibration board</h1>
        <p class="muted">Resolved forecasts only. Lower Brier and log loss are better. The base-rate row is what a
        reference-class forecast — no model at all — would have scored on the same rows.</p>
      </div>
      <span class="chip">${c.total} resolved · fixture</span>
    </div>

    ${
      o
        ? `<section class="stats-row" aria-label="Panel calibration summary">
            <div class="stat"><span class="value">${num(o.brier, 3)}</span><span class="label">Panel Brier</span></div>
            <div class="stat"><span class="value">${num(o.baselineBrier, 3)}</span><span class="label">Base-rate Brier</span></div>
            <div class="stat"><span class="value">${signed(o.skill, 3)}</span><span class="label">Skill (base − panel)</span></div>
            <div class="stat"><span class="value">${pct(o.meanP)} → ${pct(o.observed)}</span><span class="label">Predicted → observed</span></div>
            <div class="stat"><span class="value">${signed(o.calibrationGap)}</span><span class="label">Calibration gap</span></div>
          </section>`
        : `<div class="panel"><p>No resolved forecasts in the ledger yet, so there is nothing to score.</p></div>`
    }

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col" class="num">n</th>
            <th scope="col" class="num">Brier</th>
            <th scope="col" class="num">Base rate</th>
            <th scope="col" class="num">Skill</th>
            <th scope="col" class="num">Log loss</th>
            <th scope="col" class="num">Mean P</th>
            <th scope="col" class="num">Observed</th>
            <th scope="col" class="num">Gap</th>
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
              <td class="num">${num(r.baselineBrier, 3)}</td>
              <td class="num">${signed(r.skill, 3)}</td>
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
      <strong>What this board can and cannot tell you.</strong> The scoring code is real: Brier, log loss,
      calibration gap, the base-rate baseline and the reliability curve all run over resolved rows. The
      <em>rows</em> are synthetic — each outcome was drawn from a process centred on the programme's base rate,
      and each model carries an injected bias — so the ordering below reflects that bias, not model skill.
      Replace the ledger with resolved live forecasts and the same arithmetic applies unchanged.
    </div>
  `;
}

/* ---------------- ledger ---------------- */

async function renderLedger() {
  const data = await api('/api/registrations?limit=50');
  const entries = data.entries;

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Pre-registration ledger</h1>
        <p class="muted">Every projection locked before readout, newest first. The hash covers the projection,
        the evidence set and the programme; the timestamp is recorded alongside it and is not part of the hash.</p>
      </div>
      <span class="chip">${data.total} ${data.total === 1 ? 'entry' : 'entries'}${data.total > data.limit ? ` · showing ${data.limit}` : ''}</span>
    </div>

    ${
      entries.length
        ? `<div class="table-wrap">
            <table>
              <thead><tr>
                <th scope="col">Locked</th>
                <th scope="col">Programme</th>
                <th scope="col" class="num">Panel</th>
                <th scope="col" class="num">Base</th>
                <th scope="col">Hash</th>
                <th scope="col">Integrity</th>
              </tr></thead>
              <tbody>
                ${entries
                  .map(
                    (e) => `
                  <tr data-reg="${esc(e.id)}">
                    <td class="small">${esc(when(e.createdAt))}</td>
                    <td><a class="row-link" href="#/program/${encodeURIComponent(e.programId)}">${esc(e.programId)}</a></td>
                    <td class="num">${pct(e.projection?.aggregate)}</td>
                    <td class="num">${pct(e.projection?.baseRate)}</td>
                    <td class="small"><span class="hash" title="${esc(e.hash)}">${esc(e.hash.slice(0, 24))}…</span></td>
                    <td><button class="btn secondary small" data-verify="${esc(e.id)}">Verify</button>
                        <div class="verify" data-out="${esc(e.id)}"></div></td>
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

  app.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-verify]');
    if (!btn) return;
    const id = btn.dataset.verify;
    const out = app.querySelector(`[data-out="${id}"]`);
    btn.disabled = true;
    const v = await verifyEntry(id);
    btn.disabled = false;
    if (!v) {
      out.className = 'verify bad';
      out.textContent = 'verification failed';
      return;
    }
    out.className = `verify ${v.valid ? 'ok' : 'bad'}`;
    if (!v.valid) {
      out.innerHTML = `mismatch · expected <span class="refs">${esc(v.hash.slice(0, 16))}…</span>`;
    } else if (v.scheme === 'legacy-v1') {
      out.innerHTML = `verified · legacy seal <span class="refs">${esc(v.recomputedHash.slice(0, 12))}…</span>`;
      out.title = v.note || '';
    } else {
      out.innerHTML = `verified · <span class="refs">${esc(v.recomputedHash.slice(0, 16))}…</span>`;
    }
  });
}

/* ---------------- divergence map ---------------- */

const STATUS_LABEL = {
  unanimous: 'unanimous',
  mostly: 'mostly agree',
  split: 'split',
  lone: 'lone call',
  none: 'not raised',
};
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function dominantFlag(flags) {
  // worst status wins the cell: a cell showing "3/6 split" while another flag in
  // the same cell is unanimous would overstate agreement
  return [...flags].sort((a, b) => {
    const sev = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (sev !== 0) return sev;
    return a.share - b.share;
  })[0];
}

async function renderDivergence() {
  const d = await api('/api/divergence');

  const contestedCount = (p) => p.cells.flatMap((c) => c.flags).filter((f) => f.status === 'split' || f.status === 'lone').length;
  const pick = [...d.programs].sort((a, b) => contestedCount(b) - contestedCount(a))[0]?.id;

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
      <span><i class="heat-chip h-unanimous">${d.modelCount}/${d.modelCount}</i> unanimous</span>
      <span><i class="heat-chip h-mostly">mostly</i> 4–5/${d.modelCount} agree</span>
      <span><i class="heat-chip h-split">split</i> 2–3/${d.modelCount} — contestable</span>
      <span><i class="heat-chip h-lone">1/${d.modelCount}</i> lone call</span>
      <span><i class="heat-chip h-none">0/${d.modelCount}</i> no model raised it</span>
      <span><i class="heat-chip h-clean">—</i> no issue in cell</span>
      <span class="muted">Click a row for the per-model split.</span>
    </div>

    <div class="table-wrap">
      <table class="matrix">
        <thead>
          <tr>
            <th scope="col">Programme</th>
            ${d.cells.map((c) => `<th scope="col" class="num">${esc(c.label)}</th>`).join('')}
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
                if (!c.flags.length) {
                  return `<td class="num"><span class="heat-chip h-clean" aria-label="${esc(p.title)}, ${esc(c.label)}: no issue in this cell">—</span></td>`;
                }
                const f = dominantFlag(c.flags);
                const extra = c.flags.length > 1 ? ` +${c.flags.length - 1}` : '';
                const label = `${p.title}, ${c.label}: ${f.raised.length} of ${d.modelCount} models raised "${f.title}" (${STATUS_LABEL[f.status]})`;
                return `<td class="num"><span class="heat-chip h-${esc(f.status)}" title="${esc(f.title)}" aria-label="${esc(label)}">${f.raised.length}/${d.modelCount}${extra}</span></td>`;
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
      <strong>How this is produced.</strong> Fixture attribution: every design flag is voted on by all
      ${d.modelCount} panel models with a deterministic seeded draw weighted by flag severity — a one-for-one
      stand-in for real model calls, swapped when the panel is wired. A cell can legitimately read
      0/${d.modelCount}: no flag is promoted to look contested. No outcome predictions: disagreement about a
      design is not a forecast of trial success.
    </div>
  `;

  const detail = document.getElementById('detail');
  const rows = document.getElementById('mrows');

  function show(pid) {
    const prog = d.programs.find((x) => x.id === pid);
    if (!prog) return;
    for (const tr of rows.querySelectorAll('tr')) tr.classList.toggle('sel', tr.dataset.pid === pid);
    const flaggedCells = prog.cells.filter((c) => c.flags.length);
    const contested = contestedCount(prog);
    detail.innerHTML = `
      <section class="panel" id="div-detail">
        <div class="panel-title">
          <h2>${esc(prog.title)}</h2>
          <span class="small muted">${contested} contested of ${prog.stats.flags} flags ·
            <a href="#/program/${encodeURIComponent(prog.id)}">open dossier</a></span>
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
                <span class="chip ${f.status === 'split' || f.status === 'lone' ? 'warn' : f.status === 'unanimous' ? 'good' : 'partial'}">
                  ${f.raised.length}/${d.modelCount} ${esc(STATUS_LABEL[f.status])}</span>
              </h3>
              <p>${esc(f.detail)}</p>
              <p class="refs models">
                <span class="muted">Raised by:</span>
                ${f.raised.map((m) => `<span class="chip good">${esc(m.name)}</span>`).join(' ') || '<span class="muted">no model</span>'}
                <span class="muted" style="margin-left:0.7rem">Not raised:</span>
                ${f.notRaised.map((m) => `<span class="chip ghost">${esc(m.name)}</span>`).join(' ') || '<span class="muted">—</span>'}
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
        <li><strong>Pre-register</strong> — SHA-256 over the canonical forecast: programme, projection and evidence set.</li>
        <li><strong>Resolve</strong> — at readout, score with Brier, log loss and calibration.</li>
      </ul>

      <h2>Scoring</h2>
      <p>
        Brier score is the mean squared error of the probability. Log loss penalises confident errors more
        heavily. The calibration gap is mean forecast minus observed rate. <strong>Skill</strong> is the
        base-rate Brier minus the panel Brier: positive means the panel beat a forecast that simply quotes the
        reference class, zero means it added nothing, negative means it did worse. A panel that cannot clear
        that baseline is not adding information, whatever else the board shows.
      </p>

      <h2>Pre-registration</h2>
      <p>
        The hash is computed over a canonical JSON form of the forecast — programme id, projection values and
        the sorted evidence id set — and deliberately excludes the timestamp. Two consequences: locking the
        same forecast twice is reported as a duplicate instead of minting a second record, and any client can
        recompute the hash from what was stored. In PostgreSQL the projection is stored as
        <code>jsonb</code>, which reorders keys; canonicalisation is what keeps verification working across
        that round trip.
      </p>

      <h2>Limits worth knowing</h2>
      <ul>
        <li>Models share training data; agreement between them is not independent evidence.</li>
        <li>Retrospective tests can leak outcomes the model already knows. Live pre-registration avoids that.</li>
        <li>A citation existing is not the same as a citation supporting the sentence. Span checks are mandatory.</li>
        <li>Small samples make calibration unstable; confidence intervals belong next to every score.</li>
        <li>The fixture ledger's model ranking reflects injected per-model bias, not capability.</li>
      </ul>

      <h2>Stack and licences</h2>
      <ul>
        <li><a href="https://github.com/K-Dense-AI/scientific-agent-skills" rel="noopener">K-Dense scientific-agent-skills</a> (MIT) — domain skills and database connectors.</li>
        <li><a href="https://github.com/K-Dense-AI/k-dense-byok" rel="noopener">k-dense-byok</a> (MIT) — multi-model orchestration reference.</li>
        <li><a href="https://github.com/Companion-Inc/feynman" rel="noopener">Feynman</a> (MIT) — literature retrieval and claim-to-source linking.</li>
        <li><a href="https://github.com/InternScience/Awesome-Scientific-Skills" rel="noopener">Awesome Scientific Skills</a> (MIT) — skill discovery only.</li>
        <li><a href="https://github.com/K-Dense-AI/science-superpowers" rel="noopener">science-superpowers</a> — pre-registration discipline; licence unasserted, not reused here.</li>
        <li><a href="https://github.com/IBM/plex" rel="noopener">IBM Plex</a> (SIL OFL 1.1) — the typefaces, self-hosted; visual language from
            <a href="https://getdesign.md/ibm/design-md" rel="noopener">DESIGN.md</a>.</li>
      </ul>

      <h2>Data</h2>
      <p>
        This build runs on synthetic fixtures: six programmes, six models, six analyst personas and 144
        resolved forecasts. Every fixture record is labelled. The scoring, hashing and pre-registration code
        is real.
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
    app.innerHTML = `<div class="panel"><h1>Not found</h1><p class="muted">No such page.</p><p><a href="#/">Back to registry</a></p></div>`;
  } catch (err) {
    fail(err);
  }
}

window.addEventListener('hashchange', route);

state.meta = await api('/api/meta').catch(() => null);
setBanner();
route();
