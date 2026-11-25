import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.mjs';
import { createBlog } from '../server/blog/routes.mjs';
import { openBlog } from '../server/blog/store.mjs';
import { checkPassword, makeKey, smtpConfig, tokenHash } from '../server/installation.mjs';

const original = 'initial-password-fixture-only';
const replacement = 'replacement-password-fixture-only';

async function listen(store, options = {}) {
  const blog = createBlog({ store, timer: false });
  const app = createApp({}, { blog, ...options });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  return {
    url: `http://127.0.0.1:${app.address().port}`,
    async close() { await new Promise((resolve) => app.close(resolve)); await blog.close(); },
  };
}
const post = (url, path, values, headers) => fetch(url + path, { method: 'POST', redirect: 'manual', body: new URLSearchParams(values), headers });
const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
const csrfFrom = async (url, cookie) => (await (await fetch(url + '/admin/system', { headers: { Cookie: cookie } })).text()).match(/name="csrf" value="([^" ]+)"/)[1];

test('host proof is required, expires, is one-use, and the rotated password persists across restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omini-owner-'));
  const path = join(dir, 'blog.sqlite');
  const store = openBlog(path, { seedContent: false });
  const first = await listen(store);
  try {
    const { url } = first;
    const code = makeKey();
    const values = { code, siteUrl: 'https://example.test', password: original, confirmation: original };
    assert.equal((await fetch(url + '/admin', { redirect: 'manual' })).headers.get('location'), '/admin/setup');
    assert.equal((await post(url, '/admin/setup', values)).status, 403);
    store.issueSetup(tokenHash(code), Date.now() - 10);
    assert.equal((await post(url, '/admin/setup', values)).status, 403);
    store.issueSetup(tokenHash(code), Date.now() + 100000);
    assert.equal((await post(url, '/admin/setup', values, { Origin: 'https://cross-site.test', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const races = await Promise.all([post(url, '/admin/setup', values), post(url, '/admin/setup', values)]);
    assert.ok(races.some(({ status }) => status === 303));
    assert.ok(races.every(({ status }) => [303, 409].includes(status)));
    assert.equal(store.verifySetup(tokenHash(code)), false);
    assert.equal(store.issueSetup(tokenHash(makeKey()), Date.now() + 1000), false);
    assert.equal((await post(url, '/admin/setup', values)).headers.get('location'), '/admin/login');
    const record = store.getOwner();
    assert.ok(record.hash && record.salt);
    assert.doesNotMatch(JSON.stringify(record), new RegExp(original));
    assert.equal(await checkPassword(original, record), true);
    const session1 = cookieOf(await post(url, '/admin/login', { password: original }));
    const session2 = cookieOf(await post(url, '/admin/login', { password: original }));
    const csrf = await csrfFrom(url, session1);
    const rotation = { csrf, current: original, password: replacement, confirmation: replacement };
    assert.equal((await post(url, '/admin/password', rotation, { Cookie: session2 })).status, 403);
    assert.equal((await post(url, '/admin/password', rotation, { Cookie: session1 })).status, 303);
    assert.equal((await fetch(url + '/admin/system', { redirect: 'manual', headers: { Cookie: session2 } })).headers.get('location'), '/admin/login');
  } finally { await first.close(); }
  const second = await listen(openBlog(path));
  try {
    assert.equal((await post(second.url, '/admin/login', { password: original })).status, 401);
    assert.equal((await post(second.url, '/admin/login', { password: replacement })).status, 303);
  } finally { await second.close(); await rm(dir, { recursive: true, force: true }); }
});

test('system settings take effect without restart and never render secret values back', async () => {
  const store = openBlog(':memory:');
  const code = makeKey();
  store.issueSetup(tokenHash(code), Date.now() + 120000);
  const delivered = [];
  const app = await listen(store, { mailSettings: () => smtpConfig(store.getSystem()), mailFactory: (smtp) => async (message) => delivered.push([smtp.auth.pass, message.to]) });
  try {
    const { url } = app;
    assert.equal((await (await fetch(url + '/api/forms')).json()).code, 'disabled');
    assert.equal((await post(url, '/admin/setup', { code, password: original, confirmation: original, siteUrl: 'https://example.test' })).status, 303);
    const cookie = cookieOf(await post(url, '/admin/login', { password: original }));
    const csrf = await csrfFrom(url, cookie);
    const smtpPassword = 'fake-smtp-password-for-test';
    const aiKey = 'fake-provider-key-only';
    const proxySecret = 'http://fixture-user:fixture-pass@proxy.example.test:3128';
    const mcpToken = makeKey();
    const params = { csrf, smtpPassword, aiKey, proxySecret, mcpToken, siteUrl: 'https://new.example.test', mailEnabled: 'on', smtpMode: 'starttls', smtpUser: 'fixture', smtpHost: 'smtp.example.test', smtpFrom: 'mail@example.test', smtpTo: 'team@example.test' };
    assert.equal((await post(url, '/admin/system', params, { Cookie: cookie })).status, 303);
    assert.equal((await (await fetch(url + '/api/forms')).json()).code, 'available');
    const sent = await fetch(url + '/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://new.example.test' }, body: JSON.stringify({ name: 'Client', email: 'client@example.test', message: 'Please send additional information.' }) });
    assert.equal(sent.status, 202);
    assert.deepEqual(delivered, [[smtpPassword, params.smtpTo]]);
    assert.equal(store.getSystem().mcpHash, tokenHash(mcpToken));
    const html = await (await fetch(url + '/admin/system', { headers: { Cookie: cookie } })).text();
    for (const secret of [smtpPassword, aiKey, proxySecret, mcpToken, tokenHash(mcpToken)]) assert.ok(!html.includes(secret));
    assert.match(await (await fetch(url + '/sitemap.xml')).text(), /https:\/\/new\.example\.test\/en\/blog/);
    assert.equal((await post(url, '/admin/system', { ...params, siteUrl: 'http://external.example.test' }, { Cookie: cookie })).status, 422);
    assert.equal(store.getSystem().siteUrl, params.siteUrl);
    assert.equal((await post(url, '/admin/system', { ...params, smtpPassword: '', aiKey: '', proxySecret: '', mcpToken: '', 'clear.aiKey': 'on' }, { Cookie: cookie })).status, 303);
    assert.equal(store.getSystem().smtpPassword, smtpPassword);
    assert.equal(store.getSystem().aiKey, '');
  } finally { await app.close(); }
});
