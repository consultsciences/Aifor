// Sakirea research-proxy contract — disabled path.
//
// SAKIREA_DISABLED=1 is set before the app (and therefore the client) is
// imported, so this file must run in its own process — which node --test does
// per test file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

process.env.SAKIREA_DISABLED = '1';
delete process.env.SAKIREA_URL;

const { createApp } = await import('../src/app.mjs');
const { createFixtureStore } = await import('../src/store-fixture.mjs');

const dataDir = await mkdtemp(path.join(tmpdir(), 'aifor-sakirea-off-'));
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

test('config reports the integration off', async () => {
  const r = await get('/api/research/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.enabled, false);
});

test('every proxied call answers 503 sakirea_disabled', async () => {
  const calls = [
    ['sources', () => get('/api/research/sources')],
    ['workflows', () => get('/api/research/workflows')],
    ['search', () => post('/api/research/search', { source: 'pubmed', query: 'glp-1' })],
    ['run', () => post('/api/research/workflows/deepresearch/run', { topic: 'glp-1 obesity' })],
  ];
  for (const [label, call] of calls) {
    const r = await call();
    assert.equal(r.status, 503, label);
    assert.equal(r.body.error.code, 'sakirea_disabled', label);
    assert.ok(r.body.error.message.length > 0, label);
  }
});

test('disabled wins over invalid input', async () => {
  // A switched-off integration answers sakirea_disabled, not bad_request, so a
  // disabled deployment is unambiguous to callers.
  const r = await post('/api/research/search', {});
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'sakirea_disabled');
});

test('the rest of the app is unaffected', async () => {
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  const meta = await get('/api/meta');
  assert.equal(meta.status, 200);
  const programs = await get('/api/programs');
  assert.equal(programs.status, 200);
  assert.ok(programs.body.length > 0);
});
