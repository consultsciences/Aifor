// Divergence map: which models raise which design flag, per rubric cell.
//
// Fixture stand-in for per-model critique — a deterministic seeded draw weighted
// by severity — swapped for real model calls when the panel is wired. Two fixes
// from the prototype version: no flag is ever "promoted" to guarantee a raise
// (that made a 0/6 cell impossible and quietly fabricated agreement), and every
// flag in a cell is returned, not truncated by the client.

export const RUBRIC_CELLS = [
  { id: 'design', label: 'Design' },
  { id: 'endpoint', label: 'Endpoint' },
  { id: 'power', label: 'Power / N' },
  { id: 'eligibility', label: 'Eligibility' },
  { id: 'comparator', label: 'Comparator' },
  { id: 'feasibility', label: 'Feasibility' },
  { id: 'regulatory', label: 'Regulatory' },
  { id: 'evidence', label: 'Evidence' },
];

export const RAISE_P = { high: 0.78, medium: 0.5, low: 0.32 };

export function flagStatus(share) {
  if (share <= 0) return 'none';
  if (share >= 0.999) return 'unanimous';
  if (share >= 0.66) return 'mostly';
  if (share >= 0.33) return 'split';
  return 'lone';
}

function seedDraw(programId, flagId, modelId) {
  // one deterministic draw per (programme, flag, model)
  let a = 2166136261;
  const s = `${programId}|${flagId}|${modelId}`;
  for (let i = 0; i < s.length; i++) {
    a ^= s.charCodeAt(i);
    a = Math.imul(a, 16777619);
  }
  a >>>= 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function divergence(programs, panel) {
  const models = panel.models || [];
  const modelRefs = models.map((m) => ({ id: m.id, name: m.name }));

  const programsOut = programs.map((program) => {
    let flags = 0;
    let unanimous = 0;
    let contested = 0;
    let unraised = 0;

    const cells = RUBRIC_CELLS.map((cdef) => {
      const cellFlags = (program.designFlags || [])
        .filter((f) => f.cell === cdef.id)
        .map((f) => {
          const p = RAISE_P[f.severity] ?? 0.5;
          const draws = modelRefs.map((m) => ({ ...m, r: seedDraw(program.id, f.id, m.id) }));
          const raised = draws.filter((d) => d.r < p);
          const notRaised = draws.filter((d) => d.r >= p);
          const share = models.length ? raised.length / models.length : 0;
          const status = flagStatus(share);
          flags += 1;
          if (status === 'unanimous') unanimous += 1;
          if (status === 'split' || status === 'lone') contested += 1;
          if (status === 'none') unraised += 1;
          return {
            id: f.id,
            severity: f.severity,
            title: f.title,
            detail: f.detail,
            evidenceIds: f.evidenceIds || [],
            raised: raised.map(({ id, name }) => ({ id, name })),
            notRaised: notRaised.map(({ id, name }) => ({ id, name })),
            share: Number(share.toFixed(3)),
            status,
          };
        });
      return { cell: cdef.id, label: cdef.label, flags: cellFlags };
    });

    return {
      id: program.id,
      title: program.title,
      area: program.area,
      phase: program.phase,
      cells,
      stats: { flags, unanimous, contested, unraised },
    };
  });

  const totals = programsOut.reduce(
    (acc, p) => ({
      flags: acc.flags + p.stats.flags,
      unanimous: acc.unanimous + p.stats.unanimous,
      contested: acc.contested + p.stats.contested,
      unraised: acc.unraised + p.stats.unraised,
    }),
    { flags: 0, unanimous: 0, contested: 0, unraised: 0 },
  );

  return {
    cells: RUBRIC_CELLS,
    modelCount: models.length,
    models: modelRefs,
    programs: programsOut,
    totals,
    fixture: true,
  };
}
