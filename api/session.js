'use strict';

const { cors, issueAnonymousSession, readAnonymousSession } = require('../lib/server');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });
  try {
    const provided = String(req.headers['x-anon-session'] || '');
    const validId = readAnonymousSession(provided);
    const issued = validId ? { id: validId, token: provided } : issueAnonymousSession();
    res.setHeader('Cache-Control', 'no-store, private');
    return res.json({ ok: true, id: issued.id, token: issued.token });
  } catch (error) {
    return res.status(503).json({ ok: false, error: 'Anonymous session service is not configured' });
  }
};
