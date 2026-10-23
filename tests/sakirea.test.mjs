// Sakirea research-proxy contract — enabled path.
//
// Boots the real app in-process (createApp + listen on an ephemeral port) against
// an in-test sakirea stand-in, then exercises the five /api/research/* routes.
// No child processes and no external network.
//
// The client reads its config at import time, so SAKIREA_URL is set before the
// dynamic import of the app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- akirea stand-in ----------------------------------------------------------
const stub = await new Promise((resolve) => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let parsed = null;
      if (body) { try { parsed = JSON.parse(body); } catch { parsed = null; } }
      requests.push({ method: req.method, path: url.pathname, body: parsed });
      const json = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === '/api/health') return json(200, { ok: true, name: 'sakirea', version: 'stub' });
      if (url.pathname === '/api/sources') {
        return json(200, {
          tool: 'sakirea_science_database_search',
          sources: [{ id: 'pubmed', docs: 'https://pubmed.ncbi.nlm.nih.gov/help/', endpoints: ['https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'] }],
        });
      }
      if (url.pathname === '/api/workflows') {
        return json(200, { workflows: [{ id: 'deepresearch', name: 'Deep research', args: { topic: 'string' } }] });
      }
      if (req.method === 'POST' && url.pathname === '/api/search') {
        if (parsed?.query === 'ERROR500') {
          return json(500, { error: { code: 'internal_error', message: 'stub blew up' } });
        }
        return json(200, {
          schema: 'sakirea.search.v1',
          source: parsed?.source,
          query: parsed?.query,
          returned: 1,
          results: [{ id: 'stub-1', title: 'Stub result' }],
        });
      }
      const run = /^\/api\/workflows\/([A-Za-z0-9_-]+)\/run$/.exec(url.pathname);
      if (req.method === 'POST' && run) {
        return json(200, {
          slug: `${run[1]}-stub-slug`,
          workflowId: run[1],
          status: 'complete',
          mode: parsed?.mode ?? 'auto',
          results: 2,
          blocked: [],
        });
      }
      return json(404, { error: { code: 'not_found', message: 'no stub route' } });
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, port, requests });
  });
});

process.env.SAKIREA_URL = `http://127.0.0.1:${stub.port}`;
delete process.env.SAKIREA_DISABLED;
delete process.env.SAKIREA_OUTPUT_DIR;

const { createApp } = await import('../src/app.mjs');
const { createFixtureStore } = await import('../src/store-fixture.mjs');

// ---- app under test -----------------------------------------------------------
const dataDir = await mkdtemp(path.join(tmpdir(), 'aifor-sakirea-'));
for (const f of ['programs.json', 'panel.json', 'ledger.json']) {
  await cp(path.join(ROOT, 'data', f), path.join(dataDir, f));
}
const store = await createFixtureStore({ dataDir });
const app = createApp({ store, publicDir: path.join(ROOT, 'public'), log: { error() {} } });
await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.address().port}`;

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = async (p, body) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test.after(() => new Promise((resolve) => app.close(resolve)));
test.after(() => new Promise((resolve) => stub.server.close(resolve)));

test('config reports the stub as enabled', async () => {
  const r = await get('/api/research/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.url, `http://127.0.0.1:${stub.port}`);
});

test('sources and workflows pass through', async () => {
  const src = await get('/api/research/sources');
  assert.equal(src.status, 200);
  assert.equal(src.body.sources[0].id, 'pubmed');

  const wf = await get('/api/research/workflows');
  assert.equal(wf.status, 200);
  assert.equal(wf.body.workflows[0].id, 'deepresearch');
});

test('search proxies and forwards the body', async () => {
  const r = await post('/api/research/search', { source: 'pubmed', query: 'semaglutide', limit: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.query, 'semaglutide');
  assert.equal(r.body.returned, 1);
  const last = stub.requests.filter((q) => q.path === '/api/search').pop();
  assert.equal(last.body.source, 'pubmed');
  assert.equal(last.body.limit, 3);
});

test('workflow run always sends an outputDir', async () => {
  const r = await post('/api/research/workflows/deepresearch/run', { topic: 'glp-1 obesity trials' });
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, 'deepresearch-stub-slug');
  const last = stub.requests.filter((q) => /\/run$/.test(q.path)).pop();
  assert.equal(typeof last.body.outputDir, 'string');
  assert.ok(last.body.outputDir.length > 0);
});

test('upstream non-2xx becomes sakirea_upstream_error 502', async () => {
  const r = await post('/api/research/search', { source: 'pubmed', query: 'ERROR500' });
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, 'sakirea_upstream_error');
  assert.equal(r.body.error.upstreamStatus, 500);
});

test('validation rejects bad input locally without touching the upstream', async () => {
  const before = stub.requests.length;
  const cases = [
    [{ query: 'x' }, 'missing source'],
    [{ source: '', query: 'x' }, 'empty source'],
    [{ source: 'pubmed', query: '' }, 'empty query'],
    [{ source: 'pubmed', query: 'x'.repeat(501) }, 'query too long'],
    [{ source: 'pubmed', query: 'x', limit: 0 }, 'limit below range'],
    [{ source: 'pubmed', query: 'x', limit: 21 }, 'limit above range'],
  ];
  for (const [input, label] of cases) {
    const r = await post('/api/research/search', input);
    assert.equal(r.status, 400, label);
    assert.equal(r.body.error.code, 'bad_request', label);
  }

  const badWorkflow = await post('/api/research/workflows/notaworkflow/run', { topic: 'valid topic' });
  assert.equal(badWorkflow.status, 400);

  const shortTopic = await post('/api/research/workflows/deepresearch/run', { topic: 'x' });
  assert.equal(shortTopic.status, 400);

  assert.equal(stub.requests.length, before, 'invalid input never reached the stub');
});

test('unknown method on a research route is 405', async () => {
  const res = await fetch(`${base}/api/research/sources`, { method: 'DELETE' });
  assert.equal(res.status, 405);
});
