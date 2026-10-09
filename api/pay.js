// 支付后端：下单、收付款通知、主动查询订单状态（一个文件）
const crypto = require('crypto');
const querystring = require('querystring');

const PRICE_FEN = 3900;            // 39 元
const FOREVER = 4102444800000;     // 永久

function sign(params) {
  const str = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type')
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('md5').update(str + process.env.JIANPAY_KEY, 'utf8').digest('hex');
}

function baseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  return 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
}

async function redis(args) {
  const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return (await r.json()).result;
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
  // 暂时关闭主动查询解锁：之前猜的成功值不对，会在未付款时误判。
  // 拿到 QUERY_RESP 日志、确认"已付款"的真实值后，再把它填进 PAID_STATUS。
  const PAID_STATUS = [];
  const paid = PAID_STATUS.length > 0 && PAID_STATUS.includes(data.status);
  // 金额必须与下单一致
  const amountOk = data.amount == null || String(data.amount) === String(order.amount);
  return paid && amountOk;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action;

  // 1. 下单，返回二维码
  if (action === 'create' && req.method === 'POST') {
    const orderNo = 'P' + Date.now() + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
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
      if (d.code !== 1000 || !d.data || !d.data.payQrcodeUrl)
        return res.status(502).json({ ok: false, msg: d.message || ('下单失败：' + r.status) });

      // 保存简付的平台订单号，之后用它查询
      await saveOrder(orderNo, {
        status: 'pending', amount: PRICE_FEN, platformOrderId: d.data.orderId || null, createdAt: Date.now(),
      });
      return res.json({ ok: true, orderNo, payQrcodeUrl: d.data.payQrcodeUrl });
    } catch (e) {
      console.log('CREATE_ERR', e.message);
      return res.status(500).json({ ok: false, msg: '服务器错误：' + e.message });
    }
  }

  // 2. 简付的付款通知（如果能收到的话）
  if (action === 'notify') {
    const p = typeof req.body === 'string' ? querystring.parse(req.body) : (req.body || {});
    console.log('NOTIFY', JSON.stringify(p));
    if (String(p.sign || '').toLowerCase() !== sign(p)) return res.status(400).send('fail');
    const order = await getOrder(p.orderNo);
    if (!order) return res.status(404).send('fail');
    if (order.status === 'paid') return res.send('success');
    if (String(p.amount) !== String(order.amount)) return res.status(400).send('fail');
    const ok = p.status === 'success' || p.status === 1 || p.status === '1';
    if (!ok) return res.send('ignored');
    await saveOrder(p.orderNo, { ...order, status: 'paid', paidAt: Date.now() });
    return res.send('success');
  }

  // 3. 网页轮询：先看本地记录，没付则主动问简付
  if (action === 'status') {
    const orderNo = String(req.query.orderId || '');
    let order = await getOrder(orderNo);
    if (!order) return res.json({ paid: false, expiresAt: null });
    if (order.status !== 'paid' && order.platformOrderId) {
      try {
        if (await queryGateway(order)) {
          order = { ...order, status: 'paid', paidAt: Date.now() };
          await saveOrder(orderNo, order);
        }
      } catch (e) {
        console.log('QUERY_ERR', e.message);
      }
    }
    const paid = order.status === 'paid';
    return res.json({ paid, expiresAt: paid ? FOREVER : null });
  }

  res.status(404).json({ ok: false });
};
