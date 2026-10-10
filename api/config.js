'use strict';

const { cors } = require('../lib/server');

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  if (!process.env.ANON_SESSION_SECRET && !process.env.JIANPAY_KEY) return res.status(503).json({ ok: false, error: 'Anonymous session signing key is not configured' });
  return res.json({ ok: true, anonymousSessions: true });
};
