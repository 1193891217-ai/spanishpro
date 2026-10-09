// 支付后端：一个文件搞定下单、收付款通知、查询状态
const crypto = require('crypto');
const querystring = require('querystring');

const PRICE_FEN = 3900;                 // 39 元
const FOREVER = 4102444800000;          // 永久

function sign(params) {
  const str = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'sign_type')
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('md5').update(str + process.env.JIANPAY_KEY, 'utf8').digest('hex');
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

function baseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  return 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action;

  // 1. 网页点"氪金" → 下单，返回二维码
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
    await saveOrder(orderNo, { status: 'pending', amount: PRICE_FEN });

    try {
      const r = await fetch(process.env.JIANPAY_GATEWAY + '/open/payment/pay/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, sign_type: 'MD5' }),
      });
      const text = await r.text();
      console.log('CREATE_RESP', r.status, text.slice(0, 500));   // 排查用：在 Vercel Logs 里查看
      let d = {};
      try { d = JSON.parse(text); } catch (e) {}
      if (d.code !== 1000 || !d.data || !d.data.payQrcodeUrl)
        return res.status(502).json({ ok: false, msg: d.message || ('下单失败：' + r.status) });
      return res.json({ ok: true, orderNo, payQrcodeUrl: d.data.payQrcodeUrl });
    } catch (e) {
      console.log('CREATE_ERR', e.message);
      return res.status(500).json({ ok: false, msg: '服务器错误：' + e.message });
    }
  }

  // 2. 简付付款成功后回调到这里
  if (action === 'notify') {
    const p = typeof req.body === 'string' ? querystring.parse(req.body) : (req.body || {});
    console.log('NOTIFY', JSON.stringify(p));  // 第一次测试时用来确认回调内容
    if (String(p.sign || '').toLowerCase() !== sign(p)) return res.status(400).send('fail');

    const order = await getOrder(p.orderNo);
    if (!order) return res.status(404).send('fail');
    if (order.status === 'paid') return res.send('success');
    if (String(p.amount) !== String(order.amount)) return res.status(400).send('fail');

    // 【待确认】回调里表示"已支付"的字段和值，看日志后修改这一行
    const ok = p.status === 'success' || p.status === 1 || p.status === '1';
    if (!ok) return res.send('ignored');

    await saveOrder(p.orderNo, { ...order, status: 'paid', paidAt: Date.now() });
    return res.send('success'); // 【待确认】回复内容
  }

  // 3. 网页轮询：这笔订单付了没有
  if (action === 'status') {
    const order = await getOrder(String(req.query.orderId || ''));
    const paid = !!order && order.status === 'paid';
    return res.json({ paid, expiresAt: paid ? FOREVER : null });
  }

  res.status(404).json({ ok: false });
};
