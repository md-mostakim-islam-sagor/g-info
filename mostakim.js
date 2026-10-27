'use strict';
// Config loader + shared helpers. ONE authoritative config: mostakim.json (secrets come from env vars only).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = __dirname;
const DEFAULTS = {
  app: { name: 'GAMES • INFO', guestMode: true, guestDailyLimit: 3, maintenance: false, selfServiceKeys: false, publicBaseUrl: '', trustProxy: false },
  limits: { perKeyPerMin: 30, perUserPerMin: 60, refundCapPerDay: 20 },
  cors: { origins: [] },
  admin: { emails: [], uids: [] },
  adminLogin: { username: '', password: '' },
  popup: { enabled: true, title: 'Welcome to GAMES • INFO', text: 'Check player profiles fast. Join our community for updates.', imageUrl: '/resources/popup.png', cooldownMinutes: 60, v: 0, buttons: [] },
  payment: { gateways: {}, methods: ['bKash', 'Nagad'], number: '', instructions: 'Send the exact amount, then submit your transaction ID. Never share your PIN or OTP.' },
  packages: [
    { id: 'starter', name: 'Starter', requests: 50, price: 20 },
    { id: 'basic', name: 'Basic', requests: 100, price: 45 },
    { id: 'plus', name: 'Plus', requests: 200, price: 90 },
    { id: 'pro', name: 'Pro', requests: 500, price: 240 },
    { id: 'business', name: 'Business', requests: 1000, price: 450 }
  ],
  games: { freefire: 'Free Fire', pubgm: 'PUBG Mobile Global', pubgm_lite: 'PUBG Mobile Lite', coc: 'Clash of Clans', codm: 'Call of Duty Mobile', aceracer: 'Ace Racer', deltaforce: 'Delta Force', brawlstars: 'Brawl Stars' },
  firebase: { serviceAccountEnv: 'FIREBASE_SERVICE_ACCOUNT_JSON', webApiKeyEnv: 'FIREBASE_WEB_API_KEY' },
  providers: []
};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => { const o = { ...a }; for (const k in b) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return o; };
function load() {
  const file = process.env.MOSTAKIM_CONFIG || path.join(ROOT, 'mostakim.json');
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error('Cannot load ' + path.basename(file) + ': ' + e.message); }
  const cfg = merge(DEFAULTS, raw);
  if (process.env.ADMIN_EMAILS) cfg.admin.emails = process.env.ADMIN_EMAILS.split(',');
  if (process.env.PUBLIC_BASE_URL) cfg.app.publicBaseUrl = process.env.PUBLIC_BASE_URL;
  cfg.admin.emails = cfg.admin.emails.map(e => e.trim().toLowerCase()).filter(Boolean);
  cfg.prod = process.env.NODE_ENV === 'production';
  return cfg;
}
function validate(cfg) {
  const errors = [], warnings = [];
  if (cfg.prod && !process.env[cfg.firebase.serviceAccountEnv]) errors.push('Missing env ' + cfg.firebase.serviceAccountEnv + ' (required in production)');
  if (cfg.prod && !(cfg.admin.emails.length || (cfg.admin.uids || []).length)) warnings.push('No admin allowlist configured; admin panel unreachable');
  if (String(cfg.firebase.projectId || '').startsWith('YOUR_')) warnings.push('Firebase projectId is still a placeholder');
  if (raw_proxy(cfg)) warnings.push('"proxy" config is ignored (no proxy support)');
  for (const p of cfg.providers) {
    if (p.enabled && !(p.apiKeyEnv && process.env[p.apiKeyEnv])) warnings.push('Provider "' + p.name + '" enabled but env ' + p.apiKeyEnv + ' is missing; it will stay inactive');
    if (cfg.prod && p.enabled && p.baseUrl && !/^https:/.test(p.baseUrl)) errors.push('Provider "' + p.name + '" must use https in production');
  }
  return { errors, warnings };
}
const raw_proxy = cfg => !!cfg.proxy;
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const rid = () => crypto.randomBytes(9).toString('hex');
const secrets = () => Object.entries(process.env).filter(([k, v]) => /KEY|SECRET|TOKEN|SERVICE_ACCOUNT|PRIVATE/i.test(k) && v && v.length >= 8).map(([, v]) => v);
const redact = s => { for (const v of secrets()) s = s.split(v).join('[REDACTED]'); return s.replace(/gi_[a-f0-9]{40}/g, 'gi_[REDACTED]'); };
const log = (level, msg, meta) => console[level === 'error' ? 'error' : 'log'](redact(JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta })));
const get = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach(k => { c = c[k] = isObj(c[k]) ? c[k] : {}; }); c[ks.pop()] = v; };
function flatten(o, p = '', out = {}, d = 0) { if (d > 6) return out; for (const [k, v] of Object.entries(o || {})) { if (Object.keys(out).length > 300) break; const key = p ? p + '.' + k : k; if (v && typeof v === 'object') flatten(v, key, out, d + 1); else out[key] = v; } return out; }
// ---- welcome popup: strict validation for admin input, lenient cleaning for public output
const httpsUrl = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' && x.hostname.includes('.') && String(u).length <= 300 && !/\s/.test(String(u)); } catch { return false; } };
const imgOk = u => u === '' || httpsUrl(u) || /^\/resources\/[\w.-]+\.png$/.test(u);
function cleanPopup(p) {
  p = p || {};
  const buttons = (Array.isArray(p.buttons) ? p.buttons : []).filter(b => b && httpsUrl(b.url) && !/YOUR[_-]/i.test(b.url) && String(b.label || '').trim()).slice(0, 3)
    .map(b => ({ type: ['telegram', 'youtube'].includes(b.type) ? b.type : 'link', label: String(b.label).trim().slice(0, 30), url: String(b.url) }));
  const title = String(p.title || '').slice(0, 80), text = String(p.text || '').slice(0, 400), imageUrl = imgOk(String(p.imageUrl || '')) ? String(p.imageUrl || '') : '';
  return { enabled: p.enabled !== false && !!(title || text || buttons.length), title, text, imageUrl, buttons, cooldownMinutes: Math.min(1440, Math.max(1, Math.floor(Number(p.cooldownMinutes)) || 60)), v: Number(p.v) || 0 };
}
function validatePopup(b) {
  if (!b || typeof b !== 'object') return { error: 'Invalid body' };
  const title = String(b.title ?? ''), text = String(b.text ?? ''), img = String(b.imageUrl ?? '').trim(), cd = Number(b.cooldownMinutes);
  if (title.length > 80) return { error: 'Title max 80 characters' }; if (text.length > 400) return { error: 'Text max 400 characters' };
  if (!imgOk(img)) return { error: 'Image must be an https:// URL or /resources/name.png' };
  if (!Number.isInteger(cd) || cd < 1 || cd > 1440) return { error: 'Cooldown must be 1-1440 minutes' };
  const bs = Array.isArray(b.buttons) ? b.buttons : []; if (bs.length > 3) return { error: 'Max 3 buttons' };
  for (const x of bs) { if (!x || !['telegram', 'youtube', 'link'].includes(x.type)) return { error: 'Button type must be telegram, youtube or link' }; const l = String(x.label || '').trim(); if (!l || l.length > 30) return { error: 'Button label 1-30 characters' }; if (!httpsUrl(x.url)) return { error: 'Button URLs must be valid https:// links' }; }
  return { value: { enabled: b.enabled !== false, title, text, imageUrl: img, cooldownMinutes: cd, buttons: bs.map(x => ({ type: x.type, label: String(x.label).trim(), url: String(x.url).trim() })) } };
}
module.exports = { cleanPopup, validatePopup, ROOT, load, validate, sha256, rid, log, get, setPath, flatten, merge };
