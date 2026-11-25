import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './app.js';
import { createPool, wrapPool, runMigrations } from './db.js';

const PUBLIC_DIR = path.dirname(fileURLToPath(import.meta.url));
// Flat layout: only these files are ever served to browsers.
const PUBLIC_FILES = new Set([
  'index.html', 'apply.html', 'apply.js', 'calendar.js', 'calendar.css',
  'ADMINDASHBOARDCONSILIUM.html', 'admin.js', 'admin.css'
]);
const MAX_BODY_BYTES = 64 * 1024;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

// Replaces the Cloudflare static-assets binding: serves files from ./public only.
const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (_error) { return new Response('Not found', { status: 404 }); }
    if (pathname.includes('\0')) return new Response('Not found', { status: 404 });
    if (pathname.endsWith('/')) pathname += 'index.html';

    const name = pathname.replace(/^\/+/, '');
    if (!PUBLIC_FILES.has(name)) {
      if (PUBLIC_FILES.has(name + '.html')) {
        return new Response(null, { status: 308, headers: { Location: pathname + '.html' + url.search } });
      }
      return new Response('Not found', { status: 404 });
    }
    const resolved = path.join(PUBLIC_DIR, name);

    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const body = request.method === 'HEAD' ? null : await fs.readFile(resolved);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': CONTENT_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
          'Content-Length': String(stat.size),
          'Cache-Control': 'no-cache'
        }
      });
    } catch (_error) {
      return new Response('Not found', { status: 404 });
    }
  }
};

function buildEnv(db) {
  return {
    DB: db,
    ASSETS,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET
  };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function toRequest(req) {
  // Behind Railway's TLS-terminating proxy the browser origin is https even though Node sees http.
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const url = `${proto}://${host}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const init = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await readBody(req);
  return new Request(url, init);
}

async function sendResponse(res, response) {
  const headers = {};
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === 'set-cookie') continue;
    headers[key] = value;
  }
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body) { res.end(); return; }
  res.end(Buffer.from(await response.arrayBuffer()));
}

function securityHeaders(response) {
  // Railway terminates TLS; tell browsers to keep using HTTPS for this origin.
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return response;
}

async function main() {
  const pool = createPool();
  pool.query('SELECT 1').catch(() => {});
  await runMigrations(pool);
  const env = buildEnv(wrapPool(pool));

  if (!env.ADMIN_PASSWORD) console.warn('WARNING: ADMIN_PASSWORD is not set; administrator sign-in is disabled.');
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) console.warn('WARNING: RESEND_API_KEY / RESEND_FROM_EMAIL not set; emails will be recorded as FAILED.');
  if (!env.RESEND_WEBHOOK_SECRET) console.warn('WARNING: RESEND_WEBHOOK_SECRET is not set; delivery webhooks will be rejected.');

  const server = http.createServer(async (req, res) => {
    try {
      const request = await toRequest(req);
      const response = await app.fetch(request, env, { waitUntil() {} });
      await sendResponse(res, securityHeaders(response));
    } catch (error) {
      const status = error && error.status === 413 ? 413 : 500;
      if (status === 500) console.error('Unhandled server error:', error && error.name);
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      res.end(JSON.stringify({
        ok: false,
        code: status === 413 ? 'REQUEST_TOO_LARGE' : 'INTERNAL_ERROR',
        message: status === 413 ? 'The submitted data is too large.' : 'The service could not complete this request. Please try again.'
      }));
    }
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => console.log(`Consilium System listening on port ${port}`));

  // Housekeeping: expired sessions and old rate-limit windows.
  const cleanup = async () => {
    try {
      await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(new Date().toISOString()).run();
      await env.DB.prepare('DELETE FROM api_rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 86400).run();
    } catch (error) {
      console.error('Cleanup failed:', error && error.code ? error.code : error && error.name);
    }
  };
  const timer = setInterval(cleanup, 60 * 60 * 1000);
  timer.unref();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down.`);
    clearInterval(timer);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start:', error.message);
  process.exit(1);
});
