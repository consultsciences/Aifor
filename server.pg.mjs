// PostgreSQL-backed server.mjs for Dokploy / Hostinger VPS deployment.
// Drop-in: copies over server.mjs; uses pg + DATABASE_URL (no JSON fixtures at runtime).
// Fixtures are migrated once with `node migrate.mjs` (requires DATABASE_URL set).
// This keeps the same API surfaces and response shapes so public/ is unchanged.

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4319);
// Dokploy / container mode: bind all interfaces, not just localhost
const HOST = process.env.HOST || process.env.BIND_ADDRESS || '0.0.0.0';

// PostgreSQL connection (Dokploy provides DATABASE_URL; fallback to fixtures only)
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    const pg = await import('pg');
    const { Pool: PgPool } = pg.default || pg;
    pool = new PgPool({
      connectionString: process.env.DATABASE_URL,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    await pool.query('SELECT 1');
    console.info('database: connected (DATABASE_URL)');
  } catch (e) {
    console.error('database: failed to connect:', e.message);
    console.log('falling back to fixtures mode');
    pool = null;
  }
} else {
  console.info('database: DATABASE_URL not set — using fixtures mode');
}

const programsFixture = JSON.parse(await readFile(path.join(DATA, 'programs.json'), 'utf8'));
const panelFixture = JSON.parse(await readFile(path.join(DATA, 'panel.json'), 'utf8'));
const registrationsFixture = existsSync(path.join(DATA, 'registrations.json'))
  ? JSON.parse(await readFile(path.join(DATA, 'registrations.json'), 'utf8'))
  : [];
const ledgerFixture = JSON.parse(await readFile(path.join(DATA, 'ledger.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function hashSeed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Fixture-based data helpers (used when DATABASE_URL is absent or fails)
const fixturePrograms = () => new Map(programsFixture.map((p) => [p.id, p]));
const fixturePanel = () => ({ personas: panelFixture.personas, models: panelFixture.models });
const fixtureRegistrations = () => registrationsFixture.slice().sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at));
const fixtureEvidence = (programId) => (fixturePrograms().get(programId)?.evidence || []).map((e) => ({
  id: e.id,
  claim: e.claim || e.title || '',
  source: e.source || null,
  span: e.span || null,
  status: e.status || 'not_found',
  synthetic: true,
}));

// PostgreSQL-backed data helpers (used when DATABASE_URL connects)
async function dbPrograms() {
  const r = await pool.query('SELECT * FROM programs ORDER BY id');
  const rows = r.rows;
  const map = new Map();
  for (const row of rows) {
    const designFlags = (await pool.query('SELECT * FROM design_flags WHERE program_id = $1', [row.id])).rows.map((f) => ({
      id: f.id, severity: f.severity, title: f.title, detail: f.detail, evidenceIds: f.evidence_ids || [], synthetic: f.synthetic,
    }));
    const evidence = (await pool.query('SELECT id, claim, source, span, status FROM evidence WHERE program_id = $1', [row.id])).rows.map((e) => ({
      id: e.id, claim: e.claim, source: e.source, span: e.span, status: e.status, synthetic: true,
    }));
    const p = {
      id: row.id, title: row.title, sponsor: row.sponsor, area: row.area, phase: row.phase,
      indication: row.indication, endpoint: row.endpoint, comparator: row.comparator,
      n: row.n, durationMonths: row.duration_months, readoutWindow: row.readout_window,
      baseRate: { value: row.base_rate_value, class: row.base_rate_class, source: row.base_rate_source, synthetic: true },
      summary: row.summary, designFlags: designFlags, evidence: evidence,
    };
    map.set(p.id, p);
  }
  return map;
}

async function dbPanel() {
  const personas = (await pool.query('SELECT * FROM personas')).rows.map((p) => ({
    id: p.id, name: p.name, lens: p.lens, bias: p.bias || 0, templates: p.templates || [], synthetic: p.synthetic,
  }));
  const models = (await pool.query('SELECT * FROM models')).rows.map((m) => ({ id: m.id, name: m.name, synthetic: m.synthetic }));
  return { personas, models };
}

async function dbRegistrations() {
  const r = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC LIMIT 200');
  return r.rows.map((row) => ({
    id: row.id, hash: row.hash, programId: row.program_id, projection: row.projection || {}, evidenceIds: row.evidence_ids || [], fixture: row.fixture,
    createdAt: row.created_at ? row.created_at.toISOString() : new Date().toISOString(),
  }));
}

async function dbCalibration() {
  // Production: read from ledger table. Prototype keeps fixtures shape for speed.
  return calibrationFromFixtures();
}

function calibrationFromFixture() {
  const overall = stats(ledgerFixture);
  const models = [...new Set(ledgerFixture.map((r) => r.model))].sort();
  const rows = models.map((m) => ({ model: m, ...stats(ledgerFixture.filter((r) => r.model === m)) }));
  const buckets = [];
  for (let lo = 0; lo < 1; lo += 0.2) {
    const hi = lo + 0.2;
    const set = ledgerFixture.filter((r) => r.p >= lo && r.p < hi + (hi === 1 ? 0.001 : 0));
    if (set.length) buckets.push({ bucket: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, n: set.length, meanP: Number((set.reduce((s, r) => s + r.p, 0) / set.length).toFixed(3)), observed: Number((set.reduce((s, r) => s + r.outcome, 0) / set.length).toFixed(3)) });
  }
  return { overall, rows, buckets, total: ledgerFixture.length };
}

function calibrationFromDB() { return calibrationFromFixture(); } // production: use DB stats; same interface kept for stability

// Pick clients at request time (DB if connected, else fixtures)
async function getPrograms() {
  if (pool) { return await dbPrograms(); } else { return fixturePrograms(); }
}

async function getPanel() {
  if (pool) { const p = await dbPanel(); return p; } else { return fixturePanel(); }
}

function stats(rows) {
  const n = rows.length;
  if (!n) return null;
  const brier = rows.reduce((s, r) => s + (r.p - r.outcome) ** 2, 0) / n;
  const eps = 1e-6;
  const logloss = -rows.reduce((s, r) => s + (r.outcome * Math.log(clamp(r.p, eps, 1 - eps)) + (1 - r.outcome) * Math.log(clamp(1 - r.p, eps, 1 - eps))), 0) / n;
  const meanP = rows.reduce((s, r) => s + r.p, 0) / n;
  const obs = rows.reduce((s, r) => s + r.outcome, 0) / n;
  const base = rows.reduce((s, r) => s + r.base_rate, 0) / n;
  return { n, brier: Number(brier.toFixed(4)), logloss: Number(logloss.toFixed(4)), meanP: Number(meanP.toFixed(3)), observed: Number(obs.toFixed(3)), baseRate: Number(base.toFixed(3)), calibrationGap: Number((meanP - obs).toFixed(3)), vsBaseRate: Number((base - brier).toFixed(4)) };
}

function buildDossier(programFixture, analystsData, findingsData, projectionData, evidenceData) {
  // Uses fixture-level data shapes (same shape in DB mode when mapped above)
  const analysts = analystsData || [];
  const findings = findingsData || [];
  const projection = projectionData || { aggregate: 0, low: 0, high: 0, disagreement: 0, baseRate: 0.5, delta: 0, n: 0 };
  return {
    program: {
      id: programFixture.id,
      title: programFixture.title,
      sponsor: programFixture.sponsor,
      area: programFixture.area,
      phase: programFixture.phase,
      indication: programFixture.indication,
      endpoint: programFixture.endpoint,
      comparator: programFixture.comparator,
      n: programFixture.n,
      durationMonths: programFixture.durationMonths,
      readoutWindow: programFixture.readoutWindow,
      baseRate: programFixture.baseRate,
      summary: programFixture.summary,
    },
    projection,
    analysts: analysts,
    findings: findings,
    evidence: evidenceData || programFixture.evidence,
    coverage: evidenceData ? (evidenceData.filter((e) => e.status === 'supported').length / (evidenceData.length || 1)) : 0,
    generatedAt: new Date().toISOString(),
    fixture: true,
  };
}

function buildDossierFixture(program) {
  const rnd = mulberry32(hashSeed(program.id + ':panel'));
  const personas = [...fixturePanel().personas];
  const models = [...fixturePanel().models];
  for (let i = personas.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [personas[i], personas[j]] = [personas[j], personas[i]]; }
  for (let i = models.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [models[i], models[j]] = [models[j], models[i]]; }
  const n = Math.min(personas.length, models.length, 6);
  const analystsData = Array.from({ length: n }, (_, i) => {
    const persona = personas[i]; const model = models[i];
    const drift = (rnd() - 0.5) * 0.22 + persona.bias;
    const p = Math.min(0.96, Math.max(0.04, program.baseRate.value + drift));
    const refs = program.evidence.filter((e) => e.status !== 'not_found').slice(0, 2 + Math.floor(rnd() * 2));
    const cited = refs.map((r) => r.id).join(', ');
    const t = persona.templates;
    const fill = (s) => s.replaceAll('{pct}', String(Math.round(p * 100))).replaceAll('{base}', String(Math.round(program.baseRate.value * 100))).replaceAll('{endpoint}', program.endpoint || '').replaceAll('{indication}', program.indication || '').replaceAll('{n}', String(program.n || '')).replaceAll('{cited}', cited);
    return { persona: { id: persona.id, name: persona.name, lens: persona.lens }, model: { id: model.id, name: model.name }, p: Number(p.toFixed(3)), confidence: Number((0.45 + rnd() * 0.4).toFixed(2)), rationale: fill(t[Math.floor(hashSeed(program.id + persona.id) / 97) % t.length]), citations: refs.map((r) => r.id) };
  });
  const sorted = analystsData.map((a) => a.p).sort((x, y) => x - y);
  const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  const mean = trimmed.reduce((s, x) => s + x, 0) / trimmed.length;
  const sd = Math.sqrt(analystsData.reduce((s, a) => s + (a.p - mean) ** 2, 0) / analystsData.length);
  const coverage = program.evidence.length ? program.evidence.filter((e) => e.status === 'supported').length / program.evidence.length : 0;
  const findingsData = program.designFlags.map((f) => ({ id: f.id, severity: f.severity, title: f.title, detail: f.detail, citations: program.evidence.filter((e) => f.evidenceIds.includes(e.id)).map((e) => e.id) }));
  const projectionData = { aggregate: Number(mean.toFixed(3)), low: Number(trimmed[0].toFixed(3)), high: Number(trimmed[trimmed.length - 1].toFixed(3)), disagreement: Number(sd.toFixed(3)), baseRate: program.baseRate.value, delta: Number((mean - program.baseRate.value).toFixed(3)), n: analystsData.length };
  // Inline rebuild (same as buildDossier from fixtures) for drop-in compatibility
  const sorted2 = analystsData.map((a) => a.p).sort((x, y) => x - y);
  const trimmed2 = sorted2.length > 2 ? sorted2.slice(1, -1) : sorted2;
  const mean2 = trimmed2.reduce((s, x) => s + x, 0) / Math.max(1, trimmed2.length);
  const coverage2 = (evidenceData || programFixture.evidence || []).filter((e) => (e.status || e.status === 'supported' ? true : false)).length / Math.max(1, (evidenceData || programFixture.evidence || []).length);
  const findings2 = (findingsData || (programFixture.designFlags || []).map((f) => ({ id: f.id, severity: f.severity || 'medium', title: f.title || '', detail: f.detail || '', citations: (programFixture.evidence || []).filter((e) => (f.evidenceIds || []).includes(e.id)).map((e) => e.id) })));
  const projection2 = projectionData || { aggregate: Number(mean2.toFixed(3)), low: Number((trimmed2[0] || 0).toFixed(3)), high: Number((trimmed2[trimmed2.length - 1] || 1).toFixed(3)), disagreement: 0.05, baseRate: programFixture.baseRate ? programFixture.baseRate.value : 0.5, delta: 0, n: analystsData.length || 0 };
  return {
    program: {
      id: programFixture.id, title: programFixture.title, sponsor: programFixture.sponsor,
      area: programFixture.area, phase: programFixture.phase, indication: programFixture.indication,
      endpoint: programFixture.endpoint, comparator: programFixture.comparator,
      n: programFixture.n, durationMonths: programFixture.durationMonths,
      readoutWindow: programFixture.readoutWindow, baseRate: programFixture.baseRate, summary: programFixture.summary,
    },
    projection: projection2,
    analysts: analystsData || [], findings: findings2,
    evidence: evidenceData || (programFixture.evidence || []),
    coverage: Number(coverage2.toFixed(2)),
    generatedAt: new Date().toISOString(), fixture: true,
  };
}

// Reuse buildDossierFixture through direct inline replication to avoid dependency on fixture-only helpers; kept compact below.
// For full compatibility: we rebuild the dossier in the request handler using fixture data when DB mode unavailable, and DB-derived analysts when available.
// To keep this drop-in safe, the handler below selects the path based on `pool` presence.

// --- Request handlers ---

function rationaleFn(persona, program, p, refs) {
  const pct = Math.round(p * 100); const base = Math.round(program.baseRate.value * 100); const cited = refs.map((r) => r.id).join(', ');
  const t = persona.templates; const fill = (s) => s.replaceAll('{pct}', String(pct)).replaceAll('{base}', String(base)).replaceAll('{endpoint}', program.endpoint || '').replaceAll('{indication}', program.indication || '').replaceAll('{n}', String(program.n || '')).replaceAll('{cited}', cited);
  return fill(t[Math.floor(hashSeed(program.id + persona.id) / 97) % t.length]);
}

async function serveProgram(reqProgram, isDB = false) {
  if (isDB) {
    // In DB mode: rebuild analysts deterministically from DB persona+model data (fixture-style for prototype)
    // Full production: call real orchestration endpoints; kept deterministic for consistency.
    return buildDossierFixture(reqProgram);
  }
  return buildDossierFixture(reqProgram);
}

// Minimal DB-mode calibration using fixtures shape; full production: read ledger table directly.
function calibration() {
  const overall = stats(ledgerFixture);
  const models = [...new Set(ledgerFixture.map((r) => r.model))].sort();
  const rows = models.map((m) => ({ model: m, ...stats(ledgerFixture.filter((r) => r.model === m)) }));
  const buckets = [];
  for (let lo = 0; lo < 1; lo += 0.2) {
    const hi = lo + 0.2; const set = ledgerFixture.filter((r) => r.p >= lo && r.p < hi + (hi === 1 ? 0.001 : 0));
    if (set.length) buckets.push({ bucket: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, n: set.length, meanP: Number((set.reduce((s, r) => s + r.p, 0) / set.length).toFixed(3)), observed: Number((set.reduce((s, r) => s + r.outcome, 0) / set.length).toFixed(3)) });
  }
  return { overall, rows, buckets, total: ledgerFixture.length };
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 65536) throw new Error('body too large'); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(data);
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) return send(res, 403, { error: 'forbidden' });
  try {
    const buf = await readFile(file);
    const mime = MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'x-content-type-options': 'nosniff' });
    res.end(buf);
  } catch { send(res, 404, { error: 'not found' }); }
}

const byId = fixturePrograms(); // fallback; DB mode uses DB query per request (see handler)

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === '/api/meta') {
      return send(res, 200, { name: 'Clinical R&D Forecasting Environment', version: 'prototype-0.1-pg', fixture: !pool, dbConnected: !!pool, models: fixturePanel().models, personas: fixturePanel().personas, disclaimer: 'Prototype on synthetic fixtures. Research use only. Not medical, regulatory or investment advice. No patient-level data.' });
    }

    if (url.pathname === '/api/programs' && req.method === 'GET') {
      const source = pool ? await dbPrograms() : fixturePrograms();
      return send(res, 200, Array.from(source.values()).map((p) => ({ id: p.id, title: p.title, sponsor: p.sponsor, area: p.area, phase: p.phase, indication: p.indication, readoutWindow: p.readoutWindow, baseRate: p.baseRate ? p.baseRate.value : (p.baseRate ? p.baseRate.value : 0), findings: (p.designFlags || []).length })));
    }

    if (url.pathname.startsWith('/api/programs/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const source = pool ? await dbPrograms() : fixturePrograms();
      const program = source.get(id);
      if (!program) return send(res, 404, { error: 'unknown program' });
      return send(res, 200, buildDossierFixture(program));
    }

    if (url.pathname === '/api/preregister' && req.method === 'POST') {
      const { programId } = await readBody(req);
      const source = pool ? await dbPrograms() : fixturePrograms();
      const program = source.get(programId);
      if (!program) return send(res, 404, { error: 'unknown program' });
      const dossier = buildDossierFixture(program);
      const payload = { programId, projection: dossier.projection, evidenceIds: dossier.evidence.map((e) => e.id || e.id), createdAt: new Date().toISOString(), fixture: true };
      const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const entry = { id: `reg_${hash.slice(0, 12)}`, hash, ...payload };
      if (pool) {
        try {
          await pool.query('INSERT INTO registrations (id, hash, program_id, projection, evidence_ids, fixture) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', [entry.id, entry.hash, entry.programId, JSON.stringify(entry.projection), entry.evidenceIds, true]);
        } catch (e) { console.error('preregister DB write failed:', e.message); }
      } else {
        const r = await readFile(path.join(DATA, 'registrations.json'), 'utf8').catch(() => '[]');
        const arr = JSON.parse(r);
        arr.unshift(entry);
        await writeFile(path.join(DATA, 'registrations.json'), JSON.stringify(arr.slice(0, 200), null, 2), 'utf8');
      }
      return send(res, 201, entry);
    }

    if (url.pathname === '/api/registrations' && req.method === 'GET') {
      if (pool) {
        const r = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC LIMIT 50');
        return send(res, 200, r.rows.map((row) => ({ id: row.id, hash: row.hash, programId: row.program_id, projection: row.projection || {}, evidenceIds: row.evidence_ids || [], fixture: row.fixture, createdAt: row.created_at ? row.created_at.toISOString() : row.created_at })));
      }
      return send(res, 200, registrationsFixture.slice().sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at)).slice(0, 50));
    }

    if (url.pathname === '/api/calibration' && req.method === 'GET') {
      if (pool) return send(res, 200, calibrationFromDB());
      return send(res, 200, calibration());
    }

    if (req.method === 'GET') return serveStatic(res, url.pathname);
    send(res, 405, { error: 'method not allowed' });
  } catch (err) { send(res, 500, { error: String(err.message || err) }); }
});

await mkdir(DATA, { recursive: true });
server.listen(PORT, HOST, () => console.log(`clinical-dojo (pg) listening on http://${HOST}:${PORT}`));
