import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureStore } from '../src/store-fixture.mjs';
import { createApp } from '../src/app.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let dataDir;
let server;
let base;

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};
const post = async (p, body, raw) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'aifor-api-'));
  for (const f of ['programs.json', 'panel.json', 'ledger.json']) {
    await cp(path.join(ROOT, 'data', f), path.join(dataDir, f));
  }
  const store = await createFixtureStore({ dataDir });
  const app = createApp({ store, publicDir: path.join(ROOT, 'public'), log: { error() {} } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.address().port}`;
  server = app;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

test('health reports the store mode', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'fixture');
});

test('meta exposes mode and the fixture flag', async () => {
  const { status, body } = await get('/api/meta');
  assert.equal(status, 200);
  assert.equal(body.mode, 'fixture');
  assert.equal(body.fixture, true);
  assert.equal(body.dbConnected, false);
  assert.ok(body.models.length >= 6);
});

test('programme registry lists every programme', async () => {
  const { status, body } = await get('/api/programs');
  assert.equal(status, 200);
  assert.equal(body.length, 6);
  assert.ok(body.every((p) => p.id && typeof p.baseRate === 'number'));
});

test('dossier returns 200 with projection, analysts, findings and registration slot', async () => {
  const { status, body } = await get('/api/programs/hx-101-nsclc');
  assert.equal(status, 200, 'this was the 500 in the deployed server');
  assert.equal(body.program.id, 'hx-101-nsclc');
  assert.ok(body.analysts.length > 0);
  assert.ok(body.projection.n === body.analysts.length);
  assert.equal(body.registration, null);
});

test('unknown programme is 404 and unknown route is 404', async () => {
  assert.equal((await get('/api/programs/nope')).status, 404);
  assert.equal((await get('/api/unknown')).status, 404);
});

test('divergence is served over the same surface', async () => {
  const { status, body } = await get('/api/divergence');
  assert.equal(status, 200, 'this route did not exist in the deployed server');
  assert.equal(body.cells.length, 8);
  assert.equal(body.programs.length, 6);
  assert.equal(body.modelCount, 6);
});

test('calibration carries the base-rate baseline and skill', async () => {
  const { status, body } = await get('/api/calibration');
  assert.equal(status, 200);
  assert.equal(body.total, 144);
  assert.ok(body.overall.baselineBrier > 0);
  assert.equal(body.overall.skill, Number((body.overall.baselineBrier - body.overall.brier).toFixed(4)));
  assert.ok(!('vsBaseRate' in body.overall));
});

test('pre-registration is created once and then reported as a duplicate', async () => {
  const first = await post('/api/preregister', { programId: 'hx-101-nsclc' });
  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);
  assert.match(first.body.hash, /^[0-9a-f]{64}$/);

  const second = await post('/api/preregister', { programId: 'hx-101-nsclc' });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.id, first.body.id, 'the same forecast must get the same id');

  const list = await get('/api/registrations');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.entries.length, 1);
});

test('the registered projection is exposed on the dossier so the UI can lock itself', async () => {
  const { body } = await get('/api/programs/hx-101-nsclc');
  assert.ok(body.registration);
  assert.equal(body.registration.programId, 'hx-101-nsclc');
});

test('the ledger verifies its own hashes', async () => {
  const list = await get('/api/registrations');
  const id = list.body.entries[0].id;
  const v = await get(`/api/registrations/${id}/verify`);
  assert.equal(v.status, 200);
  assert.equal(v.body.valid, true);
  assert.equal(v.body.hash, v.body.recomputedHash);
  assert.equal((await get('/api/registrations/reg_missing/verify')).status, 404);
});

test('a tampered stored row fails verification', async () => {
  const list = await get('/api/registrations');
  const entry = list.body.entries[0];
  const file = path.join(dataDir, 'registrations.json');
  const rows = JSON.parse(await readFile(file, 'utf8'));
  rows[0].projection.aggregate = 0.99;
  await writeFile(file, JSON.stringify(rows), 'utf8');

  // restart the store so it re-reads the file
  const store = await createFixtureStore({ dataDir });
  const app = createApp({ store, publicDir: path.join(ROOT, 'public'), log: { error() {} } });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const res = await fetch(`http://127.0.0.1:${app.address().port}/api/registrations/${entry.id}/verify`);
  const body = await res.json();
  await new Promise((resolve) => app.close(resolve));
  assert.equal(body.valid, false);
});

test('bad input is 4xx with a JSON error, never 5xx', async () => {
  assert.equal((await post('/api/preregister', null, '{bad json')).status, 400);
  assert.equal((await post('/api/preregister', null, '')).status, 400);
  assert.equal((await post('/api/preregister', {})).status, 400);
  assert.equal((await post('/api/preregister', { programId: 'nope' })).status, 404);
  const big = await post('/api/preregister', null, JSON.stringify({ programId: 'x'.repeat(70000) }));
  assert.equal(big.status, 413);
});

test('methods other than GET are rejected on read routes', async () => {
  const res = await fetch(`${base}/api/programs`, { method: 'PUT' });
  assert.equal(res.status, 405);
});

test('HEAD on a static route is answered like GET', async () => {
  const res = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});

test('static files are served with a CSP and traversal is blocked', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy') || '', /default-src 'self'/);
  const trav = await fetch(`${base}/%2e%2e%2fpackage.json`);
  assert.ok([403, 404].includes(trav.status));
});
