'use strict';

const LIMIT = 100;
const ORIGIN_DEFAULTS = ['https://spanishpro.vercel.app', 'https://spanish123.kicp.fun', 'https://bi7rsw.kicp.fun'];

function cors(req, res) {
  const allowed = Array.from(new Set(ORIGIN_DEFAULTS.concat((process.env.ALLOW_ORIGIN || '').split(',')).map(x => x.trim()).filter(Boolean)));
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
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
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!token || !process.env.SUPABASE_URL || !publishableKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(process.env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: publishableKey, Authorization: 'Bearer ' + token },
      signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }
  if (!response.ok) return null;
  const user = await response.json();
  return user && /^[0-9a-f-]{36}$/i.test(String(user.id || '')) ? user : null;
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

module.exports = { LIMIT, cors, redis, chinaDay, secondsToChinaMidnight, getUser, getLicense, sendError };
