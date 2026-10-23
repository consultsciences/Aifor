// Router. One implementation for both stores — the deployed server and the
// fixture server used to be two copies of this file, and the copy Docker ran
// had drifted into a 500 on every dossier and no /api/divergence at all.

import http from 'node:http';
import path from 'node:path';
import { HttpError, readJsonBody, send, sendError, serveStatic } from './http.mjs';
import { buildDossier } from './dossier.mjs';
import { divergence } from './divergence.mjs';
import { calibration } from './scoring.mjs';
import { forecastHash, registrationId, verifyRegistration } from './canonical.mjs';
import { createContactHandler } from './contact.mjs';
import { sakireaConfig, sakireaSources, sakireaWorkflows, sakireaSearch, sakireaRunWorkflow } from './sakirea.mjs';

const DISCLAIMER =
  'Prototype on synthetic fixtures. Research use only. Not medical, regulatory or investment advice. No patient-level data.';

const NAME = 'Clinical R&D Forecasting Environment';
const VERSION = '0.2.0';

function intParam(value, fallback, { min = 1, max = 500 } = {}) {
  const n = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function createApp({
  store,
  publicDir = path.resolve('public'),
  dataDir = process.env.DATA_DIR || path.resolve('data'),
  trustProxy = process.env.TRUST_PROXY === '1',
  contactMaxPerHour = 3,
  log = console,
}) {
  const handleContact = createContactHandler({
    dataDir,
    spoolDir: process.env.CONTACT_SPOOL_DIR || dataDir,
    trustProxy,
    maxPerWindow: contactMaxPerHour,
    log,
  });
  const route = async (req, res, url) => {
    const { pathname } = url;

    if (pathname === '/api/health') {
      const ok = await store.health();
      return send(res, ok ? 200 : 503, { ok, mode: store.mode });
    }

    if (pathname === '/api/meta') {
      const panel = await store.getPanel();
      return send(res, 200, {
        name: NAME,
        version: VERSION,
        mode: store.mode,
        dbConnected: store.dbConnected,
        fixture: store.mode === 'fixture',
        models: panel.models,
        personas: panel.personas,
        disclaimer: DISCLAIMER,
      });
    }

    if (pathname === '/api/programs') {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const programs = await store.listPrograms();
      return send(
        res,
        200,
        [...programs.values()].map((p) => ({
          id: p.id,
          title: p.title,
          sponsor: p.sponsor,
          area: p.area,
          phase: p.phase,
          indication: p.indication,
          readoutWindow: p.readoutWindow,
          baseRate: p.baseRate?.value ?? null,
          findings: (p.designFlags || []).length,
        })),
      );
    }

    const programMatch = pathname.match(/^\/api\/programs\/([^/]+)$/);
    if (programMatch) {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const id = decodeURIComponent(programMatch[1]);
      const programs = await store.listPrograms();
      const program = programs.get(id);
      if (!program) throw new HttpError(404, 'unknown program');
      const panel = await store.getPanel();
      const dossier = buildDossier(program, panel);
      const registration = await store.findRegistrationForProgram(id);
      return send(res, 200, { ...dossier, registration });
    }

    if (pathname === '/api/preregister') {
      if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const body = await readJsonBody(req);
      const programId = body.programId;
      if (typeof programId !== 'string' || !programId) {
        throw new HttpError(400, 'programId is required');
      }
      const programs = await store.listPrograms();
      const program = programs.get(programId);
      if (!program) throw new HttpError(404, 'unknown program');
      const panel = await store.getPanel();
      const dossier = buildDossier(program, panel);
      const payload = {
        programId,
        projection: dossier.projection,
        evidenceIds: dossier.evidence.map((e) => e.id),
      };
      const hash = forecastHash(payload);
      const { entry, created } = await store.addRegistration({
        id: registrationId(hash),
        hash,
        ...payload,
        fixture: store.mode === 'fixture',
      });
      return send(res, created ? 201 : 200, { ...entry, duplicate: !created });
    }

    if (pathname === '/api/registrations') {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const programId = url.searchParams.get('programId');
      const limit = intParam(url.searchParams.get('limit'), 50);
      const [entries, total] = await Promise.all([
        store.listRegistrations({ limit, programId }),
        store.countRegistrations({ programId }),
      ]);
      return send(res, 200, { entries, total, limit });
    }

    const verifyMatch = pathname.match(/^\/api\/registrations\/([^/]+)\/verify$/);
    if (verifyMatch) {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const row = await store.getRegistration(decodeURIComponent(verifyMatch[1]));
      if (!row) throw new HttpError(404, 'unknown registration');
      return send(res, 200, verifyRegistration(row));
    }

    const regMatch = pathname.match(/^\/api\/registrations\/([^/]+)$/);
    if (regMatch) {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const row = await store.getRegistration(decodeURIComponent(regMatch[1]));
      if (!row) throw new HttpError(404, 'unknown registration');
      return send(res, 200, row);
    }

    if (pathname === '/api/calibration') {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const rows = await store.ledgerRows();
      return send(res, 200, calibration(rows));
    }

    if (pathname === '/api/divergence') {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const [programs, panel] = await Promise.all([store.listPrograms(), store.getPanel()]);
      return send(res, 200, divergence([...programs.values()], panel));
    }

    // ---- Sakirea research proxy (optional; fails closed, see src/sakirea.mjs) ----
    // Five routes mirror the canonical integration contract. The app works fully
    // without a running sakirea: every route answers 503 { error: { code, message } }
    // with code sakirea_disabled / sakirea_unavailable until one is configured.
    if (pathname === '/api/research/config') {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      return send(res, 200, { ok: true, ...sakireaConfig() });
    }

    if (pathname === '/api/research/sources') {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const r = await sakireaSources();
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, sources: r.data.sources });
    }

    if (pathname === '/api/research/workflows') {
      if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
      const r = await sakireaWorkflows();
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, workflows: r.data.workflows });
    }

    if (pathname === '/api/research/search') {
      if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const body = await readJsonBody(req);
      const r = await sakireaSearch(body);
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, ...r.data });
    }

    const researchRun = pathname.match(/^\/api\/research\/workflows\/([A-Za-z0-9_-]+)\/run$/);
    if (researchRun) {
      if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
      const body = await readJsonBody(req);
      // outputDir comes from config only — never from the request body.
      const r = await sakireaRunWorkflow(researchRun[1], { topic: body.topic, mode: body.mode });
      if (!r.ok) return send(res, r.status, { error: r.error });
      return send(res, 200, { ok: true, ...r.data });
    }

    // Contact form intake. Plain HTML form post, so it works with the strict CSP.
    if (pathname === '/api/contact') {
      return handleContact(req, res, { dataDir, trustProxy, log });
    }

    // Legal pages. The terms, privacy notice and contact form are required on every
    // estate site, and they are static files rather than part of the SPA.
    if (pathname === '/privacy' || pathname === '/terms' || pathname === '/contact') {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      const page = pathname === '/privacy' ? 'privacy.html' : pathname === '/terms' ? 'terms.html' : 'contact.html';
      return serveStatic(res, `/legal/${page}`, publicDir);
    }

    // HEAD is served like GET (Node drops the body); uptime checks use it.
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, pathname, publicDir);
    throw new HttpError(405, 'method not allowed');
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      await route(req, res, url);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (err instanceof HttpError) return sendError(res, err.status, err.message);
      log.error(`unhandled error on ${req.method} ${url.pathname}:`, err);
      return sendError(res, 500, 'internal error');
    }
  });
}
