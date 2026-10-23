// Sakirea research-engines client — key-free literature search + research workflows.
//
// Talks to a separately running `sakirea serve` (default http://127.0.0.1:4599).
// Fail-safe: calls never throw and can never take the server down — each resolves
// to { ok:true, data } or { ok:false, status, error } where error is
// { code, message } with one of:
//   sakirea_disabled        503  SAKIREA_DISABLED=1 or an empty SAKIREA_URL
//   sakirea_unavailable     503  fetch failed or timed out
//   sakirea_upstream_error  502  sakirea answered non-2xx (upstreamStatus carried)
//   bad_request             400  invalid input rejected locally
//
// Config: SAKIREA_URL, SAKIREA_DISABLED, SAKIREA_TIMEOUT_MS,
// SAKIREA_WORKFLOW_TIMEOUT_MS, SAKIREA_OUTPUT_DIR (see env.example).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BASE = (process.env.SAKIREA_URL === undefined ? 'http://127.0.0.1:4599' : process.env.SAKIREA_URL).replace(/\/+$/, '');
const DISABLED = process.env.SAKIREA_DISABLED === '1';
const OUTPUT_DIR = process.env.SAKIREA_OUTPUT_DIR || path.join(APP_ROOT, 'outputs', 'research');

function positiveInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const TIMEOUT_MS = positiveInt('SAKIREA_TIMEOUT_MS', 30000);
const WORKFLOW_TIMEOUT_MS = positiveInt('SAKIREA_WORKFLOW_TIMEOUT_MS', 180000);

// Known workflow ids (sakirea src/workflows/registry.ts) — validated locally so
// a typo returns 400 instead of a proxied upstream 404.
const WORKFLOWS = ['deepresearch', 'lit', 'review', 'audit', 'replicate', 'recipe', 'compare', 'draft', 'autoresearch', 'summarize'];
const MODES = ['auto', 'deterministic', 'llm'];

const enabled = Boolean(BASE) && !DISABLED;

export function sakireaConfig() {
  return { enabled, url: BASE || null, outputDir: OUTPUT_DIR };
}

const fail = (status, error) => ({ ok: false, status, error });
const disabledError = () =>
  fail(503, {
    code: 'sakirea_disabled',
    message: 'sakirea integration is disabled (SAKIREA_DISABLED=1 or SAKIREA_URL is empty)',
  });
const badRequest = (message) => fail(400, { code: 'bad_request', message });

async function request(pathname, { method = 'GET', body, timeoutMs = TIMEOUT_MS } = {}) {
  if (!enabled) return disabledError();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const timeoutError = () =>
    fail(503, { code: 'sakirea_unavailable', message: `sakirea did not respond within ${timeoutMs} ms (${BASE})` });
  try {
    let res;
    try {
      res = await fetch(`${BASE}${pathname}`, {
        method,
        signal: ctrl.signal,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (ctrl.signal.aborted) return timeoutError();
      return fail(503, { code: 'sakirea_unavailable', message: `sakirea unreachable at ${BASE}: ${e?.message || e}` });
    }
    let text;
    try {
      text = await res.text();
    } catch (e) {
      if (ctrl.signal.aborted) return timeoutError();
      return fail(503, { code: 'sakirea_unavailable', message: `failed to read sakirea response: ${e?.message || e}` });
    }
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (!res.ok) {
      const upstream = payload && typeof payload === 'object' && payload.error ? payload.error : null;
      return fail(502, {
        code: 'sakirea_upstream_error',
        message: upstream?.message ? `sakirea ${res.status}: ${upstream.message}` : `sakirea responded with HTTP ${res.status}`,
        upstreamStatus: res.status,
        ...(upstream?.code ? { upstreamCode: upstream.code } : {}),
      });
    }
    if (!payload || typeof payload !== 'object') {
      return fail(502, { code: 'sakirea_upstream_error', message: 'sakirea returned a non-JSON body', upstreamStatus: res.status });
    }
    return { ok: true, data: payload };
  } finally {
    clearTimeout(timer);
  }
}

export async function sakireaHealth() {
  if (!enabled) return disabledError();
  return request('/api/health');
}

export async function sakireaSources() {
  if (!enabled) return disabledError();
  return request('/api/sources');
}

export async function sakireaWorkflows() {
  if (!enabled) return disabledError();
  return request('/api/workflows');
}

export async function sakireaSearch({ source, query, limit, sort } = {}) {
  // Disabled is checked before validation so a switched-off integration always
  // answers sakirea_disabled, whatever the payload.
  if (!enabled) return disabledError();
  if (typeof source !== 'string' || !source.trim()) return badRequest('"source" must be a non-empty string.');
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return badRequest('"query" must be a non-empty string.');
  if (q.length > 500) return badRequest('"query" must be at most 500 characters.');
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
    return badRequest('"limit" must be an integer between 1 and 20.');
  }
  if (sort !== undefined && typeof sort !== 'string') return badRequest('"sort" must be a string.');
  const body = { source: source.trim(), query: q };
  if (limit !== undefined) body.limit = limit;
  if (sort !== undefined) body.sort = sort;
  return request('/api/search', { method: 'POST', body });
}

export async function sakireaRunWorkflow(id, { topic, mode, outputDir } = {}) {
  if (!enabled) return disabledError();
  if (typeof id !== 'string' || !WORKFLOWS.includes(id)) {
    return badRequest(`unknown workflow "${id}"; expected one of: ${WORKFLOWS.join(', ')}`);
  }
  const t = typeof topic === 'string' ? topic.trim() : '';
  if (t.length < 3 || t.length > 300) return badRequest('"topic" must be 3-300 characters.');
  if (mode !== undefined && !MODES.includes(mode)) return badRequest('"mode" must be one of: auto, deterministic, llm.');
  // outputDir is resolved on the sakirea host; default to this app's outputs/research.
  const dir = typeof outputDir === 'string' && outputDir.trim() ? outputDir.trim() : OUTPUT_DIR;
  const body = { topic: t, outputDir: dir };
  if (mode !== undefined) body.mode = mode;
  return request(`/api/workflows/${id}/run`, { method: 'POST', body, timeoutMs: WORKFLOW_TIMEOUT_MS });
}
