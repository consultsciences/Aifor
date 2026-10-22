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
const HOST = '127.0.0.1';

const programs = JSON.parse(await readFile(path.join(DATA, 'programs.json'), 'utf8'));
const panel = JSON.parse(await readFile(path.join(DATA, 'panel.json'), 'utf8'));
const ledger = JSON.parse(await readFile(path.join(DATA, 'ledger.json'), 'utf8'));
const REG_FILE = path.join(DATA, 'registrations.json');
const registrations = existsSync(REG_FILE) ? JSON.parse(await readFile(REG_FILE, 'utf8')) : [];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byId = new Map(programs.map((p) => [p.id, p]));

function pickAnalysts(program) {
  const rnd = mulberry32(hashSeed(program.id));
  const personas = [...panel.personas];
  const models = [...panel.models];
  for (let i = personas.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [personas[i], personas[j]] = [personas[j], personas[i]];
  }
  for (let i = models.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [models[i], models[j]] = [models[j], models[i]];
  }
  const n = Math.min(panel.personas.length, models.length, 6);
  return Array.from({ length: n }, (_, i) => ({ persona: personas[i], model: models[i] }));
}

function rationale(persona, program, p, refs) {
  const pct = Math.round(p * 100);
  const base = Math.round(program.baseRate.value * 100);
  const cited = refs.map((r) => r.id).join(', ');
  const t = persona.templates;
  const fill = (s) =>
    s
      .replaceAll('{pct}', String(pct))
      .replaceAll('{base}', String(base))
      .replaceAll('{endpoint}', program.endpoint)
      .replaceAll('{indication}', program.indication)
      .replaceAll('{n}', String(program.n))
      .replaceAll('{cited}', cited);
  return fill(t[Math.floor(hashSeed(program.id + persona.id) / 97) % t.length]);
}

function buildDossier(program) {
  const rnd = mulberry32(hashSeed(program.id + ':panel'));
  const analysts = pickAnalysts(program).map(({ persona, model }) => {
    const drift = (rnd() - 0.5) * 0.22 + persona.bias;
    const p = clamp(program.baseRate.value + drift, 0.04, 0.96);
    const refs = program.evidence
      .filter((e) => e.status !== 'not_found')
      .slice(0, 2 + Math.floor(rnd() * 2));
    return {
      persona: { id: persona.id, name: persona.name, lens: persona.lens },
      model: { id: model.id, name: model.name },
      p: Number(p.toFixed(3)),
      confidence: Number((0.45 + rnd() * 0.4).toFixed(2)),
      rationale: rationale(persona, program, p, refs),
      citations: refs.map((r) => r.id),
    };
  });

  const sorted = analysts.map((a) => a.p).sort((x, y) => x - y);
  const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  const mean = trimmed.reduce((s, x) => s + x, 0) / trimmed.length;
  const sd = Math.sqrt(
    analysts.reduce((s, a) => s + (a.p - mean) ** 2, 0) / analysts.length,
  );
  const coverage = program.evidence.length
    ? program.evidence.filter((e) => e.status === 'supported').length / program.evidence.length
    : 0;

  const findings = program.designFlags.map((f) => {
    const refs = program.evidence.filter((e) => f.evidenceIds.includes(e.id));
    return {
      id: f.id,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      citations: refs.map((r) => r.id),
    };
  });

  const projection = {
    aggregate: Number(mean.toFixed(3)),
    low: Number(trimmed[0].toFixed(3)),
    high: Number(trimmed[trimmed.length - 1].toFixed(3)),
    disagreement: Number(sd.toFixed(3)),
    baseRate: program.baseRate.value,
    delta: Number((mean - program.baseRate.value).toFixed(3)),
    n: analysts.length,
  };

  return {
    program: {
      id: program.id,
      title: program.title,
      sponsor: program.sponsor,
      area: program.area,
      phase: program.phase,
      indication: program.indication,
      endpoint: program.endpoint,
      comparator: program.comparator,
      n: program.n,
      durationMonths: program.durationMonths,
      readoutWindow: program.readoutWindow,
      baseRate: program.baseRate,
      summary: program.summary,
    },
    projection,
    analysts,
    findings,
    evidence: program.evidence,
    coverage: Number(coverage.toFixed(2)),
    generatedAt: new Date().toISOString(),
    fixture: true,
  };
}

function stats(rows) {
  const n = rows.length;
  if (!n) return null;
  const brier = rows.reduce((s, r) => s + (r.p - r.outcome) ** 2, 0) / n;
  const eps = 1e-6;
  const logloss =
    -rows.reduce(
      (s, r) => s + (r.outcome * Math.log(clamp(r.p, eps, 1 - eps)) + (1 - r.outcome) * Math.log(clamp(1 - r.p, eps, 1 - eps))),
      0,
    ) / n;
  const meanP = rows.reduce((s, r) => s + r.p, 0) / n;
  const obs = rows.reduce((s, r) => s + r.outcome, 0) / n;
  const base = rows.reduce((s, r) => s + r.base_rate, 0) / n;
  return {
    n,
    brier: Number(brier.toFixed(4)),
    logloss: Number(logloss.toFixed(4)),
    meanP: Number(meanP.toFixed(3)),
    observed: Number(obs.toFixed(3)),
    baseRate: Number(base.toFixed(3)),
    calibrationGap: Number((meanP - obs).toFixed(3)),
    vsBaseRate: Number((base - brier).toFixed(4)),
  };
}

function calibration() {
  const models = [...new Set(ledger.map((r) => r.model))].sort();
  const overall = stats(ledger);
  const rows = models.map((m) => ({ model: m, ...stats(ledger.filter((r) => r.model === m)) }));
  const buckets = [];
  for (let lo = 0; lo < 1; lo += 0.2) {
    const hi = lo + 0.2;
    const set = ledger.filter((r) => r.p >= lo && r.p < hi + (hi === 1 ? 0.001 : 0));
    if (set.length) {
      buckets.push({
        bucket: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
        n: set.length,
        meanP: Number((set.reduce((s, r) => s + r.p, 0) / set.length).toFixed(3)),
        observed: Number((set.reduce((s, r) => s + r.outcome, 0) / set.length).toFixed(3)),
      });
    }
  }
  return { overall, rows, buckets, total: ledger.length };
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 65536) throw new Error('body too large');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(data);
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) {
    return send(res, 403, { error: 'forbidden' });
  }
  try {
    const buf = await readFile(file);
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
    res.end(buf);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === '/api/meta') {
      return send(res, 200, {
        name: 'Clinical R&D Forecasting Environment',
        version: 'prototype-0.1',
        fixture: true,
        models: panel.models,
        personas: panel.personas,
        disclaimer:
          'Prototype on synthetic fixtures. Research use only. Not medical, regulatory or investment advice. No patient-level data.',
      });
    }

    if (url.pathname === '/api/programs' && req.method === 'GET') {
      return send(
        res,
        200,
        programs.map((p) => ({
          id: p.id,
          title: p.title,
          sponsor: p.sponsor,
          area: p.area,
          phase: p.phase,
          indication: p.indication,
          readoutWindow: p.readoutWindow,
          baseRate: p.baseRate.value,
          findings: p.designFlags.length,
        })),
      );
    }

    if (url.pathname.startsWith('/api/programs/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const program = byId.get(id);
      if (!program) return send(res, 404, { error: 'unknown program' });
      return send(res, 200, buildDossier(program));
    }

    if (url.pathname === '/api/preregister' && req.method === 'POST') {
      const { programId } = await readBody(req);
      const program = byId.get(programId);
      if (!program) return send(res, 404, { error: 'unknown program' });
      const dossier = buildDossier(program);
      const createdAt = new Date().toISOString();
      const payload = {
        programId,
        projection: dossier.projection,
        evidenceIds: dossier.evidence.map((e) => e.id),
        createdAt,
        fixture: true,
      };
      const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const entry = { id: `reg_${hash.slice(0, 12)}`, hash, ...payload };
      registrations.unshift(entry);
      await writeFile(REG_FILE, JSON.stringify(registrations.slice(0, 200), null, 2), 'utf8');
      return send(res, 201, entry);
    }

    if (url.pathname === '/api/registrations' && req.method === 'GET') {
      return send(res, 200, registrations.slice(0, 50));
    }

    if (url.pathname === '/api/calibration' && req.method === 'GET') {
      return send(res, 200, calibration());
    }

    if (req.method === 'GET') return serveStatic(res, url.pathname);

    send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    send(res, 400, { error: String(err.message || err) });
  }
});

await mkdir(DATA, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`clinical-dojo listening on http://${HOST}:${PORT}`);
});
