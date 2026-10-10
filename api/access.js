'use strict';

const { cors, getUser, getLicense, sendError } = require('../lib/server');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed');
  try {
    const user = await getUser(req);
    if (!user) return sendError(res, 401, 'Please sign in');
    const license = await getLicense(user.id);
    return res.json({ ok: true, active: license.active, expiresAt: license.expiresAt });
  } catch (e) {
    console.error('ACCESS_ERROR', e.message);
    return sendError(res, 503, 'Account service temporarily unavailable');
  }
};
