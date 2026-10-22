// Scoring: Brier, log loss, calibration gap, and — the one that decides whether
// the panel is worth anything — the comparison against the reference-class
// base rate.
//
// `skill` is the difference between the naive baseline's Brier score and the
// panel's: mean((base_rate - outcome)^2) - mean((p - outcome)^2). Positive means
// the panel beat the reference class. The earlier implementation subtracted the
// Brier score from the *mean base rate* (a probability) and called the result
// "vsBaseRate", which reported ~+0.22 for a panel that was in fact fractionally
// worse than the baseline. A probability is not a score.

const round = (x, d) => Number(Number(x).toFixed(d));

export function stats(rows) {
  const n = rows.length;
  if (!n) return null;
  const brier = rows.reduce((s, r) => s + (r.p - r.outcome) ** 2, 0) / n;
  const baselineBrier = rows.reduce((s, r) => s + (r.base_rate - r.outcome) ** 2, 0) / n;
  const eps = 1e-6;
  const logloss =
    -rows.reduce(
      (s, r) =>
        s +
        (r.outcome * Math.log(Math.min(1 - eps, Math.max(eps, r.p))) +
          (1 - r.outcome) * Math.log(Math.min(1 - eps, Math.max(eps, 1 - r.p)))),
      0,
    ) / n;
  const meanP = rows.reduce((s, r) => s + r.p, 0) / n;
  const observed = rows.reduce((s, r) => s + r.outcome, 0) / n;
  const baseRate = rows.reduce((s, r) => s + r.base_rate, 0) / n;
  return {
    n,
    brier: round(brier, 4),
    logloss: round(logloss, 4),
    baselineBrier: round(baselineBrier, 4),
    // positive = panel better than the reference class
    skill: round(baselineBrier - brier, 4),
    meanP: round(meanP, 3),
    observed: round(observed, 3),
    baseRate: round(baseRate, 3),
    calibrationGap: round(meanP - observed, 3),
  };
}

export function reliabilityBuckets(rows, bins = 5) {
  const out = [];
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const last = i === bins - 1;
    const set = rows.filter((r) => r.p >= lo && (last ? r.p <= hi : r.p < hi));
    if (!set.length) continue;
    out.push({
      bucket: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      n: set.length,
      meanP: round(set.reduce((s, r) => s + r.p, 0) / set.length, 3),
      observed: round(set.reduce((s, r) => s + r.outcome, 0) / set.length, 3),
    });
  }
  return out;
}

export function calibration(rows) {
  const models = [...new Set(rows.map((r) => r.model))].sort();
  return {
    overall: stats(rows),
    rows: models.map((m) => ({ model: m, ...stats(rows.filter((r) => r.model === m)) })),
    buckets: reliabilityBuckets(rows),
    total: rows.length,
    // The base-rate baseline is the honest comparator; say so in the payload so
    // a client cannot present the panel score without it.
    comparator: 'reference-class base rate (mean((base_rate - outcome)^2))',
  };
}
