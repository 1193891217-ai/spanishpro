'use strict';

const crypto = require('crypto');

const LIMIT = 100;
const ORIGIN_DEFAULT = 'https://spanish123.kicp.fun';

function cors(req, res) {
  const allowed = Array.from(new Set([ORIGIN_DEFAULT, 'https://spanishpro.vercel.app']
    .concat((process.env.ALLOW_ORIGIN || '').split(',')).map(x => x.trim()).filter(Boolean)));
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Anon-Session');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store, private');
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Storage is not configured');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error('Storage request failed');
  const payload = await response.json();
  if (payload.error) throw new Error('Storage request failed');
  return payload.result;
}

function chinaDay() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = name => parts.find(x => x.type === name).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}

function secondsToChinaMidnight() {
  const now = new Date();
  const shanghaiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const midnight = new Date(shanghaiNow.getFullYear(), shanghaiNow.getMonth(), shanghaiNow.getDate() + 1);
  return Math.max(60, Math.ceil((midnight - shanghaiNow) / 1000));
}

async function getUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) return null;
  const response = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && /^[0-9a-f-]{36}$/i.test(String(user.id || '')) ? user : null;
}

function anonSigningKey() {
  const secret = process.env.ANON_SESSION_SECRET || process.env.JIANPAY_KEY;
  if (!secret) throw new Error('Anonymous session signing key is not configured');
  return crypto.createHmac('sha256', secret).update('spanishpro-anonymous-session-v1').digest();
}

function issueAnonymousSession() {
  const id = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', anonSigningKey()).update(id).digest('hex');
  return { id: 'anon_' + id, token: id + '.' + signature };
}

function readAnonymousSession(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !/^[0-9a-f]{32}$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  try {
    const expected = crypto.createHmac('sha256', anonSigningKey()).update(parts[0]).digest();
    const supplied = Buffer.from(parts[1], 'hex');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected) ? 'anon_' + parts[0] : null;
  } catch (_) { return null; }
}

async function getIdentity(req) {
  const authorization = String(req.headers.authorization || '');
  if (/^Bearer\\s+/i.test(authorization)) {
    const user = await getUser(req);
    return user ? { id: user.id, kind: 'account' } : null;
  }
  const id = readAnonymousSession(req.headers['x-anon-session']);
  return id ? { id, kind: 'anonymous' } : null;
}

async function getLicense(userId) {
  const raw = await redis(['GET', 'license:' + userId]);
  if (!raw) return { active: false, expiresAt: 0 };
  try {
    const license = JSON.parse(raw);
    return { active: Number(license.expiresAt) > Date.now(), expiresAt: Number(license.expiresAt) || 0 };
  } catch (_) { return { active: false, expiresAt: 0 }; }
}

function sendError(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

module.exports = { LIMIT, cors, redis, chinaDay, secondsToChinaMidnight, getUser, getIdentity, issueAnonymousSession, readAnonymousSession, getLicense, sendError };
