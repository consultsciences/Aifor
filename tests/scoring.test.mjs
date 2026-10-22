import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stats, calibration, reliabilityBuckets } from '../src/scoring.mjs';

const rows = [
  { model: 'a', p: 0.9, outcome: 1, base_rate: 0.5 },
  { model: 'a', p: 0.8, outcome: 1, base_rate: 0.5 },
  { model: 'a', p: 0.2, outcome: 0, base_rate: 0.5 },
  { model: 'b', p: 0.5, outcome: 0, base_rate: 0.5 },
];

test('empty input returns null rather than NaN', () => {
  assert.equal(stats([]), null);
});

test('brier is mean squared error of the probability', () => {
  // (0.9-1)^2 + (0.8-1)^2 + (0.2-0)^2 + (0.5-0)^2 = 0.01+0.04+0.04+0.25 = 0.34 / 4
  const s = stats(rows);
  assert.equal(s.brier, 0.085);
  assert.equal(s.n, 4);
});

test('baseline is the reference-class Brier, not the mean base rate', () => {
  // every row has base_rate 0.5: mean((0.5-outcome)^2) = 0.25
  const s = stats(rows);
  assert.equal(s.baselineBrier, 0.25);
  assert.equal(s.skill, 0.165); // 0.25 - 0.085, positive: panel beat the class
  assert.ok(!('vsBaseRate' in s), 'the old probability-minus-score field is gone');
});

test('skill is negative when the panel is worse than the base rate', () => {
  const worse = [
    { model: 'a', p: 0.99, outcome: 0, base_rate: 0.5 },
    { model: 'a', p: 0.01, outcome: 1, base_rate: 0.5 },
  ];
  const s = stats(worse);
  assert.ok(s.brier > s.baselineBrier);
  assert.equal(s.skill, Number((s.baselineBrier - s.brier).toFixed(4)));
  assert.ok(s.skill < 0);
});

test('log loss penalises confident errors and is finite at the edges', () => {
  const edges = [
    { model: 'a', p: 0, outcome: 1, base_rate: 0.5 },
    { model: 'a', p: 1, outcome: 0, base_rate: 0.5 },
  ];
  const s = stats(edges);
  assert.ok(Number.isFinite(s.logloss));
  assert.ok(s.logloss > 10);
});

test('calibration gap is mean forecast minus observed rate', () => {
  const s = stats(rows);
  assert.equal(s.meanP, 0.6);
  assert.equal(s.observed, 0.5);
  assert.equal(s.calibrationGap, 0.1);
});

test('per-model rows and buckets are consistent with the overall row', () => {
  const c = calibration(rows);
  assert.equal(c.total, 4);
  assert.equal(c.rows.length, 2);
  assert.equal(c.rows.find((r) => r.model === 'a').n, 3);
  assert.match(c.comparator, /base rate/);
  const bucketN = c.buckets.reduce((s, b) => s + b.n, 0);
  assert.equal(bucketN, 4, 'every row lands in exactly one bucket');
});

test('the top bucket includes p = 1', () => {
  const b = reliabilityBuckets([{ model: 'a', p: 1, outcome: 1, base_rate: 0.5 }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].n, 1);
});
