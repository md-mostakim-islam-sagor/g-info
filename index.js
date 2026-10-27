'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const M = require('./mostakim');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const PAGES = new Set(['/home', '/games', '/login', '/registration', '/service', '/myadmin']); // SPA routes; /myadmin is unlisted
// Static whitelist: only src/ and resources/. Config, backend/, APIs/, .env are never reachable.
function serveStatic(req, res) {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const clean = p.replace(/\/+$/, '') || '/';
  if (clean === '/') { res.writeHead(302, { location: '/home' }); return res.end(); }
  if (clean === '/dashboard') { res.writeHead(302, { location: '/service' }); return res.end(); }
  const page = PAGES.has(clean);
  let file = page ? 'src/index.html' : p === '/favicon.ico' ? 'resources/mostakim.png' : p.slice(1);
  const abs = path.resolve(M.ROOT, file);
  const okDir = ['src', 'resources'].some(d => abs.startsWith(path.join(M.ROOT, d) + path.sep));
  const type = TYPES[path.extname(abs)];
  if (req.method !== 'GET' || !okDir || !type || !fs.existsSync(abs)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': page ? 'no-cache' : 'public, max-age=300', ...(clean === '/myadmin' ? { 'x-robots-tag': 'noindex, nofollow' } : {}) });
  fs.createReadStream(abs).pipe(res);
}
async function start(port) {
  const cfg = M.load(), v = M.validate(cfg);
  v.warnings.forEach(w => M.log('warn', w));
  if (v.errors.length) { v.errors.forEach(e => M.log('error', e)); throw new Error('Startup validation failed'); }
  const auth = await require('./backend/auth').init(cfg);
  const store = await require('./backend/store').create(cfg, auth);
  const providers = require('./APIs').build(cfg);
  providers.applyEnabled((await store.getSettings()).providerEnabled);
  const payments = require('./backend/payments').build(cfg); payments.applyEnabled((await store.getSettings()).gatewayEnabled);
  const adminAuth = require('./backend/adminAuth').init(cfg);
  if (!adminAuth.configured) M.log('warn', 'adminLogin not set in mostakim.json (or still a placeholder): admin panel login disabled');
  else if (adminAuth.plaintext && cfg.prod) M.log('warn', 'adminLogin.password is plain text; prefer an scrypt hash (npm run hash-password) or the ADMIN_PASSWORD secret');
  if (adminAuth.configured && cfg.prod && adminAuth.ephemeralSecret) M.log('warn', 'ADMIN_SESSION_SECRET not set: admin sessions reset on every restart/instance');
  payments.status().filter(g => g.enabled && !g.ready).forEach(g => M.log('warn', 'Payment gateway ' + g.label + ' enabled in config but not ready: ' + g.missing));
  const api = require('./backend/routes')({ cfg, store, auth, providers, payments, adminAuth });
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-frame-options', 'DENY'); res.setHeader('referrer-policy', 'no-referrer');
    try { if (!(await api(req, res))) serveStatic(req, res); }
    catch (e) { M.log('error', 'unhandled', { err: e.message }); if (!res.headersSent) { res.writeHead(500); res.end('Server error'); } }
  });
  await new Promise(r => server.listen(port ?? process.env.PORT ?? 3000, '0.0.0.0', r));
  return server;
}
if (require.main === module) start().then(s => M.log('info', 'GAMES • INFO listening', { port: s.address().port })).catch(e => { M.log('error', e.message); process.exit(1); });
module.exports = { start };
