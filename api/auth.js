'use strict';

const { cors } = require('../lib/server');

const ROUTES = {
  signup: { method: 'POST', path: '/auth/v1/signup' },
  password: { method: 'POST', path: '/auth/v1/token?grant_type=password' },
  refresh: { method: 'POST', path: '/auth/v1/token?grant_type=refresh_token' },
  user: { method: 'GET', path: '/auth/v1/user' },
  logout: { method: 'POST', path: '/auth/v1/logout' },
};

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const route = ROUTES[String(req.query.op || '')];
  if (!route || req.method !== route.method) {
    return res.status(405).json({ ok: false, error: 'Unsupported auth operation' });
  }

  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) {
    return res.status(503).json({ ok: false, error: 'Account service is not configured' });
  }

  let target = base + route.path;
  if (req.query.op === 'signup') {
    const allowedOrigins = (process.env.ALLOW_ORIGIN || 'https://spanish123.kicp.fun,https://spanishpro.vercel.app')
      .split(',').map(x => x.trim()).filter(Boolean);
    let redirectTo = allowedOrigins[0];
    try {
      const requested = new URL(String(req.query.redirect_to || ''));
      if (allowedOrigins.includes(requested.origin)) redirectTo = requested.origin;
    } catch (_) {}
    target += '?redirect_to=' + encodeURIComponent(redirectTo);
  }

  const headers = { apikey: key };
  const authorization = String(req.headers.authorization || '');
  if (authorization) headers.Authorization = authorization;

  const init = { method: route.method, headers };
  if (route.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  init.signal = controller.signal;
  try {
    const upstream = await fetch(target, init);
    const body = await upstream.text();
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(upstream.status).send(body);
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      ok: false,
      error: timedOut
        ? '登录服务连接超时，请稍后重试；若是注册，请先尝试登录确认账号是否已创建。'
        : '登录服务暂时无法连接，请检查网络后重试。',
    });
  } finally {
    clearTimeout(timer);
  }
};
