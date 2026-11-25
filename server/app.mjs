import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createForms } from './forms.mjs';

const mime = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  webp: 'image/webp', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8',
};
const assets = /^\/assets\/(?:[\w-]+\/)*[\w-]+\.(?:css|mjs|webp|woff2|txt)$/;

export function createApp(config, { store, send, blog, mailSettings, mailFactory } = {}) {
  let forms = createForms(config, store, send);
  let applied = '';
  function getForms() {
    if (!mailSettings) return forms;
    const next = mailSettings();
    const key = JSON.stringify([next.origin, next.smtp]);
    if (key !== applied) {
      forms = createForms(next, store, next.smtp ? mailFactory(next.smtp) : undefined);
      applied = key;
    }
    return forms;
  }
  return createServer({ requestTimeout: 20000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'");
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return res.writeHead(400).end();
      const url = new URL(req.url, 'http://localhost');
      if (blog && await blog.route(req, res, url) !== false) return;
      if (url.pathname.startsWith('/api/') || ['/opt-in', '/opt-out'].includes(url.pathname)) return await getForms()(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      if (url.pathname === '/healthz') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n');
      const file = url.pathname === '/' ? '/index.html' : url.pathname;
      if (!['/index.html', '/en.html'].includes(file) && !assets.test(file)) return res.writeHead(404).end();
      const data = await readFile(new URL(`..${file}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': mime[file.split('.').at(-1)], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end();
    }
  });
}
