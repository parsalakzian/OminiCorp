import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { passwordRecord, tokenHash } from '../server/installation.mjs';
import { createApp } from '../server/app.mjs';
import { createAutomation, parseFeed } from '../server/blog/automation.mjs';
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

async function fixture(t, settings = {}) {
  const store = openBlog(':memory:');
  store.setSettings({ ...defaults, ...settings });
  store.setSystem({ siteUrl: origin, mcpHash: tokenHash(mcpKey) });
  store.setOwner(await passwordRecord(adminPassword));
  const blog = createBlog({ store, timer: false });
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
    const n = snippet.url.at(-1);
    modelCalls++;
    const value = clone();
    value.en.slug += '-' + n; value.fa.slug += '-' + n;
    value.en.title += ' ' + n; value.fa.title += ' ' + n;
    return Response.json({ choices: [{ message: { content: invalid ? '{}' : JSON.stringify(value) } }] });
  };
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
  const { store, url } = await fixture(t, { mcp: true });
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { Origin: 'https://attacker.test', Authorization: `Bearer ${mcpKey}` } })).status, 403);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpKey}` } } }));
  try {
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), ['list_articles', 'get_article']);
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
  const unsupportedSse = await fetch(endpoint, { headers: { ...auth, Accept: 'text/event-stream' } });
  assert.equal(unsupportedSse.status, 405);
  const client = new Client({ name: 'inspector-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: auth } }));
  try { assert.ok((await client.listTools()).tools.some(({ name }) => name === 'list_articles')); }
  finally { await client.close(); }
  store.setSettings({ ...store.getSettings(), mcp: false });
  assert.equal((await fetch(endpoint, { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: auth })).status, 404);
});
