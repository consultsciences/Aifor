// Contact form intake.
//
// The form posts as application/x-www-form-urlencoded (a plain HTML form, so the
// strict CSP needs no inline script). Three protections, in order of importance:
//
//   1. A honeypot field. A human never sees it; a naive bot fills it and is
//      answered with the same success redirect as everyone else, so it learns
//      nothing. It is never stored.
//   2. A per-IP rate limit, in memory. Cheap and sufficient for a single-replica
//      service; it exists to keep one host from filling the spool.
//   3. Validation and length caps, so a message cannot become a 10 MB row.
//
// Messages are appended to a JSONL spool under DATA_DIR. Nothing is sent by email
// yet — the service has no mail transport, and silently dropping a message because
// of that would be worse than keeping it. When the per-domain address
// (contact@researcharena.tech) and the relay exist, the spool becomes the queue.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, send } from './http.mjs';

const WINDOW_MS = 60 * 60 * 1000; // one hour

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function readForm(req, limit = 20000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `body too large (limit ${limit} bytes)`);
    chunks.push(chunk);
  }
  if (!chunks.length) throw new HttpError(400, 'empty body');
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// One handler per app instance: the counter is per process, and a module-level map
// would be shared by every instance in the same process (which also makes the tests
// interfere with each other).
export function createContactHandler({
  dataDir,
  trustProxy = false,
  maxPerWindow = 3,
  log = console,
}) {
  const hits = new Map(); // ip -> number[] (timestamps)

  const rateLimited = (ip) => {
    const now = Date.now();
    const seen = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    seen.push(now);
    hits.set(ip, seen);
    if (hits.size > 5000) hits.clear(); // bound memory on a long-lived process
    return seen.length > maxPerWindow;
  };

  return async function handleContact(req, res) {
  if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');

  const ip = clientIp(req, trustProxy);
  if (rateLimited(ip)) {
    throw new HttpError(429, 'too many messages from this address — try again later');
  }

  const form = await readForm(req);
  const honeypot = clip(form.get('website'), 200);
  const name = clip(form.get('name'), 120);
  const email = clip(form.get('email'), 200);
  const subject = clip(form.get('subject'), 160);
  const message = clip(form.get('message'), 4000);

  // A filled honeypot is a bot: answer exactly like success, store nothing.
  if (honeypot) {
    log.warn?.('[contact] honeypot triggered, message dropped');
    return redirectToSent(res);
  }

  if (!name) throw new HttpError(400, 'name is required');
  if (!message) throw new HttpError(400, 'message is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'a valid email is required');

  const record = {
    receivedAt: new Date().toISOString(),
    name,
    email,
    subject,
    message,
    ip, // kept with the message: it is the only abuse signal for a spool with no mail relay
  };

  await mkdir(dataDir, { recursive: true });
  await appendFile(path.join(dataDir, 'contact-messages.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  log.log?.(`[contact] message stored (${message.length} chars) from ${email}`);

  return redirectToSent(res);
  };
}

function redirectToSent(res) {
  res.writeHead(303, {
    location: '/contact?sent=1',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end();
}
