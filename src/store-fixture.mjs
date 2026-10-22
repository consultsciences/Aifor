// Fixture store: the synthetic prototype data, no database.
//
// Registrations persist to data/registrations.json. There is no cap and no
// silent truncation — the old code wrote only the newest 200 registrations to
// disk while keeping the rest in memory, so a restart quietly deleted the tail
// of an append-only ledger.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
};

const sortNewestFirst = (rows) =>
  [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

export async function createFixtureStore({ dataDir }) {
  const programs = await readJson(path.join(dataDir, 'programs.json'));
  const panel = await readJson(path.join(dataDir, 'panel.json'));
  const ledger = await readJson(path.join(dataDir, 'ledger.json'), []);
  const registrationsFile = path.join(dataDir, 'registrations.json');
  let registrations = existsSync(registrationsFile)
    ? await readJson(registrationsFile, [])
    : [];
  registrations = registrations.map((r) => ({
    ...r,
    createdAt: r.createdAt || r.created_at,
  }));

  const byId = new Map(programs.map((p) => [p.id, p]));

  return {
    mode: 'fixture',
    dbConnected: false,
    async health() {
      return true;
    },
    async listPrograms() {
      return byId;
    },
    async getPanel() {
      return panel;
    },
    async ledgerRows() {
      return ledger;
    },
    async listRegistrations({ limit = 50, programId = null } = {}) {
      const rows = programId
        ? registrations.filter((r) => r.programId === programId)
        : registrations;
      return sortNewestFirst(rows).slice(0, limit);
    },
    async countRegistrations({ programId = null } = {}) {
      return programId
        ? registrations.filter((r) => r.programId === programId).length
        : registrations.length;
    },
    async findRegistrationForProgram(programId) {
      return sortNewestFirst(registrations.filter((r) => r.programId === programId))[0] || null;
    },
    async getRegistration(id) {
      return registrations.find((r) => r.id === id) || null;
    },
    async addRegistration(entry) {
      const existing = registrations.find(
        (r) => r.programId === entry.programId && r.hash === entry.hash,
      );
      if (existing) return { entry: existing, created: false };
      const stored = { ...entry, createdAt: new Date().toISOString() };
      registrations.unshift(stored);
      await mkdir(dataDir, { recursive: true });
      // whole append-only ledger, no slice()
      await writeFile(registrationsFile, JSON.stringify(registrations, null, 2), 'utf8');
      return { entry: stored, created: true };
    },
  };
}
