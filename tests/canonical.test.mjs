import { test } from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { canonicalJSON, forecastHash, registrationId, verifyRegistration } from '../src/canonical.mjs';

const projection = { aggregate: 0.549, low: 0.525, high: 0.578, disagreement: 0.042, baseRate: 0.52, delta: 0.029, n: 6 };
const evidenceIds = ['SYN-204', 'SYN-101'];

test('canonical JSON sorts keys recursively', () => {
  assert.equal(canonicalJSON({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('the hash does not depend on key order', () => {
  const a = forecastHash({ programId: 'p1', projection, evidenceIds });
  const reordered = { n: 6, delta: 0.029, baseRate: 0.52, disagreement: 0.042, high: 0.578, low: 0.525, aggregate: 0.549 };
  const b = forecastHash({ evidenceIds, projection: reordered, programId: 'p1' });
  assert.equal(a, b);
});

test('the hash does not depend on evidence id order or duplicates', () => {
  const a = forecastHash({ programId: 'p1', projection, evidenceIds: ['SYN-101', 'SYN-204'] });
  const b = forecastHash({ programId: 'p1', projection, evidenceIds: ['SYN-204', 'SYN-101', 'SYN-204'] });
  assert.equal(a, b);
});

test('a changed projection changes the hash', () => {
  const a = forecastHash({ programId: 'p1', projection, evidenceIds });
  const b = forecastHash({ programId: 'p1', projection: { ...projection, aggregate: 0.55 }, evidenceIds });
  assert.notEqual(a, b);
});

test('a changed evidence set changes the hash', () => {
  const a = forecastHash({ programId: 'p1', projection, evidenceIds });
  const b = forecastHash({ programId: 'p1', projection, evidenceIds: ['SYN-101'] });
  assert.notEqual(a, b);
});

test('the hash excludes the timestamp, so locking twice is a duplicate', () => {
  const a = forecastHash({ programId: 'p1', projection, evidenceIds, createdAt: '2026-01-01T00:00:00Z' });
  const b = forecastHash({ programId: 'p1', projection, evidenceIds, createdAt: '2027-01-01T00:00:00Z' });
  assert.equal(a, b);
});

test('verification recomputes from a jsonb-shaped row', () => {
  const hash = forecastHash({ programId: 'p1', projection, evidenceIds });
  // postgres returns jsonb with keys in its own order
  const row = { hash, program_id: 'p1', projection: { n: 6, low: 0.525, aggregate: 0.549, high: 0.578, delta: 0.029, baseRate: 0.52, disagreement: 0.042 }, evidence_ids: ['SYN-101', 'SYN-204'] };
  const v = verifyRegistration(row);
  assert.equal(v.valid, true);
  assert.equal(v.recomputedHash, hash);
  assert.equal(v.programId, 'p1');
});

test('verification fails when the projection was edited', () => {
  const hash = forecastHash({ programId: 'p1', projection, evidenceIds });
  const v = verifyRegistration({ hash, program_id: 'p1', projection: { ...projection, aggregate: 0.7 }, evidence_ids: evidenceIds });
  assert.equal(v.valid, false);
});

test('verification fails without a hash', () => {
  assert.equal(verifyRegistration({}).valid, false);
});

test('registration ids are derived from the hash', () => {
  const hash = forecastHash({ programId: 'p1', projection, evidenceIds });
  assert.equal(registrationId(hash), `reg_${hash.slice(0, 12)}`);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('a legacy v0.1 record still verifies, and says so', () => {
  // v0.1 payload: timestamp included, JSON.stringify order, fixture flag
  const createdAt = '2026-10-22T21:38:36.206Z';
  const payload = { programId: 'p1', projection, evidenceIds: ['SYN-101', 'SYN-204'], createdAt, fixture: true };
  const legacy = crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  const v = verifyRegistration({ hash: legacy, program_id: 'p1', projection, evidence_ids: ['SYN-101', 'SYN-204'], created_at: createdAt, fixture: true });
  assert.equal(v.valid, true);
  assert.equal(v.scheme, 'legacy-v1');
  assert.match(v.note, /before v0.2/);
});

test('a legacy hash over an edited projection does not verify', () => {
  const createdAt = '2026-10-22T21:38:36.206Z';
  const payload = { programId: 'p1', projection, evidenceIds, createdAt, fixture: true };
  const legacy = crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
  const v = verifyRegistration({ hash: legacy, program_id: 'p1', projection: { ...projection, aggregate: 0.9 }, evidence_ids: evidenceIds, created_at: createdAt });
  assert.equal(v.valid, false);
  assert.equal(v.scheme, 'mismatch');
});
