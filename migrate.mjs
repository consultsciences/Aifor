// Migrate synthetic fixtures to PostgreSQL (Dokploy/Hostinger setup).
// Uses `pg`. Set DATABASE_URL to the connection string provided by Dokploy / Postgres.
// Example: DATABASE_URL=postgresql://user:pass@localhost/db node migrate.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');

const url = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/clinical';
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000, max: 3 });

// Helper: run a query with positional params
const run = async (q, params = []) => {
  const c = await pool.connect();
  try {
    return await c.query(q, params);
  } finally {
    c.release();
  }
};

async function migrate() {
  console.log('DATABASE_URL=', process.env.DATABASE_URL ? '<set>' : 'NOT SET (using default)');
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } catch (e) {
    console.error('PostgreSQL connection failed:', e.message);
    console.log('Ensure DATABASE_URL is set (Dokploy provides it) and server is reachable.');
    process.exit(1);
  } finally {
    client.release();
  }

  // Create tables (idempotent via IF NOT EXISTS is handled by schema SQL; here we apply minimal set)
  console.log('Applying schema...');
  await run(`
    CREATE TABLE IF NOT EXISTS programs (
      id VARCHAR(60) PRIMARY KEY,
      title TEXT, sponsor VARCHAR(256), area VARCHAR(64), phase VARCHAR(16),
      indication TEXT, endpoint TEXT, comparator TEXT, n INTEGER,
      duration_months INTEGER, readout_window VARCHAR(32),
      base_rate_value DOUBLE PRECISION, base_rate_class VARCHAR(128),
      base_rate_source TEXT, summary TEXT, fixture BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_programs_area ON programs(area);`);

  await run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id VARCHAR(32) PRIMARY KEY,
      hash VARCHAR(64) NOT NULL UNIQUE,
      program_id VARCHAR(60) REFERENCES programs(id) ON DELETE CASCADE,
      projection JSONB, evidence_ids TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now(), fixture BOOLEAN DEFAULT true
    );
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_reg_time ON registrations(created_at DESC);`);

  await run(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // Load fixtures
  const programsData = JSON.parse(await readFile(path.join(DATA, 'programs.json'), 'utf8'));
  const registrationsData = await (async () => {
    try {
      return JSON.parse(await readFile(path.join(DATA, 'registrations.json'), 'utf8'));
    } catch { return []; }
  })();

  console.log('Inserting programs:', programsData.length);
  for (const p of programsData) {
    await run(
      `INSERT INTO programs (id, title, sponsor, area, phase, indication, endpoint, comparator, n, duration_months, readout_window, base_rate_value, base_rate_class, base_rate_source, summary, fixture)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO NOTHING`,
      [
        p.id, p.title, p.sponsor || null, p.area, p.phase, p.indication || null,
        p.endpoint || null, p.comparator || null, p.n || null,
        p.durationMonths || null, p.readoutWindow || null,
        p.baseRate ? p.baseRate.value : null, p.baseRate ? p.baseRate.class : null,
        p.baseRate ? p.baseRate.source : null, p.summary || null, true
      ]
    );

    // Evidence spans
    if (p.evidence && p.evidence.length) {
      for (const e of p.evidence) {
        await run(
          `CREATE TABLE IF NOT EXISTS evidence (
            id VARCHAR(32) PRIMARY KEY,
            program_id VARCHAR(60) REFERENCES programs(id) ON DELETE CASCADE,
            claim TEXT NOT NULL, source VARCHAR(256), span TEXT,
            status VARCHAR(32) CHECK (status IN ('supported','partial','contradicted','not_found')),
            synthetic BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
          );`
        );
        await run(
          `INSERT INTO evidence (id, program_id, claim, source, span, status, synthetic) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [e.id, p.id, e.claim || e.title || '', e.source || null, e.span || null, e.status || 'not_found', true]
        );
      }
    }
  }

  console.log('Inserting registrations:', registrationsData.length);
  for (const r of registrationsData) {
    await run(
      `INSERT INTO registrations (id, hash, program_id, projection, evidence_ids, fixture) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [
        r.id, r.hash, r.programId || r.program_id,
        JSON.stringify(r.projection || r.projection || {}),
        r.evidenceIds || r.evidence_ids || [],
        true
      ]
    );
  }

  console.log('Migration complete.');
  const total = await run('SELECT COUNT(*) FROM programs');
  console.log('Programs in DB:', total.rows[0].count);
  await pool.end();
}

migrate().catch((e) => {
  console.error('Migration failed:', e.message);
  process.exit(2);
});
