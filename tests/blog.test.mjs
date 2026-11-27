import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import test from 'node:test';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { passwordRecord, tokenHash } from '../server/installation.mjs';
import { createApp } from '../server/app.mjs';
import { createAutomation, parseFeed } from '../server/blog/automation.mjs';
import { createImageImporter } from '../server/blog/media-import.mjs';
import { maxImageBytes, MediaError } from '../server/blog/media.mjs';
import { renderArticle } from '../server/blog/render.mjs';
import { createBlog } from '../server/blog/routes.mjs';
import { seed } from '../server/blog/seed.mjs';
import { defaults, normalizeSource } from '../server/blog/schema.mjs';
import { BlogConflict, openBlog } from '../server/blog/store.mjs';

const origin = 'https://journal.example.test';
const mcpKey = 'test-fixture-mcp-bearer-long-enough-not-secret';
const adminPassword = 'editorial-test-fixture-not-secret';
const date = Date.parse('2026-11-20T12:00:00Z');
const clone = () => structuredClone(seed[0]);

async function fixture(t, settings = {}, options = {}) {
  const store = openBlog(':memory:');
  store.setSettings({ ...defaults, ...settings });
  store.setSystem({ siteUrl: origin, mcpHash: tokenHash(mcpKey) });
  store.setOwner(await passwordRecord(adminPassword));
  const blog = createBlog({ store, timer: false, ...options });
  const app = createApp({}, { blog });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await blog.close(); });
  return { store, url: `http://127.0.0.1:${app.address().port}` };
}

function submit(base, path, data, headers = {}) {
  return fetch(base + path, { method: 'POST', body: new URLSearchParams(data), headers, redirect: 'manual' });
}

test('two locales share publication; duplicate URLs and slugs roll back safely', () => {
  const store = openBlog(':memory:', { seedContent: false });
  try {
    const value = clone();
    value.state = 'draft';
    const saved = store.save(value);
    assert.equal(store.list().total, 0);
    assert.equal(store.lookup('fa', value.fa.slug), undefined);
    const published = store.save({ ...value, state: 'published' }, saved.id);
    assert.equal(store.lookup('en', value.en.slug).id, store.lookup('fa', value.fa.slug).id);
    assert.equal(store.published().length, 1);
    assert.ok(published.published);
    assert.throws(() => store.save({ ...published, fa: { ...published.fa, slug: 'نامک-متفاوت' } }, saved.id), /immutable/);
    const duplicate = clone();
    duplicate.fa.slug += '-جدید'; duplicate.en.slug += '-new'; duplicate.sources[0].url += '?utm_source=feed#fragment';
    assert.throws(() => store.save(duplicate), BlogConflict);
    assert.equal(store.list({ admin: true }).total, 1);
    assert.equal(normalizeSource('https://example.test/a/?b=3&utm_source=rss&a=5#section'), 'https://example.test/a?a=5&b=3');
  } finally { store.close(); }
});

test('SSR publishes only approved articles with reciprocal hreflang, structured data, noindex search, robots and sitemap', async (t) => {
  const { store, url } = await fixture(t);
  const article = store.list().items[0];
  const slugPath = '/blog/' + encodeURIComponent(article.fa.slug);
  const fa = await fetch(url + slugPath);
  const html = await fa.text();
  assert.equal(fa.status, 200);
  assert.match(fa.headers.get('content-security-policy'), /sha256-/);
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.ok(html.includes(`rel="canonical" href="${origin}${slugPath}"`));
  assert.ok(html.includes(`hreflang="en" href="${origin}/en/blog/${article.en.slug}"`));
  const structured = JSON.parse(html.match(/application\/ld\+json">([^]*?)<\/script>/)[1]);
  assert.equal(structured['@graph'][0]['@type'], 'BlogPosting');
  assert.equal(structured['@graph'][0].headline, article.fa.title);
  const en = await (await fetch(`${url}/en/blog/${article.en.slug}`)).text();
  assert.ok(en.includes(`hreflang="fa" href="${origin}${slugPath}"`));
  assert.match(await (await fetch(`${url}/blog?q=test`)).text(), /noindex,follow/);
  assert.match(await (await fetch(`${url}/robots.txt`)).text(), /Sitemap: https:\/\/journal.example.test\/sitemap.xml/);
  store.save({ ...article, state: 'draft' }, article.id);
  assert.equal((await fetch(url + slugPath)).status, 404);
  let xml = await (await fetch(`${url}/sitemap.xml`)).text();
  assert.doesNotMatch(xml, new RegExp(article.en.slug));
  assert.match(xml, /hreflang="x-default"/);
  store.setSettings({ ...defaults, enabled: false });
  assert.equal((await fetch(`${url}/blog`)).status, 404);
  xml = await (await fetch(`${url}/sitemap.xml`)).text();
  assert.doesNotMatch(xml, /<loc>https:\/\/journal\.example\.test\/blog/);
});

test('admin rejects unauthenticated access and unsafe mutations; render escapes stored content', async (t) => {
  const { store, url } = await fixture(t);
  assert.equal((await fetch(`${url}/admin/settings`, { redirect: 'manual' })).headers.get('location'), '/admin/login');
  assert.equal((await submit(url, '/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await submit(url, '/admin/login', { password: adminPassword }, { Origin: 'https://other.test' })).status, 403);
  const session = await submit(url, '/admin/login', { password: adminPassword });
  assert.equal(session.status, 303);
  const cookie = session.headers.get('set-cookie').split(';')[0];
  assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict.*Secure/);
  const dashboard = await fetch(`${url}/admin`, { headers: { Cookie: cookie } });
  assert.equal(dashboard.headers.get('x-robots-tag'), 'noindex, nofollow');
  const csrf = (await dashboard.text()).match(/name="csrf" value="([A-Za-z\d_-]{43})"/)[1];
  const target = store.list().items[0];
  assert.equal((await submit(url, `/admin/articles/${target.id}/delete`, {}, { Cookie: cookie })).status, 403);
  assert.equal((await submit(url, `/admin/articles/${target.id}/delete`, { csrf }, { Cookie: cookie, Origin: 'https://other.test' })).status, 403);
  assert.ok(store.find(target.id));
  const value = clone();
  value.en.body = '# Extra title\n\n<img src=x onerror=alert(1)>\n\n[link](javascript:alert(1))\n\nThis remains readable text.';
  const html = renderArticle('en', origin, { ...value, published: new Date(date).toISOString(), modified: new Date(date).toISOString() });
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert.doesNotMatch(html, /<img src=x|href="javascript:/);
});

test('RSS/Atom, bounded generation, proxy path, duplicate prevention, failures and scheduled auto-publishing', async () => {
  const store = openBlog(':memory:', { seedContent: false });
  const news = (n, offset, suffix = '') => `<item><title>Technology bulletin number ${n}</title><link>https://news.example.test/item-${n}${suffix}</link><pubDate>${new Date(date - offset).toUTCString()}</pubDate><description>Information confirmed for item ${n}.</description></item>`;
  assert.equal(parseFeed('<feed><entry><title>Atom update</title><link rel="alternate" href="https://news.example.test/atom"/><updated>2026-11-20T08:00:00Z</updated></entry></feed>').length, 1);
  assert.deepEqual(parseFeed('<!DOCTYPE invalid><feed/>'), []);
  const feed = `<rss><channel>${news(1,1000)}${news(1,2000,'?utm_source=mirror')}${news(2,3000)}${news(3,86400000*15)}</channel></rss>`;
  let time = date;
  let modelCalls = 0;
  let invalid = false;
  const request = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.dispatcher.constructor.name, 'ProxyAgent');
    if (url.endsWith('/feed')) { assert.equal(options.headers, undefined); return new Response(feed); }
    assert.equal(options.headers.Authorization, 'Bearer fixture-only');
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[0].content, /untrusted/);
    const snippet = JSON.parse(payload.messages[1].content);
    assert.ok(snippet.categories.some(({ slug }) => slug === 'cloud-native'));
    const n = snippet.news.url.at(-1);
    modelCalls++;
    const value = clone();
    value.section = 'cloud-native';
    value.en.slug += '-' + n; value.fa.slug += '-' + n;
    value.en.title += ' ' + n; value.fa.title += ' ' + n;
    return Response.json({ choices: [{ message: { content: invalid ? '{}' : JSON.stringify(value) } }] });
  };
  store.saveCategory({ slug: 'cloud-native', nameFa: 'زیرساخت ابری', nameEn: 'Cloud Native' });
  store.setSystem({ proxySecret: 'http://127.0.0.1:3128', aiKey: 'fixture-only' });
  const worker = createAutomation(store, { request, now: () => time });
  try {
    assert.equal((await worker.run()).status, 'disabled');
    store.setSettings({ ...defaults, ai: true, useProxy: true, aiModel: 'fake', feeds: ['https://news.example.test/feed'], batch: 1 });
    assert.equal((await worker.run()).added, 1);
    assert.equal(store.list().total, 0);
    assert.equal(store.list({ admin: true }).total, 1);
    assert.equal((await worker.run({ scheduled: true })).status, 'disabled');
    store.setSettings({ ...store.getSettings(), scheduling: true, autopublish: true });
    assert.equal((await worker.run({ scheduled: true })).status, 'waiting');
    time += 61 * 60000;
    invalid = true;
    assert.equal((await worker.run({ scheduled: true })).status, 'error');
    time += 61 * 60000;
    invalid = false;
    assert.equal((await worker.run({ scheduled: true })).added, 1);
    assert.equal(store.list().total, 1);
    assert.equal(store.list({ admin: true }).total, 2);
    assert.equal((await worker.run()).added, 0);
    assert.equal(modelCalls, 3);
  } finally { await worker.close(); store.close(); }
});

test('official MCP client initializes and enforces separate CRUD and publication capabilities', async (t) => {
  const { store, url } = await fixture(t, { mcp: true, mcpWrite: false });
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { Origin: 'https://attacker.test', Authorization: `Bearer ${mcpKey}` } })).status, 403);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpKey}` } } }));
  try {
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), ['list_articles', 'get_article', 'list_categories']);
    store.setSettings({ ...store.getSettings(), mcpWrite: true, mcpPublish: true });
    const tools = (await client.listTools()).tools;
    const create = tools.find(({ name }) => name === 'create_article');
    assert.ok(create.inputSchema.properties.article.properties.fa.properties.seoTitle);
    assert.ok(create.inputSchema.properties.article.properties.en.properties.body);
    const value = clone();
    value.fa.slug += '-جدید'; value.en.slug += '-new'; value.sources = [];
    const saved = await client.callTool({ name: 'create_article', arguments: { article: value } });
    assert.equal(saved.structuredContent.article.state, 'draft');
    const id = saved.structuredContent.article.id;
    const updated = await client.callTool({ name: 'update_article', arguments: { id, article: { ...value, author: 'Test editorial team' } } });
    assert.equal(updated.structuredContent.article.author, 'Test editorial team');
    const published = await client.callTool({ name: 'publish_article', arguments: { id, published: true } });
    assert.equal(published.structuredContent.article.state, 'published');
    store.setSettings({ ...store.getSettings(), mcpPublish: false });
    assert.equal((await client.callTool({ name: 'delete_article', arguments: { id } })).isError, true);
    assert.equal(store.find(id).state, 'published');
  } finally { await client.close(); }
});

test('configured forward proxy carries real feed and model HTTP traffic', async () => {
  const { createServer } = await import('node:http');
  const { connect } = await import('node:net');
  const { fetch: networkRequest } = await import('undici');
  const calls = [];
  const mock = createServer(async (req, res) => {
    calls.push([req.method, req.url, req.headers.authorization]);
    if (req.url === '/feed') {
      return res.end(`<rss><channel><item><title>One new technology report</title><link>https://news.example.test/new</link><pubDate>${new Date(date).toUTCString()}</pubDate><description>New report summary.</description></item></channel></rss>`);
    }
    for await (const _ of req) { /* Read the model request before responding. */ }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(clone()) } }] }));
  });
  const proxy = createServer();
  let tunnels = 0;
  const sockets = new Set();
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const targetPort = await listen(mock);
  proxy.on('connect', (req, client, head) => {
    if (req.url !== `127.0.0.1:${targetPort}`) { client.destroy(); return; }
    tunnels++;
    sockets.add(client);
    const target = connect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) target.write(head);
      target.pipe(client).pipe(target);
    });
    target.on('error', () => client.destroy());
    client.on('error', () => target.destroy());
    client.on('close', () => { sockets.delete(client); target.destroy(); });
  });
  const proxyPort = await listen(proxy);
  const store = openBlog(':memory:', { seedContent: false });
  store.setSystem({ aiKey: 'local-model-test-key' });
  const automation = createAutomation(store, {
    now: () => date,
    // Point the selected HTTPS fixture names at the local mock; all actual requests still use the forward proxy.
    request: (url, options) => networkRequest(`http://127.0.0.1:${targetPort}${new URL(url).pathname}`, options),
  });
  try {
    store.setSettings({ ...defaults, ai: true, aiModel: 'local-model', feeds: ['https://news.example.test/feed'], aiEndpoint: 'https://model.example.test/chat/completions', proxyUrl: `http://127.0.0.1:${proxyPort}`, useProxy: true });
    assert.equal((await automation.run()).added, 1);
    assert.ok(tunnels >= 1);
    assert.deepEqual(calls, [['GET', '/feed', undefined], ['POST', '/chat/completions', 'Bearer local-model-test-key']]);
  } finally {
    await automation.close();
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise((resolve) => proxy.close(resolve)), new Promise((resolve) => mock.close(resolve))]);
    store.close();
  }
});

test('MCP browser guide is public while CORS, proxy-friendly alias and the protocol still enforce Bearer auth', async (t) => {
  const inspector = 'http://localhost:6274';
  const { store, url } = await fixture(t, { mcp: true, enabled: false, mcpOrigins: [inspector] });
  const endpoint = `${url}/mcp/`;
  const guide = await fetch(endpoint, { headers: { Accept: 'text/html' } });
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /Streamable HTTP/);
  assert.equal(guide.headers.get('cache-control'), 'no-store');
  const preflight = (origin, headers = 'authorization, content-type, mcp-protocol-version') => fetch(endpoint, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': headers } });
  const allowed = await preflight(inspector);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), inspector);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
  const denied = await preflight('https://another.example');
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal((await preflight(inspector, 'x-custom-header')).status, 403);
  const credentialsMissing = await fetch(endpoint, { method: 'POST', headers: { Origin: inspector } });
  assert.equal(credentialsMissing.status, 401);
  assert.match((await credentialsMissing.json()).error, /reverse proxy/);
  const auth = { Origin: inspector, Authorization: `Bearer ${mcpKey}` };
  const standaloneSse = await fetch(endpoint, { headers: { ...auth, Accept: 'text/event-stream' } });
  assert.equal(standaloneSse.status, 405);
  const client = new Client({ name: 'inspector-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: auth } }));
  try { assert.ok((await client.listTools()).tools.some(({ name }) => name === 'list_articles')); }
  finally { await client.close(); }
  store.setSettings({ ...store.getSettings(), mcp: false });
  assert.equal((await fetch(endpoint, { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: auth })).status, 404);
});


const sampleImage = () => readFileSync(new URL('../assets/media/blog.webp', import.meta.url));

test('existing SQLite journals migrate without replacing articles or settings; media and relationships persist', () => {
  const directory = mkdtempSync(join(tmpdir(), 'omini-media-'));
  const path = join(directory, 'journal.sqlite');
  try {
    let store = openBlog(path);
    const old = store.list().items[0];
    store.setSettings({ ...defaults, mcp: true });
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP TABLE oauth_grant; DROP TABLE oauth_client; DROP TRIGGER article_category_insert; DROP TRIGGER article_category_update; DROP INDEX article_category; DROP TABLE categories; DROP TABLE article_media; DROP TABLE media; UPDATE articles SET payload=json_remove(payload,'$.cover'); PRAGMA user_version=1;");
    legacy.close();
    store = openBlog(path);
    assert.equal(store.getSettings().mcp, true);
    assert.equal(store.findCategory(old.section).slug, old.section);
    assert.deepEqual(store.find(old.id), old);
    const sample = sampleImage();
    assert.throws(() => store.uploadImage(sample.subarray(0, 32)), MediaError);
    assert.throws(() => store.uploadImage(sample, 'image/jpeg'), MediaError);
    const photo = store.uploadImage(sample);
    assert.deepEqual(store.uploadImage(sample), photo);
    store.save({ ...old, cover: { src: photo.url, altEn: 'Custom cover' } }, old.id);
    assert.throws(() => store.save({ ...old, cover: { src: '/journal-media/' + '0'.repeat(64) } }, old.id), MediaError);
    store.close();
    store = openBlog(path);
    try {
      assert.equal(store.find(old.id).cover.altEn, 'Custom cover');
      assert.equal(store.listImages().items[0].used, 1);
      assert.deepEqual(Buffer.from(store.getImage(photo.id, true).data), sample);
      assert.throws(() => store.removeImage(photo.id), /in use/);
      assert.equal(store.remove(old.id), true);
      assert.equal(store.getImage(photo.id, true), undefined);
      assert.equal(store.removeImage(photo.id), true);
    } finally { store.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('image upload HTTP requires session and CSRF, validates bytes and caps request size', async (t) => {
  const { url } = await fixture(t);
  const loginResponse = await submit(url, '/admin/login', { password: adminPassword });
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
  const csrf = (await (await fetch(`${url}/admin/media`, { headers: { Cookie: cookie } })).text()).match(/name="csrf" value="([A-Za-z\d_-]{43})"/)[1];
  const upload = (body, headers = {}) => fetch(`${url}/admin/media`, { method: 'POST', body, redirect: 'manual', headers: { 'Content-Type': 'image/webp', ...headers } });
  const session = { Cookie: cookie, 'X-CSRF-Token': csrf };
  const bytes = sampleImage();
  assert.equal((await upload(bytes)).status, 303);
  assert.equal((await upload(bytes, { Cookie: cookie })).status, 403);
  assert.equal((await upload(bytes, { ...session, Origin: 'https://untrusted.test' })).status, 403);
  assert.equal((await upload('<svg></svg>', { ...session, 'Content-Type': 'image/svg+xml' })).status, 415);
  assert.equal((await upload('<svg></svg>', session)).status, 422);
  assert.equal((await upload(Buffer.alloc(maxImageBytes + 1), session)).status, 413);
  const accepted = await upload(bytes, session);
  assert.equal(accepted.status, 201);
  const { id, url: imageUrl } = await accepted.json();
  assert.equal((await fetch(url + imageUrl)).status, 404);
  const preview = await fetch(`${url}/admin/media/${id}`, { headers: { Cookie: cookie }, method: 'HEAD' });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-type'), 'image/webp');
  assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(preview.headers.get('cache-control'), 'no-store');
});

test('MCP can upload and reuse media; publication, cover updates and safe deletion share admin rules', async (t) => {
  const { store, url } = await fixture(t, { mcp: true, mcpWrite: true, mcpPublish: true });
  const client = new Client({ name: 'media-integration', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpKey}` } } }));
  const call = (name, args) => client.callTool({ name, arguments: args });
  try {
    assert.equal((await call('upload_image', { base64: '!!!!' })).isError, true);
    // A valid extended WebP container large enough to exceed the pre-upload JSON cap.
    const padding = Buffer.alloc(600008);
    padding.write('JUNK');
    padding.writeUInt32LE(padding.length - 8, 4);
    const bytes = Buffer.concat([sampleImage(), padding]);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    const { image } = (await call('upload_image', { base64: bytes.toString('base64') })).structuredContent;
    assert.equal(image.type, 'image/webp');
    assert.equal(image.size, bytes.length);
    const preview = await call('get_image', { id: image.id });
    assert.equal(preview.content[0].mimeType, 'image/webp');
    assert.deepEqual(Buffer.from(preview.content[0].data, 'base64'), bytes);
    const article = clone();
    article.fa.slug += '-تصویر'; article.en.slug += '-image'; article.sources = [];
    article.en.body += `\n\n![Body figure][figure]\n\n[figure]: ${image.url}`;
    article.cover = { src: image.url, altFa: 'تصویر اصلی', altEn: 'Cover figure' };
    const created = (await call('create_article', { article })).structuredContent.article;
    const id = created.id;
    assert.equal(created.cover.altEn, 'Cover figure');
    assert.equal((await fetch(url + image.url)).status, 404);
    assert.ok(!(await (await fetch(url + '/en/blog')).text()).includes(image.url));
    assert.equal((await call('list_images', {})).structuredContent.items[0].used, 1);
    assert.equal((await call('delete_image', { id: image.id })).isError, true);
    const { cover, ...noCover } = article;
    assert.deepEqual((await call('update_article', { id, article: noCover })).structuredContent.article.cover, created.cover);
    assert.equal((await call('publish_article', { id, published: true })).structuredContent.article.state, 'published');
    for (const index of ['/blog', '/en/blog']) {
      const listing = await (await fetch(url + index)).text();
      assert.ok(listing.includes(`class="journal-art" href="${index}/`));
      assert.equal(listing.split(`src="${image.url}"`).length - 1, 2, 'MCP cover appears in the featured link and article card');
    }
    const publicImage = await fetch(url + image.url);
    assert.equal(publicImage.status, 200);
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), bytes);
    const html = await (await fetch(`${url}/en/blog/${article.en.slug}`)).text();
    assert.match(html, /alt="Body figure"/);
    assert.match(html, /alt="Cover figure"/);
    assert.equal((await call('update_article', { id, article: { ...noCover, cover: null } })).structuredContent.article.cover, null);
    assert.equal((await fetch(url + image.url)).status, 200, 'still used in Markdown');
    assert.equal((await call('publish_article', { id, published: false })).structuredContent.article.state, 'draft');
    assert.equal((await fetch(url + image.url)).status, 404);
    assert.equal((await call('delete_article', { id })).structuredContent.removed, true);
    assert.equal((await call('delete_image', { id: image.id })).structuredContent.removed, true);
    store.setSettings({ ...store.getSettings(), mcpWrite: false });
    assert.ok(!(await client.listTools()).tools.some(({ name }) => name.endsWith('_image') || name === 'list_images'));
  } finally { await client.close(); }
});


const category = { slug: 'cloud-platforms', nameFa: 'پلتفرم‌های ابری', nameEn: 'Cloud platforms', descriptionFa: 'راهنمای ساخت زیرساخت', descriptionEn: 'Guides to building infrastructure', theme: 'violet', position: 5 };

test('bilingual category pages keep filters while paging, expose only published counts and are discoverable', async (t) => {
  const { store, url } = await fixture(t);
  store.saveCategory(category);
  assert.equal(store.categories()[0].slug, category.slug);
  assert.throws(() => store.saveCategory(category), /already exists/);
  assert.throws(() => store.saveCategory({ ...category, slug: 'different' }, category.slug), /cannot be changed/);
  assert.throws(() => store.save({ ...clone(), section: 'unknown-category' }), /does not exist/);
  for (let n = 0; n < 9; n++) {
    const item = clone();
    item.section = category.slug;
    item.sources = [];
    item.en.title = `${n === 7 ? 'Other' : 'Topic'} guide ${n}`;
    item.en.slug = `cloud-guide-${n}`;
    item.fa.slug = `راهنما-${n}`;
    item.state = n < 8 ? 'published' : 'draft';
    store.save(item);
  }
  assert.equal(store.categories().find(({ slug }) => slug === category.slug).count, 8);
  assert.equal(store.categories(true).find(({ slug }) => slug === category.slug).count, 9);
  assert.throws(() => store.removeCategory(category.slug), /Move articles/);
  const path = '/en/blog/category/' + category.slug;
  const faPath = '/blog/category/' + category.slug;
  const first = await (await fetch(url + path + '?q=Topic')).text();
  assert.match(first, /<h1>Cloud platforms<\/h1>/);
  assert.equal((first.match(/class="journal-card"/g) || []).length, 6);
  assert.ok(first.includes(`href="${path}?page=2&amp;q=Topic"`));
  assert.ok(first.includes(`hreflang="fa" href="${origin}${faPath}"`));
  const second = await (await fetch(url + path + '?page=2&q=Topic')).text();
  assert.equal((second.match(/class="journal-card"/g) || []).length, 1);
  assert.match(second, /aria-current="page">2<\/span>/);
  assert.doesNotMatch(second, /Topic guide 8/);
  assert.equal((await fetch(url + path + '?page=3')).status, 404);
  const legacy = await fetch(`${url}/en/blog?section=${category.slug}&q=Topic`, { redirect: 'manual' });
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get('location'), path + '?q=Topic');
  const article = await (await fetch(url + '/en/blog/cloud-guide-1')).text();
  assert.ok(article.includes(`href="${path}">Cloud platforms`));
  assert.ok((await (await fetch(url + '/sitemap.xml')).text()).includes(origin + path));
  const empty = await (await fetch(url + '/en/blog/category/design')).text();
  assert.match(empty, /rel="canonical"/);
  assert.doesNotMatch(empty, /noindex,follow/);
  assert.equal(store.removeCategory('design'), true);
  assert.equal((await fetch(url + '/en/blog/category/design')).status, 404);
});

test('official MCP category CRUD and article assignment observe the publication permission', async (t) => {
  const { store, url } = await fixture(t, { mcp: true, mcpWrite: true, mcpPublish: false });
  const client = new Client({ name: 'category-integration', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpKey}` } } }));
  const call = (name, args) => client.callTool({ name, arguments: args });
  try {
    assert.ok((await call('list_categories', {})).structuredContent.categories.some(({ slug }) => slug === 'engineering'));
    assert.ok(!(await client.listTools()).tools.some(({ name }) => name === 'create_category'));
    store.setSettings({ ...store.getSettings(), mcpPublish: true });
    const added = await call('create_category', { category });
    assert.equal(added.structuredContent.category.nameFa, category.nameFa);
    const { slug, ...properties } = category;
    const updated = await call('update_category', { slug, category: { ...properties, nameEn: 'Cloud and infrastructure' } });
    assert.equal(updated.structuredContent.category.nameEn, 'Cloud and infrastructure');
    const value = clone();
    value.section = slug; value.sources = []; value.en.slug += '-cloud'; value.fa.slug += '-ابری';
    const created = await call('create_article', { article: value });
    assert.equal(created.structuredContent.article.section, slug);
    assert.equal((await call('list_articles', { state: 'draft', section: slug })).structuredContent.total, 1);
    assert.equal((await call('delete_category', { slug })).isError, true);
    store.setSettings({ ...store.getSettings(), mcpWrite: false });
    assert.equal((await call('list_categories', {})).structuredContent.categories.find((item) => item.slug === slug).count, 0);
    assert.equal((await call('list_articles', { state: 'draft', section: slug })).structuredContent.total, 0);
    store.setSettings({ ...store.getSettings(), mcpWrite: true });
    await call('delete_article', { id: created.structuredContent.article.id });
    assert.equal((await call('delete_category', { slug })).structuredContent.removed, true);
  } finally { await client.close(); }
});


function imageResponse(statusCode, headers, bytes = []) {
  return Object.assign(Readable.from(bytes), { statusCode, headers });
}

test('HTTPS import checks and pins public addresses, blocks private redirects, oversized bodies and cancellation', async () => {
  const requests = [];
  const resolve = async (hostname) => hostname === 'private.example' ? [{ address: '192.168.1.1', family: 4 }] : [
    { address: '2606:4700:4700::1111', family: 6 }, { address: '93.184.216.34', family: 4 },
  ];
  const open = async (url, address) => {
    assert.equal(address.address, '93.184.216.34');
    requests.push(url.href);
    if (url.pathname === '/start') return imageResponse(302, { location: 'https://cdn.example/image' });
    if (url.pathname === '/private') return imageResponse(302, { location: 'https://private.example/image' });
    if (url.pathname === '/large') return imageResponse(200, { 'content-length': maxImageBytes + 1 });
    return imageResponse(200, {}, [sampleImage()]);
  };
  const importer = createImageImporter({ resolve, open });
  assert.deepEqual(await importer('https://public.example/start'), sampleImage());
  assert.deepEqual(requests, ['https://public.example/start', 'https://cdn.example/image']);
  await assert.rejects(importer('https://public.example/private'), /public addresses/);
  await assert.rejects(importer('https://public.example/large'), /25 MiB/);
  for (const url of ['https://127.0.0.1/image', 'https://[::1]/image', 'https://169.254.169.254/image']) await assert.rejects(importer(url), /public addresses/);
  for (const url of ['http://public.example/image', 'https://public.example:444/image', 'https://a:b@public.example/image']) await assert.rejects(importer(url), /direct public HTTPS/);
  const mixed = createImageImporter({ resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }], open });
  await assert.rejects(mixed('https://mixed.example/image'), /public addresses/);
  const stalled = createImageImporter({ resolve: () => new Promise(() => {}), open });
  const controller = new AbortController();
  const pending = stalled('https://public.example/image', controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.deepEqual(requests.slice(2), ['https://public.example/private', 'https://public.example/large']);
});

test('MCP upload accepts public links and Base64 variants; binary endpoint handles files above the old cap', async (t) => {
  const importImage = createImageImporter({ resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    open: async () => imageResponse(200, {}, [sampleImage()]) });
  const { store, url } = await fixture(t, { mcp: true, mcpWrite: false }, { importImage });
  const auth = { Authorization: `Bearer ${mcpKey}` };
  const raw = (body, headers = auth) => fetch(url + '/mcp/media', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', ...headers } });
  assert.equal((await raw(sampleImage(), {})).status, 401);
  assert.equal((await raw(sampleImage())).status, 403);
  store.setSettings({ ...store.getSettings(), mcpWrite: true });
  assert.equal((await raw(sampleImage(), { ...auth, Origin: 'https://untrusted.example' })).status, 403);
  const padding = Buffer.alloc(4 * 1024 * 1024 + 8);
  padding.write('JUNK');
  padding.writeUInt32LE(padding.length - 8, 4);
  const bytes = Buffer.concat([sampleImage(), padding]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  const uploaded = await raw(bytes);
  assert.equal(uploaded.status, 201);
  const { image: binary } = await uploaded.json();
  assert.equal(binary.size, bytes.length);
  assert.equal((await fetch(url + binary.url)).status, 404);
  assert.equal((await raw('not an image')).status, 422);
  const client = new Client({ name: 'alternate-upload-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: auth } }));
  const tool = (args) => client.callTool({ name: 'upload_image', arguments: args });
  try {
    assert.equal((await tool({})).isError, true);
    assert.equal((await tool({ url: 'https://cdn.example/picture', base64: 'aaaa' })).isError, true);
    const { image: linked } = (await tool({ url: 'https://cdn.example/picture' })).structuredContent;
    assert.equal(linked.size, sampleImage().length);
    const wrapped = sampleImage().toString('base64url').match(/.{1,80}/g).join('\n');
    assert.equal((await tool({ base64: `data:image/webp;base64,${wrapped}` })).structuredContent.image.id, linked.id);
    assert.equal((await tool({ base64: bytes.toString('base64') })).structuredContent.image.id, binary.id);
  } finally { await client.close(); }
});


test('modern Streamable HTTP negotiates the SDK protocol, sends JSON-RPC over SSE, and preserves direct JSON', async (t) => {
  const { url } = await fixture(t, { mcp: true });
  const endpoint = `${url}/mcp`;
  const frame = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const auth = { Authorization: `Bearer ${mcpKey}`, 'Content-Type': 'application/json' };
  const both = 'application/json, text/event-stream';
  const direct = 'application/json, text/event-stream;q=0.5';
  const post = (body, accept = both, extra = {}) => fetch(endpoint, { method: 'POST', headers: { ...auth, Accept: accept, ...extra }, body });
  const init = (version) => frame(7, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'transport-test', version: '1' } });
  const stream = await post(init(LATEST_PROTOCOL_VERSION));
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(stream.headers.get('x-accel-buffering'), 'no');
  assert.equal(stream.headers.get('mcp-session-id'), null);
  const sse = await stream.text();
  assert.match(sse, /event: message/);
  const message = JSON.parse(sse.match(/^data: (.+)$/m)[1]);
  assert.equal(message.id, 7);
  assert.equal(message.jsonrpc, '2.0');
  assert.equal(message.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  const json = await post(init('2025-06-18'), direct);
  assert.match(json.headers.get('content-type'), /^application\/json/);
  assert.equal((await json.json()).result.protocolVersion, '2025-06-18');
  const initialized = await post(frame(undefined, 'notifications/initialized'));
  assert.equal(initialized.status, 202);
  assert.equal(await initialized.text(), '');
  const bad = await post('{', direct);
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null });
  for (const accept of ['*/*', 'application/json', 'application/json, text/event-stream;q=0']) {
    const plain = await post(frame(9, 'tools/list'), accept);
    assert.equal(plain.status, 200);
    assert.match(plain.headers.get('content-type'), /^application\/json/);
    const result = await plain.json();
    assert.equal(result.jsonrpc, '2.0');
    assert.equal(result.id, 9);
    assert.ok(result.result.tools.some(({ name }) => name === 'list_articles'));
  }
  assert.equal((await post(frame(9, 'tools/list'), 'text/html')).status, 406);
  assert.equal((await post(frame(9, 'tools/list'), 'application/json;q=0, */*')).status, 406);
  const streamOnly = await post(frame(10, 'ping'), 'TEXT/EVENT-STREAM');
  assert.match(streamOnly.headers.get('content-type'), /^text\/event-stream/);
  assert.match(await streamOnly.text(), /"id":10/);
  assert.equal((await post(frame(3, 'ping'), direct, { 'MCP-Protocol-Version': '1999-12-31' })).status, 400);
});

test('an SSE tool call reports progress before a pending image download finishes', async (t) => {
  let resolveImage;
  const image = new Promise((resolve) => { resolveImage = resolve; });
  const { url } = await fixture(t, { mcp: true, mcpWrite: true }, { importImage: () => image });
  const reply = await fetch(`${url}/mcp`, { method: 'POST', signal: AbortSignal.timeout(4000),
    headers: { Authorization: `Bearer ${mcpKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'upload', method: 'tools/call', params: { name: 'upload_image', arguments: { url: 'https://example.com/file' }, _meta: { progressToken: 'asset' } } }),
  });
  const reader = reply.body.getReader();
  try {
    assert.equal(reply.status, 200);
    assert.match(reply.headers.get('content-type'), /^text\/event-stream/);
    const decoder = new TextDecoder();
    let first = '';
    while (!first.includes('\n\n')) {
      const { done, value } = await reader.read();
      assert.equal(done, false, 'stream ended before progress');
      first += decoder.decode(value, { stream: true });
    }
    assert.match(first, /"method":"notifications\/progress"/);
    assert.match(first, /"progressToken":"asset"/);
    assert.doesNotMatch(first, /"id":"upload"/);
    resolveImage(sampleImage());
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
    }
    assert.match(rest, /Image saved/);
    assert.match(rest, /"id":"upload"/);
    assert.match(rest, /"structuredContent":\{"image":/);
  } finally { resolveImage(sampleImage()); await reader.cancel().catch(() => {}); }
});


test('live bilingual homepage and image sitemap reflect published covers, inline images and canonical pagination only', async (t) => {
  const { store, url } = await fixture(t);
  const cover = store.uploadImage(sampleImage());
  const inline = store.uploadImage(readFileSync(new URL('../assets/media/hero.webp', import.meta.url)));
  const hidden = store.uploadImage(readFileSync(new URL('../assets/media/logo.webp', import.meta.url)));
  const external = 'https://images.example.test/thumbnail.webp?width=600&v=2';
  let latest;
  for (let n = 0; n < 8; n++) {
    const item = clone();
    item.sources = [];
    item.en.slug = `sitemap-topic-${n}`;
    item.fa.slug = `نوشته-نقشه-${n}`;
    item.en.title = `Sitemap Topic Article ${n}`;
    item.fa.title = `نوشتهٔ نقشهٔ سایت ${n}`;
    item.state = n === 7 ? 'draft' : 'published';
    if (n === 7) item.cover = { src: hidden.url };
    if (n === 5) item.cover = { src: external };
    if (n === 6) {
      item.cover = { src: cover.url };
      item.fa.body += `\n\n![نمودار](${inline.url})\n\n![نمودار تکراری](${inline.url})`;
    }
    const saved = store.save(item, undefined, new Date(date + (n + 10) * 86400000).toISOString());
    if (n === 6) latest = saved;
  }
  const enPage = '/en/blog/' + latest.en.slug;
  const faPage = '/blog/' + encodeURIComponent(latest.fa.slug);
  const response = await fetch(url + '/en.html');
  assert.match(response.headers.get('content-security-policy'), /img-src 'self' https:/);
  const homepage = await response.text();
  assert.match(homepage, /<h2 id="home-journal-title">Latest articles<\/h2>/);
  assert.match(homepage, /class="home-journal-card"><a href="\/en\/blog\/sitemap-topic-6"/);
  assert.ok(homepage.includes(`src="${cover.url}"`));
  assert.doesNotMatch(homepage, /sitemap-topic-7|sitemap-topic-3/);
  assert.ok((await (await fetch(url + '/')).text()).includes(faPage));
  const map = async () => {
    const res = await fetch(url + '/sitemap.xml');
    assert.match(res.headers.get('content-type'), /application\/xml/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const xml = await res.text();
    assert.equal(XMLValidator.validate(xml), true);
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset /);
    assert.match(xml, /\n  <url>\n    <loc>https:\/\/journal\.example\.test\/<\/loc>\n    <priority>1\.0000<\/priority>/);
    assert.match(xml, /\n    <image:image>\n      <image:loc>[^\n]+<\/image:loc>\n    <\/image:image>/);
    assert.doesNotMatch(xml, /&lt;\?xml|<loc>[^<]*\/(?:index\.html|sitemap\.xml)<\/loc>/);
    assert.equal(xml, await (await fetch(url + '/sitemap.xml')).text());
    assert.match(xml, /xmlns:image="http:\/\/www.google.com\/schemas\/sitemap-image\/1.1"/);
    const result = new XMLParser({ parseTagValue: false, ignoreAttributes: false, isArray: (name) => ['url', 'image:image', 'xhtml:link'].includes(name) }).parse(xml);
    return new Map(result.urlset.url.map((entry) => [entry.loc, entry]));
  };
  let entries = await map();
  const imgs = (path) => entries.get(origin + path)['image:image'].map((entry) => entry['image:loc']);
  for (const path of ['/', '/en.html', '/blog', '/en/blog', '/blog?page=2', '/en/blog?page=2', '/blog/category/engineering?page=2', '/blog/category/design']) {
    assert.ok(entries.has(origin + path), path);
  }
  assert.equal(entries.get(origin + '/').priority, '1.0000');
  assert.equal(entries.get(origin + '/en.html').priority, '0.8000');
  assert.equal(entries.get(origin + '/blog').priority, '0.8000');
  assert.equal(entries.get(origin + '/blog?page=2').priority, '0.6400');
  assert.equal(entries.get(origin + enPage).lastmod, new Date(latest.modified).toISOString().replace('.000Z', '+00:00'));
  assert.equal(entries.get(origin + '/').lastmod, undefined);
  assert.deepEqual(entries.get(origin + enPage)['xhtml:link'].map((item) => item['@_hreflang']), ['fa', 'en', 'x-default']);
  assert.ok(imgs('/').includes(origin + cover.url));
  assert.ok(imgs('/en.html').includes(external));
  assert.ok(imgs('/en.html').includes(origin + '/assets/media/hero.webp'));
  assert.ok(imgs('/en/blog/category/engineering').includes(origin + cover.url));
  assert.ok(imgs(enPage).includes(origin + cover.url));
  assert.ok(!imgs(enPage).includes(origin + inline.url));
  assert.equal(imgs(faPage).filter((src) => src === origin + inline.url).length, 1);
  assert.ok([...entries].every(([path, entry]) => !path.includes('sitemap-topic-7') && !path.includes('?q=') && !path.includes('/admin') && !entry['image:image'].some((item) => item['image:loc'] === origin + hidden.url)));
  store.save({ ...latest, state: 'draft' }, latest.id);
  entries = await map();
  assert.ok(!entries.has(origin + enPage));
  assert.doesNotMatch(await (await fetch(url + '/en.html')).text(), /sitemap-topic-6/);
  store.setSettings({ ...store.getSettings(), enabled: false });
  assert.deepEqual([...(await map()).keys()], [origin + '/', origin + '/en.html']);
  assert.doesNotMatch(await (await fetch(url + '/en.html')).text(), /home-journal-title/);
});


test('public pages have distinct bilingual sharing copy, valid JSON-LD, icons and known image dimensions', async (t) => {
  const { store, url } = await fixture(t);
  const image = store.uploadImage(sampleImage());
  const draft = clone();
  draft.state = 'published';
  draft.sources = [];
  draft.fa.slug = 'متادیتای-اختصاصی';
  draft.en.slug = 'custom-sharing-metadata';
  draft.en.seoTitle = 'A distinct sharing title for the published article';
  draft.en.description = 'How to verify that sharing metadata and image properties match the article and the language of the link.';
  draft.en.body += `\n\n![Image of the release](${image.url})`;
  draft.cover = { src: image.url, altFa: 'تصویر انتشار', altEn: 'Image of the release' };
  const saved = store.save(draft, undefined, '2026-12-01T10:00:00Z');
  const titles = new Set();
  const pathFa = `/blog/${encodeURIComponent(saved.fa.slug)}`;
  const pathEn = `/en/blog/${saved.en.slug}`;
  const property = (html, attr, key) => new RegExp(`<meta ${attr}="${key}" content="([^"]+)"`).exec(html)?.[1];
  for (const path of ['/', '/en.html', '/blog', '/en/blog', `/blog/category/${saved.section}`, pathFa, pathEn]) {
    const res = await fetch(url + path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.equal(property(html, 'property', 'og:url'), origin + path);
    assert.equal(property(html, 'property', 'og:type'), path === pathFa || path === pathEn ? 'article' : 'website');
    assert.equal(property(html, 'name', 'twitter:card'), 'summary_large_image');
    for (const tag of ['title', 'description', 'image', 'image:alt']) {
      const value = property(html, 'property', `og:${tag}`);
      assert.ok(value, `${tag} on ${path}`);
      assert.equal(property(html, 'name', `twitter:${tag}`), value);
    }
    titles.add(property(html, 'property', 'og:title'));
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/assets\/media\/apple-touch-icon.png"/);
    const [, schema] = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
    const hash = createHash('sha256').update(schema).digest('base64');
    assert.ok(res.headers.get('content-security-policy').includes(`'sha256-${hash}'`));
    const types = (JSON.parse(schema)['@graph'] || [JSON.parse(schema)]).map((node) => node['@type']);
    assert.ok(types.includes(path === pathFa || path === pathEn ? 'BlogPosting' : path.includes('blog') ? 'CollectionPage' : 'Organization'));
    if (path === pathEn) {
      assert.equal(property(html, 'property', 'og:title'), saved.en.seoTitle);
      assert.equal(property(html, 'property', 'og:image'), origin + image.url);
      assert.equal(property(html, 'property', 'og:image:width'), String(image.width));
      assert.equal(html.match(new RegExp(`<img src="${image.url}"[^>]+\\bwidth="${image.width}"[^>]+>`, 'g')).length, 2);
    }
  }
  assert.equal(titles.size, 7);
  for (const [file, type] of [['apple-touch-icon.png', 'image/png'], ['share-home.jpg', 'image/jpeg'], ['share-journal.jpg', 'image/jpeg']]) {
    const response = await fetch(`${url}/assets/media/${file}`);
    assert.equal(response.headers.get('content-type'), type);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
});

test('gzip negotiation serves public GET and HEAD with Vary without compressing private or MCP pages', async (t) => {
  const { url } = await fixture(t);
  const raw = (path, encoding, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    request(url + path, { method, headers: { 'Accept-Encoding': encoding, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject).end();
  });
  for (const [path, expected] of [['/', '<!doctype html>'], ['/en/blog', '<!doctype html>'], ['/assets/home.css', 'Generated'], ['/sitemap.xml', '<?xml']]) {
    const compressed = await raw(path, 'gzip, br');
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers['content-encoding'], 'gzip');
    assert.match(compressed.headers.vary, /Accept-Encoding/i);
    const plain = await raw(path, 'gzip;q=0, *;q=1');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.match(plain.headers.vary, /Accept-Encoding/i);
    assert.ok(plain.data.toString().includes(expected));
    assert.deepEqual(gunzipSync(compressed.data), plain.data);
    const head = await raw(path, 'gzip', 'HEAD');
    assert.equal(head.headers['content-encoding'], 'gzip');
    assert.equal(head.data.length, 0);
  }
  for (const [path, headers] of [['/admin/login', {}], ['/mcp', { Accept: 'text/html' }], ['/assets/media/share-home.jpg', {}]]) {
    const response = await raw(path, 'gzip', 'GET', headers);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], undefined);
  }
});

test('login reaches a paginated dashboard with real SQLite categories and tolerates invalid legacy dates', async (t) => {
  const { store, url } = await fixture(t);
  for (let i = 0; i < 23; i++) {
    const item = clone();
    item.en.slug = `desk-example-${i}`;
    item.fa.slug = `نمونه-تحریریه-${i}`;
    item.sources = [];
    store.save(item);
  }
  const login = await submit(url, '/admin/login', { password: adminPassword, next: '//outside.example' });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/admin');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const desk = await fetch(url + '/admin', { headers: { cookie } });
  assert.equal(desk.status, 200);
  const htmlPage = await desk.text();
  assert.match(htmlPage, /href="\/admin\?page=2&amp;q=&amp;state=&amp;section="/);
  assert.doesNotMatch(htmlPage, /[?&]categories=/);
  assert.equal((await fetch(url + '/admin?page=2', { headers: { cookie } })).status, 200);
  store.setRun({ status: 'error', at: 'invalid date', next: 'invalid date', added: 0, errors: 1 });
  assert.equal((await fetch(url + '/admin', { headers: { cookie } })).status, 200);
  const csrf = htmlPage.match(/name="csrf" value="([^"]+)"/)[1];
  const response = await submit(url, '/admin/password', { csrf, current: 'wrong-password-fixture', password: adminPassword, confirmation: adminPassword }, { cookie });
  assert.equal(response.status, 403);
  const html = await response.text();
  assert.match(html, /رمز فعلی درست نیست/);
  assert.match(html, /name="enabled"[^>]+checked/);
  assert.equal((await fetch(url + '/admin', { headers: { cookie } })).status, 200);
});

test('manually registered MCP OAuth works alongside Bearer, with consent, exact redirects, PKCE, refresh and revocation', async (t) => {
  const { store, url } = await fixture(t, { mcp: true, mcpWrite: true, mcpPublish: true, mcpOrigins: ['http://localhost:6274'], mcpDcrCallbacks: [] });
  const metadataPath = '/.well-known/oauth-protected-resource/mcp';
  const authPath = '/admin/oauth/authorize';
  const returnUri = 'http://localhost:6274/oauth/callback?existing=yes';
  const verifier = 'v'.repeat(60);
  const paramsFor = (id) => new URLSearchParams({ client_id: id, response_type: 'code', scope: 'mcp', state: 'opaque-test-state', redirect_uri: returnUri, resource: origin + '/mcp',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const rpc = async (bearer, method = 'tools/list', params) => fetch(url + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const login = async (next) => {
    const response = await submit(url, '/admin/login', { password: adminPassword, ...(next ? { next } : {}) });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), next || '/admin');
    return response.headers.get('set-cookie').split(';')[0];
  };
  assert.equal((await fetch(url + metadataPath)).status, 404);
  assert.doesNotMatch((await rpc()).headers.get('www-authenticate'), /resource_metadata/);
  const cookie = await login();
  const page = await fetch(url + '/admin/system/mcp', { headers: { cookie } });
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)[1];
  const manage = '/admin/system/mcp/oauth';
  const data = { csrf, name: 'MCP integration test', client_id: 'read-test', redirect_uri: returnUri, auth: 'none', access: 'read' };
  assert.equal((await submit(url, manage, { ...data, csrf: 'bad' }, { cookie })).status, 403);
  assert.equal((await submit(url, manage, { ...data, redirect_uri: 'https://app.example/callback#fragment' }, { cookie })).status, 422);
  assert.equal((await submit(url, manage, data, { cookie })).status, 303);
  assert.equal((await submit(url, manage, data, { cookie })).status, 409);
  assert.equal((await submit(url, manage, { ...data, client_id: 'write-test', auth: 'client_secret_basic', access: 'write' }, { cookie })).status, 303);
  const secretPage = await (await fetch(url + '/admin/system/mcp/connections', { headers: { cookie } })).text();
  const secret = secretPage.match(/data-oauth-reveal[^]*?<input readonly dir="ltr" value="([^"]+)"/)[1];
  assert.ok(!((await (await fetch(url + '/admin/system/mcp/connections', { headers: { cookie } })).text()).includes(secret)));
  assert.equal(store.oauth.getClient('write-test').secret, tokenHash(secret));
  const missing = await rpc();
  assert.equal(missing.status, 401);
  assert.ok(missing.headers.get('www-authenticate').includes(origin + metadataPath));
  const metadata = await (await fetch(url + metadataPath)).json();
  const issuer = await (await fetch(url + '/.well-known/oauth-authorization-server')).json();
  assert.equal(metadata.resource, origin + '/mcp');
  assert.deepEqual(metadata.authorization_servers, [origin]);
  assert.equal(issuer.issuer, origin);
  assert.equal(issuer.authorization_endpoint, origin + authPath);
  assert.equal(issuer.token_endpoint, origin + '/oauth/token');
  assert.deepEqual(issuer.code_challenge_methods_supported, ['S256']);
  const params = paramsFor('read-test');
  const requestPath = `${authPath}?${params}`;
  const invalid = new URLSearchParams(params); invalid.set('redirect_uri', returnUri + 'x');
  assert.equal((await fetch(url + authPath + '?' + invalid, { redirect: 'manual', headers: { cookie } })).status, 400);
  const unauth = await fetch(url + requestPath, { redirect: 'manual' });
  assert.equal(unauth.status, 303);
  assert.equal(new URL(unauth.headers.get('location'), url).searchParams.get('next'), requestPath);
  const consentCookie = await login(requestPath);
  const codeFor = async (client, decision = 'allow') => {
    const query = paramsFor(client);
    const consent = await fetch(url + authPath + '?' + query, { headers: { cookie: consentCookie } });
    assert.equal(consent.status, 200);
    const nonce = (await consent.text()).match(/name="csrf" value="([^"]+)"/)[1];
    const result = await submit(url, authPath, { csrf: nonce, request: String(query), decision }, { cookie: consentCookie, Origin: origin });
    assert.equal(result.status, 303);
    const callback = new URL(result.headers.get('location'));
    assert.equal(callback.origin + callback.pathname, 'http://localhost:6274/oauth/callback');
    assert.equal(callback.searchParams.get('existing'), 'yes');
    assert.equal(callback.searchParams.get('state'), 'opaque-test-state');
    if (decision === 'deny') assert.equal(callback.searchParams.get('error'), 'access_denied');
    else assert.ok(callback.searchParams.get('code'));
    return callback.searchParams.get('code');
  };
  assert.equal(await codeFor('read-test', 'deny'), null);
  const code = await codeFor('read-test');
  const exchange = (params, headers) => submit(url, '/oauth/token', params, headers);
  const tokenData = { client_id: 'read-test', grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: returnUri, resource: origin + '/mcp' };
  assert.equal((await exchange({ ...tokenData, code_verifier: 'x'.repeat(60) })).status, 400);
  assert.equal((await exchange({ ...tokenData, resource: origin + '/elsewhere' })).status, 400);
  const obtained = await exchange(tokenData, { Origin: 'http://localhost:6274' });
  assert.equal(obtained.status, 200);
  assert.equal(obtained.headers.get('cache-control'), 'no-store');
  assert.equal(obtained.headers.get('access-control-allow-origin'), 'http://localhost:6274');
  assert.equal((await exchange(tokenData)).status, 400);
  const tokens = await obtained.json();
  const names = async (token) => (await (await rpc(token)).json()).result.tools.map((entry) => entry.name);
  assert.ok((await names(tokens.access_token)).includes('list_articles'));
  assert.ok(!(await names(tokens.access_token)).includes('upload_image'));
  assert.ok((await names(mcpKey)).includes('create_category'));
  const raw = (token) => fetch(url + '/mcp/media', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/webp' }, body: sampleImage() });
  assert.equal((await raw(tokens.access_token)).status, 403);
  const refreshData = { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: 'read-test' };
  const rotated = await (await exchange(refreshData)).json();
  assert.ok(rotated.access_token);
  assert.equal((await rpc(tokens.access_token)).status, 401);
  assert.equal((await exchange(refreshData)).status, 400);
  const writerCode = await codeFor('write-test');
  const writerData = { ...tokenData, code: writerCode }; delete writerData.client_id;
  const basic = (value) => ({ Authorization: `Basic ${Buffer.from('write-test:' + value).toString('base64')}` });
  assert.equal((await exchange(writerData, basic('invalid-placeholder'))).status, 401);
  const writer = await (await exchange(writerData, basic(secret))).json();
  assert.ok((await names(writer.access_token)).includes('upload_image'));
  assert.ok(!(await names(writer.access_token)).includes('create_category'));
  assert.equal((await raw(writer.access_token)).status, 201);
  store.setSettings({ ...store.getSettings(), mcpWrite: false });
  assert.ok(!(await names(writer.access_token)).includes('upload_image'));
  assert.equal((await submit(url, manage + '/remove', { csrf, client_id: 'read-test' }, { cookie })).status, 303);
  assert.equal((await rpc(rotated.access_token)).status, 401);
  store.setSystem({ ...store.getSystem(), mcpHash: '' });
  assert.equal((await rpc(writer.access_token)).status, 200);
  assert.equal((await rpc(mcpKey)).status, 401);
  store.setSettings({ ...store.getSettings(), mcp: false });
  assert.equal((await rpc(writer.access_token)).status, 404);
});

test('unified default DCR callback and full access work, while restrictions affect the same token immediately', async (t) => {
  const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const issuerPath = '/.well-known/oauth-authorization-server';
  const events = [];
  const { url } = await fixture(t, { mcp: true }, { reportMcp: (...event) => events.push(event.join(' ')) });
  const metadata = await (await fetch(url + issuerPath)).json();
  assert.equal(metadata.client_id_metadata_document_supported, undefined);
  assert.equal(metadata.registration_endpoint, origin + '/oauth/register');
  const registered = await fetch(url + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [callback], client_name: 'ChatGPT', token_endpoint_auth_method: 'client_secret_post' }) });
  assert.equal(registered.status, 201);
  const dcr = await registered.json();
  const login = await submit(url, '/admin/login', { password: adminPassword });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const base = '/admin/system/mcp';
  const settings = await (await fetch(url + base, { headers: { cookie } })).text();
  assert.doesNotMatch(settings, /CIMD|mcpChatGPT/);
  assert.ok(settings.includes(callback));
  const csrf = settings.match(/name="csrf" value="([^"]+)"/)[1];
  const verifier = 'x'.repeat(60);
  const authPath = '/admin/oauth/authorize';
  const resource = origin + '/mcp';
  const params = new URLSearchParams({ client_id: dcr.client_id, redirect_uri: callback, response_type: 'code', resource, state: 'dcr-fixture-state', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  assert.equal((await fetch(url + authPath + '?' + new URLSearchParams({ ...Object.fromEntries(params), client_id: 'stale-dcr-client' }))).status, 400);
  for (const decision of ['deny', 'allow']) {
    const consent = await fetch(url + authPath + '?' + params, { headers: { cookie } });
    assert.equal(consent.status, 200);
    const approved = await submit(url, authPath, { csrf, request: String(params), decision }, { cookie });
    const redirect = new URL(approved.headers.get('location'));
    assert.equal(redirect.origin + redirect.pathname, callback);
    assert.equal(redirect.searchParams.get('iss'), origin);
    assert.equal(redirect.searchParams.get('state'), 'dcr-fixture-state');
    if (decision === 'deny') { assert.equal(redirect.searchParams.get('error'), 'access_denied'); continue; }
    const exchange = { client_id: dcr.client_id, redirect_uri: callback, resource, grant_type: 'authorization_code', code: redirect.searchParams.get('code'), code_verifier: verifier };
    assert.equal((await submit(url, '/oauth/token', exchange)).status, 400);
    const response = await submit(url, '/oauth/token', { ...exchange, client_secret: dcr.client_secret });
    assert.equal(response.status, 200);
    const { access_token } = await response.json();
    const unauthenticated = await fetch(url + '/mcp', { method: 'POST' });
    assert.equal(unauthenticated.status, 401);
    assert.ok(unauthenticated.headers.get('www-authenticate').includes(origin + '/.well-known/oauth-protected-resource/mcp'));
    const client = new Client({ name: 'dcr-access-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${access_token}` } } }));
    const names = async () => (await client.listTools()).tools.map(({ name }) => name);
    const edit = (access) => submit(url, base + '/oauth/access', { csrf, client_id: dcr.client_id, access }, { cookie });
    try {
      assert.ok((await names()).includes('publish_article'));
      assert.ok((await names()).includes('upload_image'));
      assert.equal((await submit(url, base + '/oauth/access', { csrf: 'invalid', client_id: dcr.client_id, access: 'read' }, { cookie })).status, 403);
      assert.equal((await edit('bad-level')).status, 422);
      assert.equal((await edit('read')).status, 303);
      assert.ok(!(await names()).includes('upload_image'));
      const denied = await client.callTool({ name: 'create_category', arguments: { category } }).catch(() => ({ isError: true }));
      assert.equal(denied.isError, true);
      assert.equal((await edit('write')).status, 303);
      assert.ok((await names()).includes('upload_image'));
      assert.ok(!(await names()).includes('publish_article'));
      assert.equal((await submit(url, base + '/oauth/full', { csrf }, { cookie })).status, 422);
      assert.equal((await submit(url, base + '/oauth/full', { csrf, confirm: 'on' }, { cookie })).status, 303);
      assert.ok((await names()).includes('publish_article'));
      const created = await client.callTool({ name: 'create_category', arguments: { category } });
      assert.equal(created.structuredContent.category.slug, category.slug);
      assert.equal((await submit(url, base, { csrf, mcp: 'on', serverAccess: 'read' }, { cookie })).status, 303);
      assert.ok(!(await names()).includes('upload_image'));
      assert.match(await (await fetch(url + base + '/connections', { headers: { cookie } })).text(), /سقف سرور محدود شده/);
      assert.equal((await submit(url, base, { csrf, mcp: 'on', serverAccess: 'full' }, { cookie })).status, 303);
      assert.ok((await names()).includes('publish_article'));
      assert.equal((await submit(url, base, { csrf, mcp: 'on', serverAccess: 'full', mcpDcrCallbacks: '' }, { cookie })).status, 303);
      const revoked = await fetch(url + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      assert.ok([401, 404].includes(revoked.status));
    } finally { await client.close(); }
  }
  assert.equal((await fetch(url + issuerPath)).status, 404);
  assert.deepEqual(events.slice(0, 9), ['register created', 'authorize unknown_client', 'authorize denied', 'authorize code_issued', 'token client_auth_method_mismatch', 'token code_exchanged', 'transport missing_bearer', 'initialize 200', 'tools_list 200']);
  const log = events.join('\n');
  for (const privateValue of [dcr.client_id, dcr.client_secret, verifier, callback, 'dcr-fixture-state', 'stale-dcr-client']) assert.ok(!log.includes(privateValue));
});

test('manual OAuth exchanges across Basic and POST, uses multiple exact callbacks, changes grants live and rotates credentials', async (t) => {
  const { store, url } = await fixture(t, { mcp: true, mcpWrite: true, mcpPublish: true });
  const login = await submit(url, '/admin/login', { password: adminPassword });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const base = '/admin/system/mcp';
  const page = await (await fetch(url + base + '/connections/new', { headers: { cookie } })).text();
  const csrf = page.match(/name="csrf" value="([^"]+)"/)[1];
  const id = 'manual-integration', secret = 'fixture-With&colon:Plus+%123';
  const callback = 'https://provider.example/oauth/callback';
  const local = 'http://127.0.0.1:9876/oauth/callback';
  const save = { csrf, client_id: id, name: 'Integration fixture', redirect_uri: `${callback}\n${local}`, auth: 'client_secret_post', client_secret: secret };
  assert.equal((await submit(url, base + '/oauth', save, { cookie })).status, 303);
  const contents = async () => (await fetch(url + base + '/connections', { headers: { cookie } })).text();
  assert.ok(!(await contents()).includes(secret));
  assert.equal(store.oauth.getClient(id).secret, tokenHash(secret));
  assert.ok((await contents()).includes(local));
  const verifier = 'v'.repeat(60);
  const auth = '/admin/oauth/authorize';
  const query = (uri) => new URLSearchParams({ client_id: id, redirect_uri: uri, response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), scope: '', resource: origin + '/mcp/' });
  assert.equal((await fetch(url + auth + '?' + query('http://127.0.0.1:8765/oauth/callback'), { headers: { cookie } })).status, 400);
  const params = query(local);
  assert.equal((await fetch(url + auth + '?' + params, { headers: { cookie } })).status, 200);
  const approved = await submit(url, auth, { csrf, request: String(params), decision: 'allow' }, { cookie });
  const code = new URL(approved.headers.get('location')).searchParams.get('code');
  const exchange = { code, client_id: id, grant_type: 'authorization_code', redirect_uri: local, resource: origin + '/mcp/', code_verifier: verifier };
  const basic = { Authorization: `Basic ${Buffer.from(id + ':' + secret).toString('base64')}` };
  assert.equal((await submit(url, '/oauth/token', { ...exchange, client_id: 'other-client' }, basic)).status, 400);
  assert.equal((await submit(url, '/oauth/token', { ...exchange, redirect_uri: callback }, basic)).status, 400);
  const token = await submit(url, '/oauth/token', exchange, basic);
  assert.equal(token.status, 200);
  const creds = await token.json();
  const rpc = async (access) => fetch(url + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const names = async () => (await (await rpc(creds.access_token)).json()).result.tools.map(({ name }) => name);
  assert.ok((await names()).includes('publish_article'));
  assert.equal((await submit(url, base + '/oauth/access', { csrf, client_id: id, access: 'read' }, { cookie })).status, 303);
  assert.ok(!(await names()).includes('upload_image'));
  assert.equal((await submit(url, base + '/oauth/access', { csrf, client_id: id, writeAccess: 'on', publishAccess: 'on' }, { cookie })).status, 303);
  assert.ok((await names()).includes('create_category'));
  assert.equal((await submit(url, base + '/oauth/rotate', { csrf, client_id: id }, { cookie })).status, 303);
  assert.match(await contents(), /data-oauth-reveal/);
  assert.doesNotMatch(await contents(), /data-oauth-reveal/);
  assert.equal((await rpc(creds.access_token)).status, 401);
  assert.equal((await submit(url, '/oauth/token', { grant_type: 'refresh_token', refresh_token: creds.refresh_token, client_id: id, client_secret: secret })).status, 400);
});

test('DCR registers only exact administrator-approved callbacks', async (t) => {
  const { store, url } = await fixture(t, { mcp: true });
  const callback = 'https://connector.example/callback';
  const secondary = 'https://connector.example/alternate';
  const login = await submit(url, '/admin/login', { password: adminPassword });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(url + '/admin/system/mcp', { headers: { cookie } })).text();
  const csrf = page.match(/name="csrf" value="([^"]+)"/)[1];
  const update = (value) => submit(url, '/admin/system/mcp', { csrf, mcp: 'on', mcpDcrCallbacks: value }, { cookie });
  assert.equal((await update('https://*.example/callback\nhttp://127.0.0.1:6274/callback')).status, 422);
  assert.equal((await update(`${callback}\n${secondary}`)).status, 303);
  const metadata = await (await fetch(url + '/.well-known/oauth-authorization-server')).json();
  assert.equal(metadata.registration_endpoint, origin + '/oauth/register');
  assert.equal(metadata.client_id_metadata_document_supported, undefined);
  const register = (list) => fetch(url + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Other AI', redirect_uris: list, token_endpoint_auth_method: 'none' }) });
  assert.equal((await register([callback + '?x=other'])).status, 400);
  assert.equal((await register([callback, 'https://other.example/callback'])).status, 400);
  const accepted = await register([callback, secondary]);
  assert.equal(accepted.status, 201);
  const identity = await accepted.json();
  assert.deepEqual(identity.redirect_uris, [callback, secondary]);
  assert.equal(store.oauth.getClient(identity.client_id).writeAccess, 1);
  const auth = '/admin/oauth/authorize?' + new URLSearchParams({ client_id: identity.client_id, redirect_uri: secondary, response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' });
  assert.equal((await fetch(url + auth, { headers: { cookie } })).status, 200);
  assert.equal((await update(callback)).status, 303);
  assert.equal((await fetch(url + auth, { headers: { cookie } })).status, 400);
});

test('migration from the previous OAuth schema preserves clients and live grant hashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omini-oauth-migration-'));
  const file = join(dir, 'blog.sqlite');
  const key = 'fake-existing-stored-hash';
  try {
    let store = openBlog(file);
    store.oauth.addClient({ id: 'prior-dcr', name: 'Previous connector', redirect: 'https://chatgpt.com/connector_platform_oauth_redirect', auth: 'none', secret: '', writeAccess: true, publishAccess: true, kind: 'dcr' });
    store.oauth.putCode({ hash: key, client_id: 'prior-dcr', kind: 'code', expires: Date.now() + 60000, resource: origin + '/mcp', owner_hash: 'fixture-owner-hash', flow: 'old-flow' }, Date.now());
    store.close();
    const db = new DatabaseSync(file);
    db.exec('ALTER TABLE oauth_client DROP COLUMN redirects; PRAGMA user_version=5;');
    db.close();
    store = openBlog(file);
    try {
      assert.equal(store.oauth.getClient('prior-dcr').writeAccess, 1);
      assert.equal(store.oauth.getClient('prior-dcr').redirects, '[]');
      assert.equal(store.oauth.getGrant(key, 'code', Date.now()).client_id, 'prior-dcr');
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration removes retired OAuth clients and their grants, adds default DCR callback and respects stored restrictions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omini-mcp-unified-'));
  const file = join(dir, 'blog.sqlite');
  const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  try {
    let store = openBlog(file);
    store.oauth.addClient({ id: 'old-client-doc', name: 'Retired adapter', redirect: callback, auth: 'none', secret: '', writeAccess: true, publishAccess: true, kind: 'cimd' });
    store.oauth.addClient({ id: 'old-dcr', name: 'Existing DCR', redirect: callback, auth: 'none', secret: '', writeAccess: false, publishAccess: false, kind: 'dcr' });
    for (const id of ['old-client-doc', 'old-dcr']) store.oauth.putCode({ hash: `stored-${id}`, client_id: id, kind: 'code', expires: Date.now() + 60000, resource: origin + '/mcp', owner_hash: 'fixture', flow: id }, Date.now());
    store.setSettings({ ...store.getSettings(), mcpWrite: false, mcpPublish: false, mcpDcrCallbacks: ['https://partner.example/callback'] });
    store.close();
    const db = new DatabaseSync(file);
    db.exec("UPDATE metadata SET value=json_set(value,'$.mcpChatGPT',true,'$.mcpCimdClient','old-client-doc') WHERE key='settings'; PRAGMA user_version=6;");
    db.close();
    store = openBlog(file);
    try {
      assert.equal(store.oauth.getClient('old-client-doc'), undefined);
      assert.equal(store.oauth.getGrant('stored-old-client-doc', 'code', Date.now()), undefined);
      assert.equal(store.oauth.getClient('old-dcr').writeAccess, 0);
      assert.equal(store.oauth.getGrant('stored-old-dcr', 'code', Date.now()).client_id, 'old-dcr');
      assert.deepEqual(store.getSettings().mcpDcrCallbacks, [callback, 'https://partner.example/callback']);
      assert.equal(store.getSettings().mcpWrite, false);
      assert.equal(store.getSettings().mcpCimdClient, undefined);
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
