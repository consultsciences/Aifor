// PostgreSQL store. Same interface as the fixture store, so the router (and the
// tests) cannot tell them apart.
//
// Two behaviours the prototype had and this one does not: falling back to
// fixtures when the database is unreachable (a live URL then served synthetic
// data behind a green health check), and swallowing a failed pre-registration
// write and returning 201 anyway.



const toIso = (v) => (v instanceof Date ? v.toISOString() : v);

const rowToRegistration = (row) => ({
  id: row.id,
  hash: row.hash,
  programId: row.program_id,
  projection: row.projection || {},
  evidenceIds: row.evidence_ids || [],
  fixture: row.fixture,
  createdAt: toIso(row.created_at),
});

export async function createPgStore({ connectionString, pool: injected }) {
  // imported lazily so fixture-mode runs need no dependencies at all
  const pg = injected ? null : (await import('pg')).default;
  const pool =
    injected ||
    new pg.Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });

  // Fail here, at boot, rather than at the first request.
  const probe = await pool.query('SELECT 1 AS ok');

  return {
    mode: 'database',
    dbConnected: true,
    pool,
    async health() {
      const r = await pool.query('SELECT 1 AS ok');
      return r.rows[0]?.ok === 1;
    },
    async listPrograms() {
      // Three queries, not 1 + 2N.
      const [programs, evidence, flags] = await Promise.all([
        pool.query('SELECT * FROM programs ORDER BY id'),
        pool.query('SELECT * FROM evidence ORDER BY program_id, id'),
        pool.query('SELECT * FROM design_flags ORDER BY program_id, id'),
      ]);

      const evidenceBy = new Map();
      for (const e of evidence.rows) {
        if (!evidenceBy.has(e.program_id)) evidenceBy.set(e.program_id, []);
        evidenceBy.get(e.program_id).push({
          id: e.id,
          claim: e.claim,
          source: e.source,
          span: e.span,
          status: e.status,
          synthetic: e.synthetic,
        });
      }

      const flagsBy = new Map();
      for (const f of flags.rows) {
        if (!flagsBy.has(f.program_id)) flagsBy.set(f.program_id, []);
        flagsBy.get(f.program_id).push({
          id: f.id,
          cell: f.cell || null,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          evidenceIds: f.evidence_ids || [],
        });
      }

      const map = new Map();
      for (const p of programs.rows) {
        map.set(p.id, {
          id: p.id,
          title: p.title,
          sponsor: p.sponsor,
          area: p.area,
          phase: p.phase,
          indication: p.indication,
          endpoint: p.endpoint,
          comparator: p.comparator,
          n: p.n,
          durationMonths: p.duration_months,
          readoutWindow: p.readout_window,
          baseRate: {
            value: p.base_rate_value,
            class: p.base_rate_class,
            source: p.base_rate_source,
          },
          summary: p.summary,
          designFlags: flagsBy.get(p.id) || [],
          evidence: evidenceBy.get(p.id) || [],
        });
      }
      return map;
    },
    async getPanel() {
      const [personas, models] = await Promise.all([
        pool.query('SELECT * FROM personas ORDER BY id'),
        pool.query('SELECT * FROM models ORDER BY id'),
      ]);
      return {
        personas: personas.rows.map((p) => ({
          id: p.id,
          name: p.name,
          lens: p.lens,
          bias: p.bias || 0,
          templates: p.templates || [],
        })),
        models: models.rows.map((m) => ({ id: m.id, name: m.name })),
      };
    },
    async ledgerRows() {
      const r = await pool.query(
        'SELECT id, model, persona, p, outcome, base_rate, resolved_at FROM ledger ORDER BY id',
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        model: x.model,
        persona: x.persona,
        p: Number(x.p),
        outcome: Number(x.outcome),
        base_rate: Number(x.base_rate),
        resolved_at: toIso(x.resolved_at),
      }));
    },
    async listRegistrations({ limit = 50, programId = null } = {}) {
      const r = programId
        ? await pool.query(
            'SELECT * FROM registrations WHERE program_id = $1 ORDER BY created_at DESC LIMIT $2',
            [programId, limit],
          )
        : await pool.query('SELECT * FROM registrations ORDER BY created_at DESC LIMIT $1', [limit]);
      return r.rows.map(rowToRegistration);
    },
    async countRegistrations({ programId = null } = {}) {
      const r = programId
        ? await pool.query('SELECT count(*)::int AS n FROM registrations WHERE program_id = $1', [
            programId,
          ])
        : await pool.query('SELECT count(*)::int AS n FROM registrations');
      return r.rows[0].n;
    },
    async findRegistrationForProgram(programId) {
      const r = await pool.query(
        'SELECT * FROM registrations WHERE program_id = $1 ORDER BY created_at DESC LIMIT 1',
        [programId],
      );
      return r.rows[0] ? rowToRegistration(r.rows[0]) : null;
    },
    async getRegistration(id) {
      const r = await pool.query('SELECT * FROM registrations WHERE id = $1', [id]);
      return r.rows[0] ? rowToRegistration(r.rows[0]) : null;
    },
    async addRegistration(entry) {
      // The unique index on (program_id, hash) is the duplicate guard.
      const inserted = await pool.query(
        `INSERT INTO registrations (id, hash, program_id, projection, evidence_ids, fixture)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (program_id, hash) DO NOTHING
         RETURNING *`,
        [
          entry.id,
          entry.hash,
          entry.programId,
          JSON.stringify(entry.projection),
          entry.evidenceIds,
          entry.fixture ?? true,
        ],
      );
      if (inserted.rows[0]) return { entry: rowToRegistration(inserted.rows[0]), created: true };
      const existing = await pool.query(
        'SELECT * FROM registrations WHERE program_id = $1 AND hash = $2',
        [entry.programId, entry.hash],
      );
      if (!existing.rows[0]) {
        throw new Error('registration conflict but no existing row found');
      }
      return { entry: rowToRegistration(existing.rows[0]), created: false };
    },
    async close() {
      await pool.end();
    },
  };
}
