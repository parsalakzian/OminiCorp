import { checkPassword, constantEqual as equal, digest, makeKey as random, parseOrigin, passwordRecord, tokenHash, updateAiSecrets, updateSystem, validPassword } from '../installation.mjs';
import { ZodError } from 'zod';
import { aiSettingsPage, categoriesPage, categoryEditor, confirmCategoryDelete, confirmDelete, dashboard, editor, login, mediaLibrary, mcpSettingsPage, setupPage, systemPage } from './admin.mjs';
import { CategoryError, categorySchema, categorySlug } from './categories.mjs';
import { createAutomation } from './automation.mjs';
import { createMcpHttp } from './mcp-http.mjs';
import { createImageImporter } from './media-import.mjs';
import { imageContentTypes, maxImageBytes, MediaError, mediaFromPath, sendImage } from './media.mjs';
import { render as renderHome } from '../../site/render.mjs';
import { latestArticleCount } from './home.mjs';
import { sitemap } from './sitemap.mjs';
import { journalPageSize, listUrl, renderArticle, renderList, renderMissing } from './render.mjs';
import { slug } from './schema.mjs';
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

async function readBytes(req, limit) {
  if (Number(req.headers['content-length']) > limit) { req.resume(); return null; }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) { req.resume(); return null; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const read = async (req, limit) => (await readBytes(req, limit))?.toString('utf8') ?? null;
const allowExternalCovers = (res) => res.setHeader('Content-Security-Policy', `${res.getHeader('Content-Security-Policy')}; img-src 'self' https:`);

function postData(params) {
  const get = (key) => params.get(key) || '';
  const translations = Object.fromEntries(['fa', 'en'].map((lang) => [lang, { ...Object.fromEntries(['title', 'slug', 'excerpt', 'seoTitle', 'description', 'body'].map((key) => [key, get(`${lang}.${key}`)])), tags: get(`${lang}.tags`).split(/[,،]/).map((tag) => tag.trim()).filter(Boolean) }]));
  const sources = get('sources').split(/\r?\n/).filter((line) => line.trim()).map((line) => { const i = line.lastIndexOf('|'); return { title: i < 0 ? '' : line.slice(0, i).trim(), url: i < 0 ? '' : line.slice(i + 1).trim() }; });
  const cover = params.has('cover.src') ? (get('cover.src').trim() ? { src: get('cover.src'), altFa: get('cover.altFa'), altEn: get('cover.altEn') } : null) : undefined;
  return { cover, author: get('author'), section: get('section'), state: get('state'), sources, ...translations };
}

function aiSettingsData(params, stored) {
  return { ...stored, ...Object.fromEntries(['ai','scheduling','autopublish','useProxy'].map((key) => [key, params.get(key) === 'on'])),
    aiEndpoint: (params.get('aiEndpoint') || '').trim(), aiModel: params.get('aiModel') || '', feeds: [...new Set((params.get('feeds') || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean))],
    proxyUrl: (params.get('proxyUrl') || '').trim(), interval: Number(params.get('interval')), batch: Number(params.get('batch')) };
}

const notices = { categorySaved: 'دسته ذخیره شد.', categoryRemoved: 'دسته حذف شد.', imageUploaded: 'تصویر بارگذاری شد.', imageRemoved: 'تصویر حذف شد.', saved: 'مقاله ذخیره شد.', removed: 'مقاله حذف شد.', waiting: 'تولید در حال انجام است؛ چند دقیقه بعد وضعیت را بررسی کنید.', disabled: 'تولید در تنظیمات خاموش است.', settings: 'تنظیمات ذخیره شد.', password: 'رمز تغییر کرد. دوباره وارد شوید.', revoked: 'توکن لغو شد؛ اتصال با آن دیگر ممکن نیست.' };
const errorText = (error) => error instanceof CategoryError ? 'دستهٔ مقاله را از فهرست فعلی انتخاب کنید.' : error instanceof MediaError ? 'مسیر تصاویر را بررسی کنید. فقط تصویرهای موجود در کتابخانه مجازند.' : error.kind === 'slug-locked' ? 'نامک هر دو زبان پس از اولین انتشار ثابت است.' : error instanceof BlogConflict ? 'این نامک یا منبع قبلاً در مقالهٔ دیگری ثبت شده است.' : error instanceof ZodError ? `این ورودی‌ها را بررسی کنید: ${[...new Set(error.issues.map((entry) => entry.path.join('.')))].slice(0,12).join('، ')}` : 'ذخیره‌سازی انجام نشد.';

export function createBlog(options = {}) {
  const store = options.store || openBlog('data/blog.sqlite');
  const automation = options.automation || createAutomation(store, options.network);
  const sessions = new Map(), loginAttempts = new Map();
  let loginWindow = 0, totalAttempts = 0, pending, activeChecks = 0;
  const mcp = createMcpHttp({ store, automation, readBytes, importImage: options.importImage || createImageImporter() });
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
    const categoryMatch = path.match(/^\/admin\/categories\/edit\/([a-z0-9-]{2,48})(\/delete)?$/);
    const categoryKey = categoryMatch?.[1];
    const category = categoryKey && store.findCategory(categoryKey);
    if (categoryKey && !category) return res.writeHead(404).end();
    const mediaMatch = path.match(/^\/admin\/media\/([a-f0-9]{64})(\/delete)?$/);
    const library = (page, code = 200, error) => html(req, res, code, mediaLibrary({ origin, csrf, ...store.listImages(page), page, notice: issue, error }));
    if (path === '/admin/media' && method === 'POST') {
      if (!equal(req.headers['x-csrf-token'], csrf)) return res.writeHead(403).end();
      const type = req.headers['content-type'];
      if (!imageContentTypes.includes(type)) return res.writeHead(415).end();
      const data = await readBytes(req, maxImageBytes);
      if (data === null) return res.writeHead(413).end();
      if (sessions.get(token) !== session || session.expires <= Date.now()) return res.writeHead(403).end();
      try {
        const uploaded = store.uploadImage(data, type === 'application/octet-stream' ? undefined : type);
        return res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(uploaded));
      } catch (error) {
        if (!(error instanceof MediaError)) throw error;
        return res.writeHead(422).end();
      }
    }
    if (mediaMatch && !mediaMatch[2]) return sendImage(req, res, readOnly ? store.getImage(mediaMatch[1]) : undefined);
    const match = path.match(/^\/admin\/articles\/(new|[1-9]\d{0,8})(\/delete)?$/);
    const id = match && match[1] !== 'new' ? Number(match[1]) : undefined;
    const item = id && store.find(id);
    if (id && !item) return res.writeHead(404).end();
    if (method === 'GET' || method === 'HEAD') {
      if (path === '/admin/categories') return html(req, res, 200, categoriesPage({ origin, csrf, categories: store.categories(true), notice: issue }));
      if (categoryMatch?.[2]) return html(req, res, 200, confirmCategoryDelete({ origin, csrf, entry: category }));
      if (category || path === '/admin/categories/new') return html(req, res, 200, categoryEditor({ origin, csrf, entry: category || undefined, slug: categoryKey }));
      if (path === '/admin/media') return library(pageNumber(url.searchParams.get('page')));
      if (path === '/admin') {
        const page = pageNumber(url.searchParams.get('page'));
        const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
        const state = ['draft', 'published'].includes(url.searchParams.get('state')) ? url.searchParams.get('state') : '';
        const categories = store.categories(true);
        const section = categories.find(({ slug }) => slug === url.searchParams.get('section'))?.slug || '';
        return html(req, res, 200, dashboard({ origin, csrf, ...store.list({ admin: true, page, size: 20, query, state, section, bilingual: true }), query, state, section, categories, articleCount: store.list({ admin: true, size: 1 }).total, published: store.list({ size: 1 }).total, run: store.getRun(), settings: status, notice: issue, page }));
      }
      const preview = path.match(/^\/admin\/articles\/([1-9]\d{0,8})\/preview\/(fa|en)$/);
      if (preview) {
        const draft = store.find(Number(preview[1]));
        if (!draft) return res.writeHead(404).end();
        if (draft.cover?.src.startsWith('https://')) allowExternalCovers(res);
        return html(req, res, 200, renderArticle(preview[2], origin, { ...draft, published: draft.published || draft.modified }, [], true, store.findCategory(draft.section)));
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
      if (match?.[2] && item) return html(req, res, 200, confirmDelete({ origin, csrf, item }));
      if (match && !match[2]) { allowExternalCovers(res); return html(req, res, 200, editor({ origin, csrf, item: item || undefined, id, categories: store.categories() })); }
      return res.writeHead(404).end();
    }
    if (method !== 'POST') return res.writeHead(405).end();
    if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') return res.writeHead(415).end();
    const raw = await read(req, 600000);
    if (raw === null) return res.writeHead(413).end();
    const params = new URLSearchParams(raw);
    if (!equal(params.get('csrf'), csrf)) return res.writeHead(403).end();
    if (categoryMatch?.[2]) {
      try { if (!store.removeCategory(categoryKey)) return res.writeHead(404).end(); }
      catch (error) {
        if (!(error instanceof CategoryError)) throw error;
        return html(req, res, 409, confirmCategoryDelete({ origin, csrf, entry: category, error: 'ابتدا مقاله‌ها را به دستهٔ دیگری منتقل کنید؛ دست‌کم یک دسته باید باقی بماند.' }));
      }
      return redirect(res, '/admin/categories?notice=categoryRemoved');
    }
    if (category || path === '/admin/categories/new') {
      const input = Object.fromEntries(['slug', 'nameFa', 'nameEn', 'descriptionFa', 'descriptionEn', 'theme'].map((key) => [key, params.get(key) || '']));
      input.position = params.get('position')?.trim() ? Number(params.get('position')) : 100;
      const candidate = categorySchema.safeParse(input);
      if (!candidate.success) return html(req, res, 422, categoryEditor({ origin, csrf, slug: categoryKey, entry: input, error: 'نام هر دو زبان، نامک و ترتیب معتبر را وارد کنید.' }));
      try { if (!store.saveCategory(candidate.data, categoryKey)) return res.writeHead(404).end(); }
      catch (error) {
        if (!(error instanceof CategoryError)) throw error;
        return html(req, res, 409, categoryEditor({ origin, csrf, slug: categoryKey, entry: { ...input, slug: categoryKey || input.slug }, error: 'نامک تکراری یا تغییرناپذیر است، یا سقف تعداد دسته‌ها پر شده است.' }));
      }
      return redirect(res, '/admin/categories?notice=categorySaved');
    }
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
      const requested = (params.get('mcpOrigins') || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
      try {
        const mcpOrigins = [...new Set(requested.map(parseOrigin))];
        store.setSettings({ ...store.getSettings(), ...switches, mcpOrigins });
      } catch {
        return html(req, res, 422, mcpSettingsPage({ origin, csrf, system, settings: { ...status, ...switches, mcpOrigins: requested.slice(0,10) }, error: 'حداکثر ۱۰ مبدأ معتبر وارد کنید: HTTPS یا HTTP روی localhost؛ بدون مسیر یا ستاره.' }));
      }
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
    if (mediaMatch?.[2]) {
      try { if (!store.removeImage(mediaMatch[1])) return res.writeHead(404).end(); }
      catch (error) { if (error instanceof MediaError) return library(1, 409, 'این تصویر در مقاله‌ای استفاده شده و قابل حذف نیست.'); throw error; }
      return redirect(res, '/admin/media?notice=imageRemoved');
    }
    if (!match) return res.writeHead(404).end();
    if (match[2]) { if (!id) return res.writeHead(404).end(); store.remove(id); return redirect(res, `${home}?notice=removed`); }
    const value = postData(params);
    try { store.save(value, id); return redirect(res, `${home}?notice=saved`); }
    catch (error) { allowExternalCovers(res); return html(req, res, error instanceof BlogConflict ? 409 : 422, editor({ origin, csrf, item: { ...value, published: item?.published, cover: value.cover === undefined ? item?.cover : value.cover }, id, categories: store.categories(), error: errorText(error) })); }
  }

  async function route(req, res, url) {
    const path = url.pathname;
    if (path === '/admin/' || /^\/(?:en\/)?blog(?:\/category\/[a-z0-9-]+)?\/$/.test(path)) return redirect(res, path.slice(0, -1) + url.search, 308);
    if (path === '/mcp' || path === '/mcp/' || path === '/mcp/media' || path === '/mcp/media/') return mcp(req, res, path.startsWith('/mcp/media'));
    const media = mediaFromPath(path);
    if (media) return sendImage(req, res, ['GET', 'HEAD'].includes(req.method) && store.getSettings().enabled ? store.getImage(media, true) : undefined);
    if (path === '/admin' || path.startsWith('/admin/')) return admin(req, res, url);
    if (['/', '/index.html', '/en.html'].includes(path) && ['GET', 'HEAD'].includes(req.method)) {
      const origin = store.getSystem().siteUrl;
      const enabled = store.getSettings().enabled;
      const articles = enabled ? store.list({ size: latestArticleCount }).items : [];
      if (articles.some((item) => item.cover?.src.startsWith('https://'))) allowExternalCovers(res);
      res.setHeader('Cache-Control', 'no-cache');
      return html(req, res, 200, renderHome(path === '/en.html' ? 'en' : 'fa', { origin, articles, categories: enabled ? store.categories() : [] }));
    }
    const blog = path.match(/^\/(en\/)?blog(?:\/category\/([^/]+)|\/([^/]+))?$/);
    if (!blog && !['/robots.txt', '/sitemap.xml'].includes(path)) return false;
    const origin = store.getSystem().siteUrl;
    if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (path === '/robots.txt') return res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`User-agent: *\nDisallow: /admin\nDisallow: /mcp\nSitemap: ${origin}/sitemap.xml\n`);
    const enabled = store.getSettings().enabled;
    if (path === '/sitemap.xml') return res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' }).end(req.method === 'HEAD' ? undefined : sitemap(origin, { enabled, articles: enabled ? store.published() : [], categories: enabled ? store.categories() : [] }));
    const lang = blog[1] ? 'en' : 'fa';
    if (!enabled) return html(req, res, 404, renderMissing(lang, origin));
    if (blog[3]) {
      let name;
      try { name = decodeURIComponent(blog[3]); } catch { return html(req, res, 404, renderMissing(lang, origin)); }
      const item = slug.safeParse(name).success && store.lookup(lang, name);
      if (!item) return html(req, res, 404, renderMissing(lang, origin));
      const same = store.list({ lang, section: item.section, size: 4 }).items.filter((other) => other.id !== item.id);
      const more = store.list({ lang, size: 4 }).items.filter((other) => other.id !== item.id && !same.some((entry) => entry.id === other.id));
      if (item.cover?.src.startsWith('https://')) allowExternalCovers(res);
      return html(req, res, 200, renderArticle(lang, origin, item, [...same, ...more].slice(0, 3), false, store.findCategory(item.section)));
    }
    const page = pageNumber(url.searchParams.get('page'));
    const query = (url.searchParams.get('q') || '').trim().slice(0,100);
    const categories = store.categories();
    const rawSection = blog[2] || url.searchParams.get('section') || '';
    if (rawSection && (!categorySlug.safeParse(rawSection).success || !categories.some(({ slug }) => slug === rawSection))) return html(req, res, 404, renderMissing(lang, origin));
    if (!blog[2] && rawSection) return redirect(res, listUrl(lang, page, rawSection, query), 308);
    const section = rawSection;
    const size = journalPageSize;
    const result = store.list({ lang, page, query, section, size });
    if (page > 1 && !result.items.length) return html(req, res, 404, renderMissing(lang, origin));
    if (result.items.some((item) => item.cover?.src.startsWith('https://'))) allowExternalCovers(res);
    return html(req, res, 200, renderList(lang, origin, { ...result, page, section, query, size, categories }));
  }
  return { route, store, async close() { clearInterval(clock); await automation.close?.(); await pending; store.close(); } };
}
