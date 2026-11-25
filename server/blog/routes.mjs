import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { dashboard, editor, login, settingsPage } from './admin.mjs';
import { createAutomation } from './automation.mjs';
import { handleMcp } from './mcp.mjs';
import { renderArticle, renderList, renderMissing, sitemap } from './render.mjs';
import { sections, slug } from './schema.mjs';
import { BlogConflict, openBlog } from './store.mjs';

const digest = (value) => createHash('sha256').update(value).digest();
const equal = (first, second) => typeof first === 'string' && typeof second === 'string' && timingSafeEqual(digest(first), digest(second));
const random = () => randomBytes(32).toString('base64url');
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

function settingsData(params) {
  return { ...Object.fromEntries(['enabled','mcp','mcpWrite','mcpPublish','ai','scheduling','autopublish','useProxy'].map((key) => [key, params.get(key) === 'on'])),
    aiEndpoint: (params.get('aiEndpoint') || '').trim(), aiModel: params.get('aiModel') || '', feeds: [...new Set((params.get('feeds') || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean))],
    proxyUrl: (params.get('proxyUrl') || '').trim(), interval: Number(params.get('interval')), batch: Number(params.get('batch')) };
}

const notices = { saved: 'مقاله ذخیره شد.', removed: 'مقاله حذف شد.', waiting: 'تولید در حال انجام است؛ چند دقیقه بعد وضعیت را بررسی کنید.', disabled: 'تولید در تنظیمات خاموش است.', settings: 'تنظیمات ذخیره شد.' };
const errorText = (error) => error.kind === 'slug-locked' ? 'نامک هر دو زبان پس از اولین انتشار ثابت است.' : error instanceof BlogConflict ? 'این نامک یا منبع قبلاً در مقالهٔ دیگری ثبت شده است.' : error instanceof ZodError ? `این ورودی‌ها را بررسی کنید: ${[...new Set(error.issues.map((entry) => entry.path.join('.')))].slice(0,12).join('، ')}` : 'ذخیره‌سازی انجام نشد.';

export function createBlog(env = process.env, options = {}) {
  const originUrl = new URL(env.BLOG_SITE_URL || env.PUBLIC_SITE_URL || 'https://ominicorp.com');
  if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash) throw new Error('BLOG_SITE_URL must be a site origin');
  const origin = originUrl.origin;
  const store = options.store || openBlog(env.BLOG_DB || 'data/blog.sqlite', { seedContent: env.BLOG_SEED !== '0' });
  const automation = options.automation || createAutomation(store, env, options.network);
  const password = env.BLOG_ADMIN_PASSWORD?.length >= 16 ? env.BLOG_ADMIN_PASSWORD : undefined;
  const mcpToken = env.BLOG_MCP_TOKEN?.length >= 32 ? env.BLOG_MCP_TOKEN : undefined;
  const secure = env.BLOG_COOKIE_SECURE !== '0';
  const sessions = new Map(), loginAttempts = new Map();
  let loginWindow = 0, totalAttempts = 0, mcpCount = 0, mcpWindow = 0, pending;
  const ready = { ai: Boolean(env.BLOG_AI_KEY), mcp: Boolean(mcpToken), proxy: Boolean(env.BLOG_PROXY_URL) };
  const setCookie = (res, value, age) => res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`);
  function originAllowed(req) {
    const from = req.headers.origin;
    return !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) && (!from || from === origin || (!secure && from === `http://${req.headers.host}`));
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
    const path = url.pathname;
    const method = req.method;
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)omini_desk=([A-Za-z\d_-]{43})(?:;|$)/)?.[1];
    const session = sessions.get(token);
    const logged = session?.expires > Date.now();
    const home = '/admin';
    if (method === 'POST' && !originAllowed(req)) return res.writeHead(403).end();
    if (path === '/admin/login') {
      if (method === 'GET' || method === 'HEAD') return logged ? redirect(res, home) : html(req, res, 200, login(origin, '', password));
      if (method !== 'POST' || !password) return res.writeHead(405).end();
      if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return res.writeHead(415).end();
      const now = Date.now();
      if (now >= loginWindow) { loginWindow = now + 15 * 60000; totalAttempts = 0; loginAttempts.clear(); }
      const ip = req.socket.remoteAddress, attempts = loginAttempts.get(ip) || 0;
      if (attempts >= 8 || totalAttempts >= 100) return html(req, res, 429, login(origin, 'تعداد تلاش‌ها زیاد است. بعداً دوباره امتحان کنید.', password));
      const raw = await read(req, 3000);
      if (raw === null) return res.writeHead(413).end();
      if (!equal(new URLSearchParams(raw).get('password'), password)) {
        totalAttempts++; loginAttempts.set(ip, attempts + 1);
        return html(req, res, 401, login(origin, 'رمز عبور درست نیست.', password));
      }
      loginAttempts.delete(ip);
      for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
      if (sessions.size >= 50) sessions.delete(sessions.keys().next().value);
      const key = random();
      sessions.set(key, { csrf: random(), expires: now + sessionAge * 1000 });
      setCookie(res, key, sessionAge);
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
      if (path === '/admin/settings') return html(req, res, 200, settingsPage({ origin, csrf, settings: status, ready, notice: issue }));
      if (match && !match[2]) return html(req, res, 200, editor({ origin, csrf, item: item || undefined, id }));
      return res.writeHead(404).end();
    }
    if (method !== 'POST') return res.writeHead(405).end();
    if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return res.writeHead(415).end();
    const raw = await read(req, 600000);
    if (raw === null) return res.writeHead(413).end();
    const params = new URLSearchParams(raw);
    if (!equal(params.get('csrf'), csrf)) return res.writeHead(403).end();
    if (path === '/admin/logout') { sessions.delete(token); setCookie(res, '', 0); return redirect(res, '/admin/login'); }
    if (path === '/admin/generate') {
      if (!status.enabled || !status.ai) return redirect(res, `${home}?notice=disabled`);
      run(false);
      return redirect(res, `${home}?notice=waiting`);
    }
    if (path === '/admin/settings') {
      const settings = settingsData(params);
      try { store.setSettings(settings); return redirect(res, '/admin/settings?notice=settings'); }
      catch (error) { return html(req, res, 422, settingsPage({ origin, csrf, settings, ready, error: errorText(error) })); }
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
    if (!state.enabled || !state.mcp || !mcpToken) return res.writeHead(404).end();
    if (!originAllowed(req)) return res.writeHead(403).end();
    if (!equal(req.headers.authorization, `Bearer ${mcpToken}`)) return res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="OminiCorp Journal"' }).end();
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
