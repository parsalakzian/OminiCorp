import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const mime = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  webp: 'image/webp', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8',
};
const assets = /^\/assets\/(?:[\w-]+\/)*[\w-]+\.(?:css|mjs|webp|woff2|txt)$/;
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405, { Allow: 'GET, HEAD' }).end();
  const path = request.url.split('?')[0];
  const file = path === '/' ? '/index.html' : path;
  if (!['/index.html', '/en.html'].includes(file) && !assets.test(file)) return response.writeHead(404).end();
  try {
    const data = await readFile(new URL(`..${file}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': mime[file.split('.').at(-1)], 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (error.code === 'ENOENT') return response.writeHead(404).end();
    console.error('Could not read a site asset:', error.code);
    response.writeHead(500).end();
  }
}).listen(port, '0.0.0.0', () => console.log(`OminiCorp preview listening on port ${port}`));
