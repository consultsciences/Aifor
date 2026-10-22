import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const programs = JSON.parse(await readFile(path.join(ROOT, 'data', 'programs.json'), 'utf8'));
const panel = JSON.parse(await readFile(path.join(ROOT, 'data', 'panel.json'), 'utf8'));

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const modelBias = {
  'qwen3-max': 0.01,
  'glm-5': -0.02,
  'deepseek-v3.2': 0.0,
  'gpt-5-mini': 0.06,
  'claude-haiku-4.5': 0.01,
  'kimi-k2.5': 0.04,
};

const modelScale = {
  'qwen3-max': 0.9,
  'glm-5': 1.0,
  'deepseek-v3.2': 1.05,
  'gpt-5-mini': 1.25,
  'claude-haiku-4.5': 0.95,
  'kimi-k2.5': 1.2,
};

const rows = [];
for (const program of programs) {
  for (const model of panel.models) {
    for (let cycle = 0; cycle < 4; cycle++) {
      const seed = hashSeed(`${program.id}:${model.id}:${cycle}`);
      const rnd = mulberry32(seed);
      const trueP = clamp(program.baseRate.value + (rnd() - 0.5) * 0.10, 0.08, 0.92);
      const outcome = rnd() < trueP ? 1 : 0;
      const noise = (rnd() - 0.5) * 0.16 * (modelScale[model.id] ?? 1);
      const p = clamp(trueP + modelBias[model.id] + noise, 0.03, 0.97);
      const persona = panel.personas[Math.floor(rnd() * panel.personas.length)];
      const month = 1 + Math.floor(rnd() * 12);
      const day = 1 + Math.floor(rnd() * 27);
      const year = cycle < 2 ? 2025 : 2026;
      rows.push({
        id: `res_${program.id}_${model.id}_${cycle}`,
        program_id: program.id,
        area: program.area,
        phase: program.phase,
        model: model.id,
        persona: persona.id,
        p: Number(p.toFixed(3)),
        outcome,
        base_rate: program.baseRate.value,
        resolved_at: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        synthetic: true,
      });
    }
  }
}

await writeFile(path.join(ROOT, 'data', 'ledger.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(`wrote ${rows.length} rows`);
