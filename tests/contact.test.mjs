// Contact form and legal-page tests.
//
// The form is a plain HTML post (no inline script, so it works under the strict CSP),
// so these tests post application/x-www-form-urlencoded the way a browser would.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureStore } from '../src/store-fixture.mjs';
import { createApp } from '../src/app.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let dataDir;
let server;
let base;

const form = (fields) => new URLSearchParams(fields).toString();

const postForm = async (fields) => {
  const res = await fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(fields),
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'aifor-contact-'));
  for (const f of ['programs.json', 'panel.json', 'ledger.json']) {
    await cp(path.join(ROOT, 'data', f), path.join(dataDir, f));
  }
  const store = await createFixtureStore({ dataDir });
  const app = createApp({ store, publicDir: path.join(ROOT, 'public'), dataDir, contactMaxPerHour: 50 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await rm(dataDir, { recursive: true, force: true });
});

test('privacy, terms and contact pages are served as HTML', async () => {
  for (const page of ['/privacy', '/terms', '/contact']) {
    const res = await fetch(base + page);
    assert.equal(res.status, 200, page);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const body = await res.text();
    assert.match(body, /Consult Sciences Ltd/, `${page} names the operator`);
    assert.match(body, /17155547/, `${page} carries the company number`);
  }
});

test('the contact form posts and is spooled to disk', async () => {
  const res = await postForm({
    name: 'Ada Lovelace', email: 'ada@example.org',
    subject: 'Question', message: 'How is the panel weighted?',
  });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/contact?sent=1');

  const spool = await readFile(path.join(dataDir, 'contact-messages.jsonl'), 'utf8');
  const last = JSON.parse(spool.trim().split('\n').pop());
  assert.equal(last.email, 'ada@example.org');
  assert.equal(last.subject, 'Question');
  assert.match(last.message, /panel weighted/);
  assert.ok(last.receivedAt, 'timestamp recorded');
});

test('a filled honeypot is answered like success but stores nothing', async () => {
  const before = await readFile(path.join(dataDir, 'contact-messages.jsonl'), 'utf8');
  const res = await postForm({
    name: 'Bot', email: 'bot@example.org', message: 'buy now', website: 'http://spam.example',
  });
  assert.equal(res.status, 303, 'the bot sees the same redirect as a person');
  const after = await readFile(path.join(dataDir, 'contact-messages.jsonl'), 'utf8');
  assert.equal(after, before, 'nothing was written');
});

test('invalid submissions are refused', async () => {
  const noName = await postForm({ email: 'a@example.org', message: 'hello' });
  assert.equal(noName.status, 400);
  const noMessage = await postForm({ name: 'A', email: 'a@example.org' });
  assert.equal(noMessage.status, 400);
  const badEmail = await postForm({ name: 'A', email: 'not-an-email', message: 'hello' });
  assert.equal(badEmail.status, 400);
});

test('GET on the intake route is refused', async () => {
  const res = await fetch(base + '/api/contact');
  assert.equal(res.status, 405);
});

test('the legal pages carry no inline script or style (strict CSP)', async () => {
  for (const page of ['privacy', 'terms', 'contact']) {
    const body = await readFile(path.join(ROOT, 'public', 'legal', `${page}.html`), 'utf8');
    assert.doesNotMatch(body, /<script(?![^>]*\bsrc=)/i, `${page} has no inline script`);
    assert.doesNotMatch(body, /\sstyle="/i, `${page} has no inline style`);
  }
});

test('the per-IP limit refuses the fourth message in an hour', async () => {
  const limitedDir = await mkdtemp(path.join(tmpdir(), 'aifor-contact-rl-'));
  for (const f of ['programs.json', 'panel.json', 'ledger.json']) {
    await cp(path.join(ROOT, 'data', f), path.join(limitedDir, f));
  }
  const store = await createFixtureStore({ dataDir: limitedDir });
  const app = createApp({ store, publicDir: path.join(ROOT, 'public'), dataDir: limitedDir, contactMaxPerHour: 2 });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const send = (n) => fetch(`${b}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'A', email: `a${n}@example.org`, message: `m${n}` }).toString(),
    redirect: 'manual',
  });
  const codes = [];
  for (let i = 0; i < 3; i += 1) codes.push((await send(i)).status);
  await new Promise((r) => srv.close(r));
  await rm(limitedDir, { recursive: true, force: true });
  assert.deepEqual(codes, [303, 303, 429]);
});
