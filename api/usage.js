'use strict';

const { LIMIT, cors, redis, chinaDay, secondsToChinaMidnight, getIdentity, getLicense, sendError } = require('../lib/server');

const INCREMENT_SCRIPT = "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); local limit=tonumber(ARGV[1]); if n>=limit then return n end; local v=redis.call('INCR',KEYS[1]); if v==1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[2])) end; return v";

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return sendError(res, 405, 'Method not allowed');
  try {
    const user = await getIdentity(req);
    if (!user) return sendError(res, 401, 'Please sign in');
    const key = 'quota:' + user.id + ':' + chinaDay();
    let count;
    if (req.method === 'POST') {
      const result = await redis(['EVAL', INCREMENT_SCRIPT, '1', key, String(LIMIT), String(secondsToChinaMidnight())]);
      count = Number(result);
    } else {
      count = Number((await redis(['GET', key])) || 0);
    }
    const license = await getLicense(user.id);
    return res.json({ ok: true, count, limit: LIMIT, active: license.active, expiresAt: license.expiresAt });
  } catch (e) {
    console.error('USAGE_ERROR', e.message);
    return sendError(res, 503, 'Usage service temporarily unavailable');
  }
};
