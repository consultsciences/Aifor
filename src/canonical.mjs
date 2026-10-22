// Canonical JSON + forecast hashing.
//
// A pre-registration hash is only worth something if someone else can
// recompute it later from stored fields. That rules out JSON.stringify over an
// object built in whatever key order the caller happened to use — JSONB
// reorders keys on the way back out, and JSON.stringify is order-sensitive.
// So: sort keys recursively, sort the evidence id list, and hash that.

import crypto from 'node:crypto';

export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',');
  return `{${body}}`;
}

const round3 = (x) => Number(Number(x).toFixed(3));

// The forecast identity: what was predicted, over which evidence set, for which
// programme. Timestamps are deliberately excluded — locking the same forecast
// twice is a duplicate, not a new forecast, and the ledger has to say so.
export function forecastPayload({ programId, projection, evidenceIds }) {
  const p = projection || {};
  const projectionPart = {
    aggregate: round3(p.aggregate),
    low: round3(p.low),
    high: round3(p.high),
    disagreement: round3(p.disagreement),
    baseRate: round3(p.baseRate),
    delta: round3(p.delta),
    n: Number(p.n ?? 0),
  };
  const ids = [...new Set((evidenceIds || []).map(String))].sort();
  return { programId: String(programId), projection: projectionPart, evidenceIds: ids };
}

export function forecastHash(payload) {
  return crypto.createHash('sha256').update(canonicalJSON(forecastPayload(payload)), 'utf8').digest('hex');
}

export function registrationId(hash) {
  return `reg_${hash.slice(0, 12)}`;
}

// v0.1 sealed the timestamp inside the hash over a non-canonical JSON string
// (key order as constructed, JSON.stringify as-is). Records written then are
// still intact, so verification accepts the old scheme and reports which one
// matched rather than calling an untouched record tampered.
export function legacyHash(row) {
  const payload = {
    programId: row.programId ?? row.program_id,
    projection: row.projection,
    evidenceIds: row.evidenceIds ?? row.evidence_ids,
    createdAt: row.createdAt ?? row.created_at,
    fixture: row.fixture ?? true,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

// Recompute from what was stored. Any drift — a re-scored projection, an
// edited evidence list, a reordered JSONB document — shows up as a mismatch.
export function verifyRegistration(row) {
  if (!row || !row.hash) return { valid: false, reason: 'missing hash' };
  const programId = row.programId ?? row.program_id;
  const projection = row.projection;
  const evidenceIds = row.evidenceIds ?? row.evidence_ids;
  const recomputed = forecastHash({ programId, projection, evidenceIds });
  const createdAt = row.createdAt ?? row.created_at ?? null;

  if (recomputed === row.hash) {
    return { valid: true, scheme: 'canonical-v2', hash: row.hash, recomputedHash: recomputed, programId, createdAt };
  }
  if (createdAt && legacyHash(row) === row.hash) {
    return {
      valid: true,
      scheme: 'legacy-v1',
      hash: row.hash,
      recomputedHash: legacyHash(row),
      programId,
      createdAt,
      note: 'Sealed before v0.2: the timestamp is inside this hash, so it is not comparable to a re-sealed forecast.',
    };
  }
  return { valid: false, scheme: 'mismatch', hash: row.hash, recomputedHash: recomputed, programId, createdAt };
}
