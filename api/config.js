'use strict';

const { cors } = require('../lib/server');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)) return res.status(503).json({ ok: false, error: 'Account service is not configured' });
  return res.json({ ok: true, authProxy: true });
};
