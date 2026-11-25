import { checkPassword, constantEqual as equal, digest, makeKey as random, parseOrigin, passwordRecord, tokenHash, updateAiSecrets, updateSystem, validPassword } from '../installation.mjs';
import { ZodError } from 'zod';
import { aiSettingsPage, dashboard, editor, login, mcpSettingsPage, setupPage, systemPage } from './admin.mjs';
import { createAutomation } from './automation.mjs';
import { handleMcp } from './mcp.mjs';
import { renderArticle, renderList, renderMissing, sitemap } from './render.mjs';
import { sections, slug } from './schema.mjs';
import { BlogConflict, openBlog } from './store.mjs';

const pageNumber = (value) => Math.max(1, Math.min(10000, Math.floor(Number(value) || 1)));
const html = (req, res, status, value) => {
  const structured = value.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)?.[1];
  if (structured) res.setHeader('Content-Security-Policy', `${res.getHeader('Content-Security-Policy')}; script-src 'self' 'sha256-${digest(structured).toString('base64')}'`);
  return res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : value);
};
const redirect = (res, location, status = 303) => res.writeHead(status, { Location: location }).end();
const cookieName = 'omini_desk';
const sessionAge = 12 * 60 * 60;

async function read(req, limit) {
  if (Number(req.headers['content-length']) > limit) { req.resume(); return null; }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) { req.resume(); return null; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function postData(params) {
  const get = (key) => params.get(key) || '';
  const translations = Object.fromEntries(['fa', 'en'].map((lang) => [lang, { ...Object.fromEntries(['title', 'slug', 'excerpt', 'seoTitle', 'description', 'body'].map((key) => [key, get(`${lang}.${key}`)])), tags: get(`${lang}.tags`).split(/[,،]/).map((tag) => tag.trim()).filter(Boolean) }]));
  const sources = get('sources').split(/\r?\n/).filter((line) => line.trim()).map((line) => { const i = line.lastIndexOf('|'); return { title: i < 0 ? '' : line.slice(0, i).trim(), url: i < 0 ? '' : line.slice(i + 1).trim() }; });
  return { author: get('author'), section: get('section'), state: get('state'), sources, ...translations };
}

function aiSettingsData(params, stored) {
  return { ...stored, ...Object.fromEntries(['ai','scheduling','autopublish','useProxy'].map((key) => [key, params.get(key) === 'on'])),
    aiEndpoint: (params.get('aiEndpoint') || '').trim(), aiModel: params.get('aiModel') || '', feeds: [...new Set((params.get('feeds') || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean))],
    proxyUrl: (params.get('proxyUrl') || '').trim(), interval: Number(params.get('interval')), batch: Number(params.get('batch')) };
}

const notices = { saved: 'مقاله ذخیره شد.', removed: 'مقاله حذف شد.', waiting: 'تولید در حال انجام است؛ چند دقیقه بعد وضعیت را بررسی کنید.', disabled: 'تولید در تنظیمات خاموش است.', settings: 'تنظیمات ذخیره شد.', password: 'رمز تغییر کرد. دوباره وارد شوید.', revoked: 'توکن لغو شد؛ اتصال با آن دیگر ممکن نیست.' };
const errorText = (error) => error.kind === 'slug-locked' ? 'نامک هر دو زبان پس از اولین انتشار ثابت است.' : error instanceof BlogConflict ? 'این نامک یا منبع قبلاً در مقالهٔ دیگری ثبت شده است.' : error instanceof ZodError ? `این ورودی‌ها را بررسی کنید: ${[...new Set(error.issues.map((entry) => entry.path.join('.')))].slice(0,12).join('، ')}` : 'ذخیره‌سازی انجام نشد.';

export function createBlog(options = {}) {
  const store = options.store || openBlog('data/blog.sqlite');
  const automation = options.automation || createAutomation(store, options.network);
  const sessions = new Map(), loginAttempts = new Map();
  let loginWindow = 0, totalAttempts = 0, mcpCount = 0, mcpWindow = 0, pending, activeChecks = 0;
  const setCookie = (res, value, age, origin) => res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`);
  function originAllowed(req, origin) {
    if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return false;
    const from = req.headers.origin;
    if (!from || from === origin) return true;
    try { return parseOrigin(from) === from && new URL(from).host === req.headers.host; } catch { return false; }
  }
  function allowAttempt(ip, now) {
    if (now >= loginWindow) { loginWindow = now + 15 * 60000; totalAttempts = 0; loginAttempts.clear(); }
    const attempts = loginAttempts.get(ip) || 0;
    if (attempts >= 8 || totalAttempts >= 100 || activeChecks >= 4) return false;
    totalAttempts++;
    loginAttempts.set(ip, attempts + 1);
    return true;
  }
  async function passwordWork(task) {
    activeChecks++;
    try { return await task(); } finally { activeChecks--; }
  }
  function run(scheduled, articleLimit) {
    if (pending) return false;
    pending = automation.run({ scheduled, articleLimit }).catch(() => {}).finally(() => { pending = undefined; });
    return true;
  }
  const clock = options.timer === false ? undefined : setInterval(() => run(true), 30000).unref();

  async function admin(req, res, url) {
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', `${res.getHeader('Content-Security-Policy')}; frame-ancestors 'none'`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const system = store.getSystem();
    const origin = system.siteUrl;
    const owner = store.getOwner();
    const path = url.pathname;
    const method = req.method;
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)omini_desk=([A-Za-z\d_-]{43})(?:;|$)/)?.[1];
    const session = sessions.get(token);
    const logged = session?.expires > Date.now() && session.ownerHash === owner?.hash;
    const home = '/admin';
    if (method === 'POST' && !originAllowed(req, origin)) return res.writeHead(403).end();
    const readOnly = method === 'GET' || method === 'HEAD';
    if (path === '/admin/setup') {
      if (owner) return redirect(res, logged ? home : '/admin/login');
      if (readOnly) return html(req, res, 200, setupPage(origin));
      if (method !== 'POST') return res.writeHead(405).end();
      if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return res.writeHead(415).end();
      const ip = req.socket.remoteAddress;
      const raw = await read(req, 6000);
      if (raw === null) return res.writeHead(413).end();
      if (!allowAttempt(ip, Date.now())) return html(req, res, 429, setupPage(origin, 'بعداً دوباره امتحان کنید.'));
      const input = new URLSearchParams(raw);
      const code = input.get('code')?.trim(), value = input.get('password');
      const hash = code && /^[A-Za-z\d_-]{43}$/.test(code) && tokenHash(code);
      if (!hash || !store.verifySetup(hash)) return html(req, res, 403, setupPage(origin, 'کد یک‌بارمصرف معتبر نیست یا منقضی شده است.'));
      if (!validPassword(value) || value !== input.get('confirmation')) return html(req, res, 422, setupPage(origin, 'رمز و تکرار آن باید یکسان و بین ۱۶ تا ۲۵۶ کاراکتر باشند.'));
      let site;
      try { site = parseOrigin(input.get('siteUrl')); } catch { return html(req, res, 422, setupPage(origin, 'نشانی سایت معتبر نیست. HTTPS یا HTTP روی localhost وارد کنید.')); }
      const record = await passwordWork(() => passwordRecord(value));
      if (!store.finishSetup(hash, record, site)) return html(req, res, 409, setupPage(origin, 'کد مصرف یا منقضی شده است.'));
      loginAttempts.delete(ip);
      return redirect(res, '/admin/login');
    }
    if (!owner) return redirect(res, '/admin/setup');
    if (path === '/admin/login') {
      if (readOnly) return logged ? redirect(res, home) : html(req, res, 200, login(origin, '', true, url.searchParams.get('changed') === '1' ? notices.password : ''));
      if (method !== 'POST') return res.writeHead(405).end();
      if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return res.writeHead(415).end();
      const now = Date.now(), ip = req.socket.remoteAddress;
      const raw = await read(req, 6000);
      if (raw === null) return res.writeHead(413).end();
      if (!allowAttempt(ip, now)) return html(req, res, 429, login(origin, 'تعداد تلاش‌ها زیاد است. بعداً دوباره امتحان کنید.', true));
      if (!await passwordWork(() => checkPassword(new URLSearchParams(raw).get('password'), owner)) || store.getOwner()?.hash !== owner.hash) {
        return html(req, res, 401, login(origin, 'رمز عبور درست نیست.', true));
      }
      loginAttempts.delete(ip);
      for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
      if (sessions.size >= 50) sessions.delete(sessions.keys().next().value);
      const key = random();
      sessions.set(key, { csrf: random(), expires: now + sessionAge * 1000, ownerHash: owner.hash });
      setCookie(res, key, sessionAge, origin);
      return redirect(res, home);
    }
    if (!logged) return redirect(res, '/admin/login');
    const csrf = session.csrf;
    const note = url.searchParams.get('notice');
    const issue = Object.hasOwn(notices, note) ? notices[note] : undefined;
    const status = store.getSettings();
    const match = path.match(/^\/admin\/articles\/(new|[1-9]\d{0,8})(\/delete)?$/);
    const id = match && match[1] !== 'new' ? Number(match[1]) : undefined;
    const item = id && store.find(id);
    if (id && !item) return res.writeHead(404).end();
    if (method === 'GET' || method === 'HEAD') {
      if (path === '/admin') {
        const page = pageNumber(url.searchParams.get('page'));
        return html(req, res, 200, dashboard({ origin, csrf, ...store.list({ admin: true, page, size: 20 }), published: store.list({ size: 1 }).total, run: store.getRun(), settings: status, notice: issue, page }));
      }
      const preview = path.match(/^\/admin\/articles\/([1-9]\d{0,8})\/preview\/(fa|en)$/);
      if (preview) {
        const draft = store.find(Number(preview[1]));
        if (!draft) return res.writeHead(404).end();
        return html(req, res, 200, renderArticle(preview[2], origin, { ...draft, published: draft.published || draft.modified }, [], true));
      }
      if (path === '/admin/run') return res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(method === 'HEAD' ? undefined : JSON.stringify({ ...store.getRun(), pending: Boolean(pending) }));
      if (path === '/admin/settings') return redirect(res, '/admin/system');
      if (path === '/admin/system') return html(req, res, 200, systemPage({ origin, csrf, system, settings: status, notice: issue }));
      if (path === '/admin/system/ai') return html(req, res, 200, aiSettingsPage({ origin, csrf, system, settings: status, notice: issue }));
      if (path === '/admin/system/mcp') {
        const reveal = method === 'GET' && session.mcpReveal;
        if (reveal) delete session.mcpReveal;
        const token = reveal && reveal.expires > Date.now() && equal(tokenHash(reveal.token), system.mcpHash) ? reveal.token : undefined;
        return html(req, res, 200, mcpSettingsPage({ origin, csrf, system, settings: status, notice: issue, token }));
      }
      if (match && !match[2]) return html(req, res, 200, editor({ origin, csrf, item: item || undefined, id }));
      return res.writeHead(404).end();
    }
    if (method !== 'POST') return res.writeHead(405).end();
    if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return res.writeHead(415).end();
    const raw = await read(req, 600000);
    if (raw === null) return res.writeHead(413).end();
    const params = new URLSearchParams(raw);
    if (!equal(params.get('csrf'), csrf)) return res.writeHead(403).end();
    if (path === '/admin/logout') { sessions.delete(token); setCookie(res, '', 0, origin); return redirect(res, '/admin/login'); }
    if (path === '/admin/system') {
      const settings = { ...store.getSettings(), enabled: params.get('enabled') === 'on' };
      try { store.saveConfiguration(settings, updateSystem(params, store.getSystem())); }
      catch { return html(req, res, 422, systemPage({ origin, csrf, system, settings: status, error: 'دامنه و تنظیمات SMTP را بررسی کنید. مقادیر قبلی حفظ شدند.' })); }
      return redirect(res, '/admin/system?notice=settings');
    }
    if (path === '/admin/system/ai') {
      const settings = aiSettingsData(params, store.getSettings());
      try { store.saveConfiguration(settings, updateAiSecrets(params, store.getSystem())); }
      catch (error) { return html(req, res, 422, aiSettingsPage({ origin, csrf, system, settings, error: error instanceof ZodError ? errorText(error) : 'کلید API یا نشانی پراکسی را بررسی کنید. مقادیر قبلی حفظ شدند.' })); }
      return redirect(res, '/admin/system/ai?notice=settings');
    }
    if (path === '/admin/system/mcp') {
      const switches = Object.fromEntries(['mcp', 'mcpWrite', 'mcpPublish'].map((key) => [key, params.get(key) === 'on']));
      store.setSettings({ ...store.getSettings(), ...switches });
      return redirect(res, '/admin/system/mcp?notice=settings');
    }
    if (path === '/admin/system/mcp/token' || path === '/admin/system/mcp/revoke') {
      const revoke = path.endsWith('/revoke');
      const token = revoke ? '' : random();
      store.setSystem({ ...store.getSystem(), mcpHash: revoke ? '' : tokenHash(token) });
      for (const value of sessions.values()) delete value.mcpReveal;
      if (token) session.mcpReveal = { token, expires: Date.now() + 60_000 };
      return redirect(res, `/admin/system/mcp${revoke ? '?notice=revoked' : ''}`);
    }
    if (path === '/admin/password') {
      const failure = (status, passwordError) => html(req, res, status, systemPage({ origin, csrf, system, settings: status, passwordError }));
      const candidate = params.get('password');
      if (!validPassword(candidate) || candidate !== params.get('confirmation')) return failure(422, 'رمز جدید و تکرار آن باید یکسان و بین ۱۶ تا ۲۵۶ کاراکتر باشند.');
      const ip = req.socket.remoteAddress;
      if (!allowAttempt(ip, Date.now())) return failure(429, 'بعداً دوباره امتحان کنید.');
      if (!await passwordWork(() => checkPassword(params.get('current'), owner))) return failure(403, 'رمز فعلی درست نیست.');
      const record = await passwordWork(() => passwordRecord(candidate));
      if (store.getOwner()?.hash !== owner.hash) return res.writeHead(409).end();
      store.setOwner(record);
      sessions.clear();
      loginAttempts.delete(ip);
      setCookie(res, '', 0, origin);
      return redirect(res, '/admin/login?changed=1');
    }
    if (path === '/admin/generate') {
      if (!status.enabled || !status.ai) return redirect(res, `${home}?notice=disabled`);
      run(false);
      return redirect(res, `${home}?notice=waiting`);
    }
    if (!match) return res.writeHead(404).end();
    if (match[2]) { if (!id) return res.writeHead(404).end(); store.remove(id); return redirect(res, `${home}?notice=removed`); }
    const value = postData(params);
    try { store.save(value, id); return redirect(res, `${home}?notice=saved`); }
    catch (error) { return html(req, res, error instanceof BlogConflict ? 409 : 422, editor({ origin, csrf, item: value, id, error: errorText(error) })); }
  }

  async function mcp(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    const state = store.getSettings();
    const { mcpHash, siteUrl } = store.getSystem();
    if (!state.enabled || !state.mcp || !mcpHash) return res.writeHead(404).end();
    if (!originAllowed(req, siteUrl)) return res.writeHead(403).end();
    const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z\d._~-]{32,256})$/i)?.[1];
    if (!bearer || !equal(tokenHash(bearer), mcpHash)) return res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="OminiCorp Journal"' }).end();
    if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end();
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return res.writeHead(415).end();
    const now = Date.now();
    if (now >= mcpWindow) { mcpWindow = now + 60000; mcpCount = 0; }
    if (++mcpCount > 120) return res.writeHead(429, { 'Retry-After': '60' }).end();
    const raw = await read(req, 600000);
    if (raw === null) return res.writeHead(413).end();
    let body;
    try { body = JSON.parse(raw); } catch { return res.writeHead(400).end(); }
    await handleMcp(req, res, body, { store, automation });
  }

  async function route(req, res, url) {
    const path = url.pathname;
    if (path === '/admin/' || path === '/blog/' || path === '/en/blog/') return redirect(res, path.slice(0, -1), 308);
    if (path === '/mcp') return mcp(req, res);
    if (path === '/admin' || path.startsWith('/admin/')) return admin(req, res, url);
    const blog = path.match(/^\/(en\/)?blog(?:\/([^/]+))?$/);
    if (!blog && !['/robots.txt', '/sitemap.xml'].includes(path)) return false;
    const origin = store.getSystem().siteUrl;
    if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (path === '/robots.txt') return res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`User-agent: *\nDisallow: /admin\nDisallow: /mcp\nSitemap: ${origin}/sitemap.xml\n`);
    const enabled = store.getSettings().enabled;
    if (path === '/sitemap.xml') return res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' }).end(sitemap(origin, enabled ? store.published() : [], enabled));
    const lang = blog[1] ? 'en' : 'fa';
    if (!enabled) return html(req, res, 404, renderMissing(lang, origin));
    if (blog[2]) {
      let name;
      try { name = decodeURIComponent(blog[2]); } catch { return html(req, res, 404, renderMissing(lang, origin)); }
      const item = slug.safeParse(name).success && store.lookup(lang, name);
      if (!item) return html(req, res, 404, renderMissing(lang, origin));
      const same = store.list({ lang, section: item.section, size: 4 }).items.filter((other) => other.id !== item.id);
      const more = store.list({ lang, size: 4 }).items.filter((other) => other.id !== item.id && !same.some((entry) => entry.id === other.id));
      return html(req, res, 200, renderArticle(lang, origin, item, [...same, ...more].slice(0, 3)));
    }
    const page = pageNumber(url.searchParams.get('page'));
    const query = (url.searchParams.get('q') || '').trim().slice(0,100);
    const rawSection = url.searchParams.get('section');
    const section = sections.includes(rawSection) ? rawSection : '';
    const size = 9;
    const result = store.list({ lang, page, query, section, size });
    if (page > 1 && !result.items.length) return html(req, res, 404, renderMissing(lang, origin));
    return html(req, res, 200, renderList(lang, origin, { ...result, page, section, query, size }));
  }
  return { route, store, async close() { clearInterval(clock); await automation.close?.(); await pending; store.close(); } };
}
