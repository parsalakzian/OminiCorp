import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import smtpServer from 'smtp-server';
import { createApp } from '../server/app.mjs';
import { readConfig } from '../server/config.mjs';
import { createMailer } from '../server/mail.mjs';
import { openSubscribers } from '../server/subscribers.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

function post(url, path, data, headers = {}) {
  return fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
}

test('SMTP is optional; TLS and secrets are checked before startup', () => {
  assert.equal(readConfig({}).smtp, null);
  assert.throws(() => readConfig({ SMTP_HOST: 'relay.test' }), /requires/);
  const env = { SMTP_HOST: 'relay.test', SMTP_FROM: 'mail@example.org', SMTP_TO: 'team@example.org', PUBLIC_SITE_URL: 'https://example.org' };
  assert.equal(readConfig(env).smtp.mode, 'starttls');
  assert.equal(readConfig({ ...env, SMTP_SECURITY: 'tls' }).smtp.port, 465);
  assert.throws(() => readConfig({ ...env, SMTP_SECURITY: 'none' }), /loopback/);
  assert.throws(() => readConfig({ ...env, SMTP_USER: 'name' }), /both/);
  assert.throws(() => readConfig({ ...env, PUBLIC_SITE_URL: 'http://example.org' }), /HTTPS/);
});

test('SMTP disabled still serves the site and does not serve source or configuration', async (t) => {
  const app = createApp(readConfig({}));
  const url = await listen(app);
  t.after(() => app.close());
  const status = await fetch(`${url}/api/forms`);
  assert.deepEqual(await status.json(), { code: 'disabled' });
  assert.equal((await post(url, '/api/request', {})).status, 503);
  for (const path of ['/smtp.env', '/.git/config', '/data/subscribers.sqlite', '/server/app.mjs', '/omixy', '/assets/%2e%2e/package.json']) {
    assert.equal((await fetch(`${url}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${url}/?tv=1`)).status, 200);
});

test('real SMTP handoff, double opt-in, unsubscribe, and failure paths', async (t) => {
  const messages = [];
  let failDelivery = false;
  const relay = new smtpServer.SMTPServer({
    authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, session, done) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        if (failDelivery) return done(new Error('Temporary test failure'));
        messages.push({ to: session.envelope.rcptTo[0].address, text: Buffer.concat(chunks).toString().replace(/=\r\n/g, '').replace(/=3D/g, '=') });
        done();
      });
    },
  });
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  t.after(() => relay.close());
  const store = openSubscribers(':memory:');
  t.after(() => store.close());
  const config = readConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: relay.server.address().port, SMTP_SECURITY: 'none', SMTP_FROM: 'site@example.org', SMTP_TO: 'team@example.org', PUBLIC_SITE_URL: 'https://site.example.org' });
  const app = createApp(config, { store, send: createMailer(config.smtp) });
  const url = await listen(app);
  t.after(() => app.close());
  const request = { name: 'Test client', email: 'client@example.org', message: 'A complete project brief.' };
  assert.equal((await post(url, '/api/request', request, { Origin: 'https://cross.example.org' })).status, 403);
  assert.equal((await post(url, '/api/request', { ...request, message: 'x'.repeat(17000) })).status, 413);
  assert.equal((await post(url, '/api/request', { ...request, message: 'short' })).status, 400);
  assert.equal((await post(url, '/api/request', request)).status, 202);
  assert.equal(messages[0].to, 'team@example.org');
  assert.match(messages[0].text, /Reply-To: client@example\.org/i);
  assert.match(messages[0].text, /A complete project brief/);
  const signup = { email: 'Reader@example.org', consent: true, lang: 'en' };
  assert.equal((await post(url, '/api/subscribe', { ...signup, consent: false })).status, 400);
  failDelivery = true;
  assert.equal((await post(url, '/api/subscribe', signup)).status, 503);
  assert.deepEqual(store.list(), []);
  failDelivery = false;
  assert.equal((await post(url, '/api/subscribe', signup)).status, 202);
  assert.equal(messages[1].to, 'reader@example.org');
  assert.equal((await post(url, '/api/subscribe', signup)).status, 202);
  assert.equal(messages.length, 2, 'pending subscriptions are throttled');

  async function link(path) {
    const value = messages[1].text.match(new RegExp(`/${path}\\?lang=en&token=([A-Za-z0-9_-]{43})`))[1];
    const endpoint = `${url}/${path}?lang=en`;
    assert.equal((await fetch(`${endpoint}&token=${value}`)).status, 200);
    return () => fetch(endpoint, { method: 'POST', body: new URLSearchParams({ token: value }) });
  }
  const confirm = await link('opt-in');
  assert.deepEqual(store.list(), [], 'link previews do not change subscription state');
  assert.equal((await confirm()).status, 200);
  assert.equal((await confirm()).status, 400);
  assert.deepEqual(store.list(), ['reader@example.org']);
  const unsubscribe = await link('opt-out');
  assert.deepEqual(store.list(), ['reader@example.org']);
  assert.equal((await unsubscribe()).status, 200);
  assert.deepEqual(store.list(), []);
});

test('subscriber store persists confirmed rows and rejects expired tokens', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'omini-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.sqlite');
  let store = openSubscribers(file);
  const now = Date.now();
  const old = store.reserve('old@example.org', now - 3 * 24 * 60 * 60 * 1000);
  assert.equal(store.confirm(old.confirmToken, now), false);
  const active = store.reserve('active@example.org', now);
  assert.equal(store.confirm(active.confirmToken, now), true);
  store.close();
  store = openSubscribers(file);
  assert.deepEqual(store.list(), ['active@example.org']);
  assert.equal(store.remove(active.optOutToken), true);
  store.close();
});
