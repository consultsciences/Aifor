// Entry point: pick a store, then listen.
//
// DATABASE_URL present → PostgreSQL, and a database that will not answer is a
// boot failure (the prototype logged a warning and served fixtures on a live
// URL instead). Set ALLOW_FIXTURE_FALLBACK=1 to opt back into that behaviour for
// a throwaway demo, and /api/meta will keep reporting mode=fixture.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.mjs';
import { createFixtureStore } from './src/store-fixture.mjs';
import { createPgStore } from './src/store-pg.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4319);
const HOST = process.env.HOST || process.env.BIND_ADDRESS || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');

async function main() {
  let store;
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    try {
      store = await createPgStore({ connectionString: databaseUrl });
      console.log('store: postgresql');
    } catch (err) {
      if (process.env.ALLOW_FIXTURE_FALLBACK === '1') {
        console.warn(`store: database unavailable (${err.message}) — ALLOW_FIXTURE_FALLBACK=1, serving fixtures`);
        store = await createFixtureStore({ dataDir: DATA_DIR });
      } else {
        console.error(`store: database unavailable — ${err.message}`);
        console.error('Refusing to serve synthetic fixtures on a database deployment. Set ALLOW_FIXTURE_FALLBACK=1 to override.');
        process.exit(1);
      }
    }
  } else {
    store = await createFixtureStore({ dataDir: DATA_DIR });
    console.log(`store: fixtures (${DATA_DIR})`);
  }

  const app = createApp({ store, publicDir: PUBLIC_DIR });
  const host = store.mode === 'database' && HOST === '127.0.0.1' ? '0.0.0.0' : HOST;

  app.listen(PORT, host, () => {
    console.log(`clinical-dojo listening on http://${host}:${PORT} · store=${store.mode}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received — closing`);
    app.close();
    if (store.close) await store.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});
