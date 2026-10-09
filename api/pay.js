// 支付后端：下单、收付款通知、主动查询订单状态（一个文件）
const crypto = require('crypto');
const querystring = require('querystring');
const { cors, redis, getUser, getLicense, sendError } = require('../lib/server');

const PRICE_FEN = 3900;            // 39 元
const FOREVER = 4102444800000;     // 永久
const CREATE_LIMIT_SCRIPT = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[1])) end; return n";

function sign(params) {
  if (!process.env.JIANPAY_KEY) throw new Error('Payment signing key is not configured');
  const str = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type')
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(k => `${k}=${typeof params[k] === 'object' ? JSON.stringify(params[k]) : String(params[k])}`)
    .join('&');
  return crypto.createHash('md5').update(str + process.env.JIANPAY_KEY, 'utf8').digest('hex');
}
function validSign(params) {
  try {
    const supplied = Buffer.from(String(params.sign || '').toLowerCase(), 'hex');
    const expected = Buffer.from(sign(params), 'hex');
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  } catch (_) { return false; }
}

function baseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  return 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
}

async function getOrder(id) {
  const s = await redis(['GET', 'order:' + id]);
  return s ? JSON.parse(s) : null;
}
async function saveOrder(id, obj) {
  await redis(['SET', 'order:' + id, JSON.stringify(obj)]);
}

// 主动向简付查询订单状态
async function queryGateway(order) {
  const params = {
    clientNo: process.env.JIANPAY_CLIENT_NO,
    orderId: order.platformOrderId,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  params.sign = sign(params);
  const r = await fetch(process.env.JIANPAY_GATEWAY + '/open/payment/pay/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, sign_type: 'MD5' }),
  });
  const text = await r.text();
  console.log('QUERY_RESP', r.status, text.slice(0, 500));   // 排查用
  let d = {};
  try { d = JSON.parse(text); } catch (e) {}
  const data = d.data || {};
  // 简付文档：data.status === 2 表示支付成功。
  // 同时核对商户、商户订单号、平台订单号及金额，避免错误订单解锁。
  return d.code === 1000 && Number(data.status) === 2 &&
    String(data.clientNo) === String(process.env.JIANPAY_CLIENT_NO) &&
    String(data.merchantOrderNo) === String(order.orderNo) &&
    String(data.orderId) === String(order.platformOrderId) &&
    String(data.amount) === String(order.amount);
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action;

  // 1. 下单，返回二维码
  if (action === 'create' && req.method === 'POST') {
    const user = await getUser(req);
    if (!user) return sendError(res, 401, 'Please sign in before payment');
    const hourKey = 'pay-create:' + user.id + ':' + Math.floor(Date.now() / 3600000);
    const creates = Number(await redis(['EVAL', CREATE_LIMIT_SCRIPT, '1', hourKey, '7200']));
    if (creates > 10) return sendError(res, 429, 'Too many payment orders. Try again later.');
    // 不可预测的商户订单号，防止他人猜测订单号调用 status 伪造解锁。
    const orderNo = 'P' + crypto.randomBytes(24).toString('hex');
    const params = {
      clientNo: process.env.JIANPAY_CLIENT_NO,
      timestamp: String(Math.floor(Date.now() / 1000)),
      amount: PRICE_FEN,
      orderNo,
      goodsName: '单词小助手-永久解锁',
      notifyUrl: baseUrl(req) + '/api/pay?action=notify',
    };
    params.sign = sign(params);

    try {
      const r = await fetch(process.env.JIANPAY_GATEWAY + '/open/payment/pay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, sign_type: 'MD5' }),
      });
      const text = await r.text();
      console.log('CREATE_RESP', r.status, text.slice(0, 500));
      let d = {};
      try { d = JSON.parse(text); } catch (e) {}
      if (d.code !== 1000 || !d.data || !d.data.payQrcodeUrl || !d.data.orderId ||
          String(d.data.clientNo) !== String(process.env.JIANPAY_CLIENT_NO) ||
          String(d.data.merchantOrderNo) !== orderNo || String(d.data.amount) !== String(PRICE_FEN))
        return res.status(502).json({ ok: false, msg: d.message || ('下单失败：' + r.status) });

      // 保存简付的平台订单号，之后用它查询
      await saveOrder(orderNo, {
        status: 'pending', orderNo, ownerId: user.id, amount: PRICE_FEN, platformOrderId: d.data.orderId || null, createdAt: Date.now(),
      });
      return res.json({ ok: true, orderNo, payQrcodeUrl: d.data.payQrcodeUrl });
    } catch (e) {
      console.log('CREATE_ERR', e.message);
      return res.status(500).json({ ok: false, msg: '服务器错误：' + e.message });
    }
  }

  // 2. 简付的付款通知（如果能收到的话）
  if (action === 'notify') {
    if (req.method !== 'POST') return res.status(405).send('fail');
    const p = typeof req.body === 'string' ? querystring.parse(req.body) : (req.body || {});
    if (!validSign(p)) return res.status(400).send('fail');
    // 简付通知字段为 merchantOrderNo，兼容旧通知字段 orderNo。
    const orderNo = String(p.merchantOrderNo || p.orderNo || '');
    const order = await getOrder(orderNo);
    if (!order) return res.status(404).send('fail');
    if (order.status === 'paid') return res.send('success');
    if (String(p.clientNo) !== String(process.env.JIANPAY_CLIENT_NO) ||
        String(p.merchantOrderNo || p.orderNo) !== String(order.orderNo) ||
        String(p.orderId) !== String(order.platformOrderId) ||
        String(p.amount) !== String(order.amount)) return res.status(400).send('fail');
    // 简付成功状态为数值 2；其他状态不能授予权益。
    const ok = Number(p.status) === 2;
    if (!ok) return res.send('ignored');
    if (!order.ownerId) return res.status(400).send('fail');
    await redis(['SET', 'license:' + order.ownerId, JSON.stringify({ expiresAt: FOREVER, orderNo, paidAt: Date.now() })]);
    await saveOrder(orderNo, { ...order, status: 'paid', paidAt: Date.now() });
    return res.send('success');
  }

  // 3. 网页轮询：先看本地记录，没付则主动问简付
  if (action === 'status') {
    if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed');
    const user = await getUser(req);
    if (!user) return sendError(res, 401, 'Please sign in');
    const orderNo = String(req.query.orderId || '');
    if (!/^P[0-9a-f]{48}$/.test(orderNo)) return res.status(404).json({ paid: false, expiresAt: null });
    let order = await getOrder(orderNo);
    if (!order || order.ownerId !== user.id) return res.status(404).json({ paid: false, expiresAt: null });
    if (order.status !== 'paid' && order.platformOrderId) {
      try {
        if (await queryGateway(order)) {
          order = { ...order, status: 'paid', paidAt: Date.now() };
          await redis(['SET', 'license:' + user.id, JSON.stringify({ expiresAt: FOREVER, orderNo, paidAt: order.paidAt })]);
          await saveOrder(orderNo, order);
        }
      } catch (e) {
        console.log('QUERY_ERR', e.message);
      }
    }
    const paid = order.status === 'paid';
    const license = await getLicense(user.id);
    return res.json({ paid, expiresAt: paid ? license.expiresAt : null });
  }

  res.status(404).json({ ok: false });
};
