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

const DISCLAIMER =
  'Prototype on synthetic fixtures. Research use only. Not medical, regulatory or investment advice. No patient-level data.';

const NAME = 'Clinical R&D Forecasting Environment';
const VERSION = '0.2.0';

function intParam(value, fallback, { min = 1, max = 500 } = {}) {
  const n = Number.parseInt(value ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function createApp({ store, publicDir = path.resolve('public'), log = console }) {
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
