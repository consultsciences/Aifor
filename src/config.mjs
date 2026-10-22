// Connection-string assembly.
//
// A deploy should be able to hand the app a password and nothing else. Having
// only DATABASE_URL means the password ends up duplicated inside a URL in every
// place the environment is written; accepting DB_* parts keeps it in one file and
// lets compose interpolate it.

export function databaseUrlFromEnv(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DB_PASSWORD) return null;
  const user = encodeURIComponent(env.DB_USER || 'aifor');
  const pass = encodeURIComponent(env.DB_PASSWORD);
  const host = env.DB_HOST || 'db';
  const port = env.DB_PORT || '5432';
  const name = env.DB_NAME || 'clinical';
  return ['postgresql://', user, ':', pass, '@', host, ':', port, '/', name].join('');
}
