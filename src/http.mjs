// Small HTTP helpers shared by the router: body parsing with a hard limit,
// JSON responses with security headers, and static file serving that refuses
// to leave the public directory.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export async function readJsonBody(req, limit = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `body too large (limit ${limit} bytes)`);
    chunks.push(chunk);
  }
  if (!chunks.length) throw new HttpError(400, 'empty body — expected JSON');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'body must be a JSON object');
  }
  return parsed;
}

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': type,
    'cache-control': 'no-store',
  });
  res.end(data);
}

export function sendError(res, status, message) {
  send(res, status, { error: message });
}

export async function serveStatic(res, pathname, root) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, rel);
  const within = file === root || file.startsWith(root + path.sep);
  if (!within) throw new HttpError(403, 'forbidden');
  let buf;
  try {
    buf = await readFile(file);
  } catch {
    throw new HttpError(404, 'not found');
  }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': type,
    'cache-control': pathname === '/' ? 'no-store' : 'public, max-age=300',
  });
  res.end(buf);
}
