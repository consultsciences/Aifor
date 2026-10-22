import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseUrlFromEnv } from '../src/config.mjs';

test('DATABASE_URL wins when it is set', () => {
  const url = databaseUrlFromEnv({ DATABASE_URL: 'postgresql://x:y@z:5432/db', DB_PASSWORD: 'ignored' });
  assert.equal(url, 'postgresql://x:y@z:5432/db');
});

test('discrete DB_* parts build the same string', () => {
  const url = databaseUrlFromEnv({ DB_USER: 'aifor', DB_PASSWORD: 'pw123', DB_HOST: 'aifor-db', DB_NAME: 'aifor' });
  assert.equal(url, ['postgresql://', 'aifor', ':', 'pw123', '@', 'aifor-db', ':5432', '/aifor'].join(''));
});

test('special characters in the password are percent-encoded', () => {
  const url = databaseUrlFromEnv({ DB_PASSWORD: 'p@ss:word/1' });
  assert.match(url, /p%40ss%3Aword%2F1/);
  assert.equal(url.split('@').length, 2, 'the @ inside the password must not split the host');
});

test('no configuration returns null (fixture mode)', () => {
  assert.equal(databaseUrlFromEnv({}), null);
});
