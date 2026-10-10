'use strict';

const { cors, sendError } = require('../lib/server');

const ROUTES = {
  signup: { method: 'POST', path: '/auth/v1/signup' },
  login: { method: 'POST', path: '/auth/v1/token?grant_type=password' },
  refresh: { method: 'POST', path: '/auth/v1/token?grant_type=refresh_token' },
  user: { method: 'GET', path: '/auth/v1/user' },
  logout: { method: 'POST', path: '/auth/v1/logout' },
};

function jsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return {};
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const action = String(req.query.action || '');
  const route = ROUTES[action];
  if (!route || req.method !== route.method) return sendError(res, 405, 'Unsupported authentication request');
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!base || !key) return sendError(res, 503, 'Account service is not configured');

  try {
    const body = action === 'user' ? {} : jsonBody(req);
    if (action === 'signup' || action === 'login') {
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 256)
        return sendError(res, 400, '请输入有效邮箱和至少 8 位密码');
    }
    if (action === 'refresh' && (typeof body.refresh_token !== 'string' || body.refresh_token.length > 4096))
      return sendError(res, 400, '登录状态无效，请重新登录');
    let path = route.path;
    if (action === 'signup') {
      const redirectTo = String(body.redirectTo || process.env.SITE_URL || '');
      const allowed = new Set((process.env.ALLOW_ORIGIN || 'https://spanishpro.vercel.app,https://spanish123.kicp.fun').split(',').map(x => x.trim()).filter(Boolean));
      let parsed;
      try { parsed = new URL(redirectTo); } catch (_) { return sendError(res, 400, 'Invalid email confirmation address'); }
      if (!allowed.has(parsed.origin)) return sendError(res, 400, 'Email confirmation address is not allowed');
      path += '?redirect_to=' + encodeURIComponent(parsed.origin);
    }

    const headers = { apikey: key, 'Content-Type': 'application/json' };
    const bearer = String(req.headers.authorization || '');
    if (/^Bearer\s+\S+$/i.test(bearer)) headers.Authorization = bearer;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let upstream;
    try {
      upstream = await fetch(base.replace(/\/$/, '') + path, {
        method: route.method,
        headers,
        ...(route.method === 'POST' ? { body: JSON.stringify(action === 'signup' ? { email: body.email, password: body.password } : action === 'refresh' ? { refresh_token: body.refresh_token } : action === 'login' ? { email: body.email, password: body.password } : undefined) } : {}),
        signal: controller.signal,
      });
    } finally { clearTimeout(timeout); }

    const text = await upstream.text();
    let payload;
    try { payload = JSON.parse(text); } catch (_) { payload = { error: 'Authentication provider returned an invalid response' }; }
    res.setHeader('Cache-Control', 'no-store, private');
    if (upstream.status === 204) return res.status(204).end();
    return res.status(upstream.status).json(payload);
  } catch (error) {
    if (error.name === 'AbortError') return sendError(res, 504, '登录服务器响应超时，请稍后重试');
    console.error('AUTH_PROXY_ERROR', error.message);
    return sendError(res, 503, '登录服务暂时不可用，请稍后重试');
  }
};
