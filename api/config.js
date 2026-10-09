'use strict';

const { cors } = require('../lib/server');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).json({ ok: false, error: 'Account service is not configured' });
  return res.json({ ok: true, supabaseUrl: url, publishableKey: key });
};
