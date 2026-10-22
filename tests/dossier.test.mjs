import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDossier, buildProjection } from '../src/dossier.mjs';
import { divergence, flagStatus } from '../src/divergence.mjs';

const readJson = async (f) => JSON.parse(await readFile(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const programs = await readJson('programs.json');
const panel = await readJson('panel.json');
const program = programs[0];

test('dossier is deterministic for the same programme', () => {
  const a = buildDossier(program, panel);
  const b = buildDossier(program, panel);
  assert.deepEqual(a.projection, b.projection);
  assert.deepEqual(a.analysts.map((x) => x.p), b.analysts.map((x) => x.p));
});

test('every analyst gets a probability inside the clamp and a rationale', () => {
  const d = buildDossier(program, panel);
  assert.equal(d.analysts.length, 6);
  for (const a of d.analysts) {
    assert.ok(a.p >= 0.04 && a.p <= 0.96, `p out of range: ${a.p}`);
    assert.ok(a.rationale.length > 0, 'rationale is empty');
    assert.ok(a.persona.name && a.model.name);
  }
});

test('aggregate is the trimmed mean and sits inside the trimmed range', () => {
  const analysts = [0.1, 0.2, 0.5, 0.6, 0.9, 0.95].map((p) => ({ p }));
  const projection = buildProjection(analysts, 0.5);
  const trimmed = [0.2, 0.5, 0.6, 0.9];
  const mean = trimmed.reduce((s, x) => s + x, 0) / trimmed.length;
  assert.equal(projection.aggregate, Number(mean.toFixed(3)));
  assert.equal(projection.low, 0.2);
  assert.equal(projection.high, 0.9);
  assert.equal(projection.n, 6);
});

test('findings carry their rubric cell and only cite real evidence', () => {
  const d = buildDossier(program, panel);
  const ids = new Set(d.evidence.map((e) => e.id));
  assert.ok(d.findings.length > 0);
  for (const f of d.findings) {
    assert.ok(f.cell, `finding ${f.id} has no cell`);
    for (const c of f.citations) assert.ok(ids.has(c), `citation ${c} is not in the evidence set`);
  }
});

test('coverage counts supported evidence only', () => {
  const d = buildDossier(program, panel);
  const supported = d.evidence.filter((e) => e.status === 'supported').length;
  assert.equal(d.coverage, Number((supported / d.evidence.length).toFixed(2)));
});

test('every fixture programme builds a dossier without throwing', () => {
  for (const p of programs) {
    const d = buildDossier(p, panel);
    assert.equal(d.program.id, p.id);
    assert.ok(d.projection.n > 0);
  }
});

test('flag status labels follow the share, including none', () => {
  assert.equal(flagStatus(0), 'none');
  assert.equal(flagStatus(1 / 6), 'lone');
  assert.equal(flagStatus(2 / 6), 'split');
  assert.equal(flagStatus(6 / 6), 'unanimous');
  assert.equal(flagStatus(5 / 6), 'mostly');
});

test('divergence lists every flag exactly once across cells', () => {
  const d = divergence(programs, panel);
  const flagIds = d.programs.flatMap((p) => p.cells.flatMap((c) => c.flags.map((f) => `${p.id}:${f.id}`)));
  const expected = programs.flatMap((p) => p.designFlags.map((f) => `${p.id}:${f.id}`));
  assert.equal(flagIds.length, expected.length);
  assert.deepEqual([...flagIds].sort(), [...expected].sort());
  assert.equal(d.totals.flags, expected.length);
});

test('raised and not-raised always partition the model set', () => {
  const d = divergence(programs, panel);
  for (const p of d.programs) {
    for (const cell of p.cells) {
      for (const f of cell.flags) {
        assert.equal(f.raised.length + f.notRaised.length, d.modelCount);
        assert.equal(f.share, Number((f.raised.length / d.modelCount).toFixed(3)));
        assert.equal(f.status, flagStatus(f.share));
      }
    }
  }
});

test('a flag nobody raises stays at zero instead of being promoted', () => {
  // low severity with six models: ~10% of draws produce no raise at all. The
  // prototype promoted the nearest model so 0/6 could never appear.
  const program = { id: 'synthetic-zero', designFlags: [{ id: 'f1', cell: 'design', severity: 'low', title: 't', detail: 'd', evidenceIds: [] }] };
  const zeros = [];
  for (let i = 0; i < 400; i++) {
    const p = { ...program, id: `synthetic-zero-${i}` };
    const d = divergence([p], panel);
    const flag = d.programs[0].cells.find((c) => c.cell === 'design').flags[0];
    if (flag.status === 'none') zeros.push(flag);
  }
  assert.ok(zeros.length > 0, 'expected at least one 0/6 flag across 400 programmes');
  for (const f of zeros) assert.equal(f.raised.length, 0);
});
