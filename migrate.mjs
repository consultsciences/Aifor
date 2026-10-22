// Migrate synthetic fixtures into PostgreSQL. Idempotent.
//
//   DATABASE_URL=postgresql://user:pass@host:5432/db node migrate.mjs
//
// The schema file is the single source of truth: this script applies
// postgres-schema.sql and then loads every fixture table. The prototype version
// hand-rolled a partial schema and silently skipped personas, models,
// design_flags and ledger — which is why a migrated deployment answered 500 on
// /api/programs (design_flags did not exist) while /api/meta looked healthy.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseUrlFromEnv } from './src/config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');

const url = databaseUrlFromEnv(process.env);
if (!url) {
  console.error('no database configured: set DATABASE_URL, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME');
  process.exit(2);
}

const load = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(DATA, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
};

const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10000, max: 4 });

async function main() {
  const client = await pool.connect();
  try {
    const schema = await readFile(path.join(ROOT, 'postgres-schema.sql'), 'utf8');
    console.log('applying postgres-schema.sql …');
    await client.query(schema);

    const programs = await load('programs.json');
    const panel = await load('panel.json');
    const ledger = await load('ledger.json', []);
    const registrations = await load('registrations.json', []);

    await client.query('BEGIN');

    for (const p of panel.personas || []) {
      await client.query(
        `INSERT INTO personas (id, name, lens, bias, templates, synthetic)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lens = EXCLUDED.lens,
           bias = EXCLUDED.bias, templates = EXCLUDED.templates`,
        [p.id, p.name, p.lens || null, p.bias || 0, p.templates || []],
      );
    }

    for (const m of panel.models || []) {
      await client.query(
        `INSERT INTO models (id, name, synthetic) VALUES ($1,$2,true)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [m.id, m.name],
      );
    }

    let evidenceCount = 0;
    let flagCount = 0;
    for (const p of programs) {
      await client.query(
        `INSERT INTO programs (id, title, sponsor, area, phase, indication, endpoint, comparator,
           n, duration_months, readout_window, base_rate_value, base_rate_class, base_rate_source,
           summary, fixture)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, sponsor = EXCLUDED.sponsor, area = EXCLUDED.area,
           phase = EXCLUDED.phase, indication = EXCLUDED.indication, endpoint = EXCLUDED.endpoint,
           comparator = EXCLUDED.comparator, n = EXCLUDED.n,
           duration_months = EXCLUDED.duration_months, readout_window = EXCLUDED.readout_window,
           base_rate_value = EXCLUDED.base_rate_value, base_rate_class = EXCLUDED.base_rate_class,
           base_rate_source = EXCLUDED.base_rate_source, summary = EXCLUDED.summary,
           updated_at = now()`,
        [
          p.id, p.title, p.sponsor || null, p.area || null, p.phase || null,
          p.indication || null, p.endpoint || null, p.comparator || null,
          p.n ?? null, p.durationMonths ?? null, p.readoutWindow || null,
          p.baseRate?.value ?? null, p.baseRate?.class ?? null, p.baseRate?.source ?? null,
          p.summary || null,
        ],
      );

      for (const e of p.evidence || []) {
        await client.query(
          `INSERT INTO evidence (id, program_id, claim, source, span, status, synthetic)
           VALUES ($1,$2,$3,$4,$5,$6,true)
           ON CONFLICT (id) DO UPDATE SET claim = EXCLUDED.claim, source = EXCLUDED.source,
             span = EXCLUDED.span, status = EXCLUDED.status, program_id = EXCLUDED.program_id`,
          [e.id, p.id, e.claim || '', e.source || null, e.span || null, e.status || 'not_found'],
        );
        evidenceCount += 1;
      }

      for (const f of p.designFlags || []) {
        // flag ids are only unique within a programme (f1, f2, f3 …), so the
        // stored key is qualified to keep the primary key honest
        await client.query(
          `INSERT INTO design_flags (id, program_id, cell, severity, title, detail, evidence_ids, synthetic)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true)
           ON CONFLICT (id) DO UPDATE SET program_id = EXCLUDED.program_id, cell = EXCLUDED.cell,
             severity = EXCLUDED.severity, title = EXCLUDED.title, detail = EXCLUDED.detail,
             evidence_ids = EXCLUDED.evidence_ids`,
          [
            `${p.id}:${f.id}`,
            p.id,
            f.cell || null,
            f.severity || 'medium',
            f.title || '',
            f.detail || '',
            f.evidenceIds || [],
          ],
        );
        flagCount += 1;
      }
    }

    let ledgerCount = 0;
    for (const r of ledger) {
      await client.query(
        `INSERT INTO ledger (fixture_id, program_id, model, persona, p, outcome, base_rate, resolved_at, synthetic)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
         ON CONFLICT (fixture_id) DO NOTHING`,
        [
          r.id || null,
          r.program_id || null,
          r.model || null,
          r.persona || null,
          r.p,
          r.outcome,
          r.base_rate,
          r.resolved_at || null,
        ],
      );
      ledgerCount += 1;
    }

    let regCount = 0;
    for (const r of registrations) {
      await client.query(
        `INSERT INTO registrations (id, hash, program_id, projection, evidence_ids, fixture)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (program_id, hash) DO NOTHING`,
        [
          r.id,
          r.hash,
          r.programId || r.program_id,
          JSON.stringify(r.projection || {}),
          r.evidenceIds || r.evidence_ids || [],
        ],
      );
      regCount += 1;
    }

    await client.query('COMMIT');

    const counts = await client.query(`
      SELECT
        (SELECT count(*) FROM programs)::int AS programs,
        (SELECT count(*) FROM evidence)::int AS evidence,
        (SELECT count(*) FROM design_flags)::int AS design_flags,
        (SELECT count(*) FROM personas)::int AS personas,
        (SELECT count(*) FROM models)::int AS models,
        (SELECT count(*) FROM ledger)::int AS ledger,
        (SELECT count(*) FROM registrations)::int AS registrations
    `);
    console.log('loaded from fixtures:', { evidence: evidenceCount, design_flags: flagCount, ledger: ledgerCount, registrations: regCount });
    console.log('rows in database:', counts.rows[0]);

    const orphans = await client.query(
      'SELECT count(*)::int AS n FROM design_flags WHERE cell IS NULL',
    );
    if (orphans.rows[0].n > 0) {
      console.warn(`warning: ${orphans.rows[0].n} design_flags rows have no rubric cell and will not appear in /api/divergence`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('migration failed:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
