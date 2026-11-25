import { validEmail } from './config.mjs';

const MAX_BODY = 16000;
const tokenPattern = /^[A-Za-z\d_-]{43}$/;
const sameOrigin = (req, origin) => !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) &&
  (!req.headers.origin || req.headers.origin === origin);
const json = (res, status, code) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ code }));

function createLimit() {
  let reset = 0;
  let total = 0;
  let active = 0;
  const ips = new Map();
  return (ip, now = Date.now()) => {
    if (now >= reset) { reset = now + 10 * 60 * 1000; total = 0; ips.clear(); }
    const hits = ips.get(ip) || 0;
    if (total >= 100 || hits >= 20 || active >= 6) return null;
    ips.set(ip, hits + 1);
    total += 1;
    active += 1;
    return () => { active -= 1; };
  };
}

async function readBody(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) { req.resume(); return null; }
  const parts = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY) break;
    parts.push(chunk);
  }
  if (size > MAX_BODY) { req.resume(); return null; }
  return Buffer.concat(parts).toString('utf8');
}

function field(value) { return typeof value === 'string' ? value.trim() : ''; }

function tokenPage(res, status, lang, title, body = '') {
  const fa = lang === 'fa';
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="${lang}" dir="${fa ? 'rtl' : 'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/forms.css"><main class="shell panel-section token-page"><h1>${title}</h1>${body}<p><a class="button button-muted" href="${fa ? '/' : '/en.html'}">${fa ? 'بازگشت به سایت' : 'Back to the site'}</a></p></main></html>`);
}

async function handleToken(req, res, url, store, origin) {
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fa';
  const fa = lang === 'fa';
  const confirm = url.pathname === '/opt-in';
  const invalid = () => tokenPage(res, 400, lang, fa ? 'این لینک معتبر نیست یا دیگر فعال نیست.' : 'This link is invalid or no longer active.');
  if (req.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (!tokenPattern.test(token)) return invalid();
    const title = confirm ? (fa ? 'تأیید عضویت خبرنامه' : 'Confirm newsletter subscription') : (fa ? 'لغو عضویت خبرنامه' : 'Unsubscribe from the newsletter');
    return tokenPage(res, 200, lang, title, `<form action="${url.pathname}?lang=${lang}" method="post"><input type="hidden" name="token" value="${token}"><button class="button button-primary" type="submit">${title}</button></form>`);
  }
  if (req.method !== 'POST') return res.writeHead(405, { Allow: 'GET, POST' }).end();
  if (!sameOrigin(req, origin)) return res.writeHead(403).end();
  if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return res.writeHead(415).end();
  const body = await readBody(req);
  if (body === null) return res.writeHead(413).end();
  const token = new URLSearchParams(body).get('token') || '';
  if (!tokenPattern.test(token) || !(confirm ? store.confirm(token) : store.remove(token))) return invalid();
  const title = confirm ? (fa ? 'عضویت شما تأیید شد.' : 'Your subscription is confirmed.') : (fa ? 'عضویت شما لغو شد.' : 'You have been unsubscribed.');
  return tokenPage(res, 200, lang, title);
}

export function createForms({ smtp, origin }, store, send) {
  const limit = createLimit();
  return async function forms(req, res, url) {
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/api/forms') {
      if (req.method !== 'GET') return res.writeHead(405, { Allow: 'GET' }).end();
      return json(res, 200, smtp ? 'available' : 'disabled');
    }
    const isToken = ['/opt-in', '/opt-out'].includes(url.pathname);
    if (!isToken && !['/api/request', '/api/subscribe'].includes(url.pathname)) return res.writeHead(404).end();
    if (!smtp) return json(res, 503, 'disabled');
    if (isToken) {
      res.setHeader('Referrer-Policy', 'strict-origin');
      return handleToken(req, res, url, store, origin);
    }
    if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end();
    if (!sameOrigin(req, origin)) return json(res, 403, 'invalid');
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, 'invalid');
    const release = limit(req.socket.remoteAddress);
    if (!release) { res.setHeader('Retry-After', '600'); return json(res, 429, 'rate'); }
    try {
      const body = await readBody(req);
      if (body === null) return json(res, 413, 'invalid');
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, 'invalid'); }
      const email = field(data?.email).toLowerCase();
      if (!validEmail(email)) return json(res, 400, 'invalid');
      if (field(data?.website)) return json(res, 202, 'sent');
      if (url.pathname === '/api/request') {
        const name = field(data.name);
        const message = field(data.message);
        if (!name || name.length > 100 || /[\r\n]/.test(name) || message.length < 10 || message.length > 3000) return json(res, 400, 'invalid');
        await send({ to: smtp.to, replyTo: email, subject: 'OminiCorp — Project request', text: `Name: ${name}\nEmail: ${email}\n\n${message}` });
      } else {
        if (data.consent !== true) return json(res, 400, 'invalid');
        const tickets = store.reserve(email);
        if (tickets) {
          const lang = data.lang === 'en' ? 'en' : 'fa';
          const fa = lang === 'fa';
          const subject = fa ? 'تأیید عضویت خبرنامه اومینی‌کورپ' : 'Confirm your OminiCorp subscription';
          const confirm = `${origin}/opt-in?lang=${lang}&token=${tickets.confirmToken}`;
          const cancel = `${origin}/opt-out?lang=${lang}&token=${tickets.optOutToken}`;
          try {
            await send({ to: email, subject, text: fa ? `برای تأیید عضویت:\n${confirm}\n\nلینک لغو عضویت را نگه دارید:\n${cancel}` : `Confirm your subscription:\n${confirm}\n\nKeep this link to unsubscribe:\n${cancel}` });
          } catch (error) { store.cancel(tickets.confirmToken); throw error; }
        }
      }
      return json(res, 202, 'sent');
    } catch {
      console.error('Form delivery or storage failed');
      return json(res, 503, 'unavailable');
    } finally { release(); }
  };
}
