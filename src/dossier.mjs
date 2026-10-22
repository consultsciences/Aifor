// Dossier construction: panel assignment, per-analyst probabilities,
// aggregation, findings with citations.
//
// One copy, used by both the fixture store and the PostgreSQL store. The old
// pair of servers each carried their own copy; the deployed one drifted and
// referenced variables that did not exist in its own scope, so every dossier
// request 500'd while /api/meta stayed green.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickAnalysts(program, panel) {
  const rnd = mulberry32(hashSeed(program.id));
  const personas = [...panel.personas];
  const models = [...panel.models];
  for (let i = personas.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [personas[i], personas[j]] = [personas[j], personas[i]];
  }
  for (let i = models.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [models[i], models[j]] = [models[j], models[i]];
  }
  const n = Math.min(panel.personas.length, panel.models.length, 6);
  return Array.from({ length: n }, (_, i) => ({ persona: personas[i], model: models[i] }));
}

function rationale(persona, program, p, refs) {
  const pct = Math.round(p * 100);
  const base = Math.round(program.baseRate.value * 100);
  const cited = refs.map((r) => r.id).join(', ');
  const templates = persona.templates || [];
  if (!templates.length) return '';
  const t = templates[Math.floor(hashSeed(program.id + persona.id) / 97) % templates.length];
  return t
    .replaceAll('{pct}', String(pct))
    .replaceAll('{base}', String(base))
    .replaceAll('{endpoint}', program.endpoint || '')
    .replaceAll('{indication}', program.indication || '')
    .replaceAll('{n}', String(program.n ?? ''))
    .replaceAll('{cited}', cited);
}

export function buildProjection(analysts, baseRateValue) {
  const sorted = analysts.map((a) => a.p).sort((x, y) => x - y);
  const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
  const mean = trimmed.reduce((s, x) => s + x, 0) / trimmed.length;
  const sd = Math.sqrt(analysts.reduce((s, a) => s + (a.p - mean) ** 2, 0) / analysts.length);
  return {
    aggregate: Number(mean.toFixed(3)),
    low: Number(trimmed[0].toFixed(3)),
    high: Number(trimmed[trimmed.length - 1].toFixed(3)),
    disagreement: Number(sd.toFixed(3)),
    baseRate: baseRateValue,
    delta: Number((mean - baseRateValue).toFixed(3)),
    n: analysts.length,
  };
}

export function buildDossier(program, panel) {
  const rnd = mulberry32(hashSeed(`${program.id}:panel`));
  const analysts = pickAnalysts(program, panel).map(({ persona, model }) => {
    const drift = (rnd() - 0.5) * 0.22 + (persona.bias || 0);
    const p = clamp(program.baseRate.value + drift, 0.04, 0.96);
    const refs = (program.evidence || [])
      .filter((e) => e.status !== 'not_found')
      .slice(0, 2 + Math.floor(rnd() * 2));
    return {
      persona: { id: persona.id, name: persona.name, lens: persona.lens },
      model: { id: model.id, name: model.name },
      p: Number(p.toFixed(3)),
      confidence: Number((0.45 + rnd() * 0.4).toFixed(2)),
      rationale: rationale(persona, program, p, refs),
      citations: refs.map((r) => r.id),
    };
  });

  const projection = buildProjection(analysts, program.baseRate.value);
  const evidence = program.evidence || [];
  const coverage = evidence.length
    ? evidence.filter((e) => e.status === 'supported').length / evidence.length
    : 0;

  const evidenceIds = new Set(evidence.map((e) => e.id));
  const findings = (program.designFlags || []).map((f) => {
    const wanted = f.evidenceIds || [];
    const citations = wanted.filter((id) => evidenceIds.has(id));
    return {
      id: f.id,
      cell: f.cell || null,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      citations,
    };
  });

  return {
    program: {
      id: program.id,
      title: program.title,
      sponsor: program.sponsor,
      area: program.area,
      phase: program.phase,
      indication: program.indication,
      endpoint: program.endpoint,
      comparator: program.comparator,
      n: program.n,
      durationMonths: program.durationMonths,
      readoutWindow: program.readoutWindow,
      baseRate: program.baseRate,
      summary: program.summary,
    },
    projection,
    analysts,
    findings,
    evidence,
    coverage: Number(coverage.toFixed(2)),
    generatedAt: new Date().toISOString(),
    fixture: Boolean(program.synthetic ?? true),
  };
}
