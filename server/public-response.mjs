import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';

function acceptsGzip(header = '') {
  const quality = new Map();
  for (const offer of header.split(',')) {
    const [coding, ...params] = offer.toLowerCase().split(';').map((part) => part.trim());
    const q = params.find((p) => /^q\s*=/.test(p))?.split('=')[1].trim() ?? '1';
    quality.set(coding, /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q) ? Number(q) : 0);
  }
  const gzipQuality = quality.get('gzip') ?? quality.get('*') ?? 0;
  return gzipQuality > 0 && gzipQuality >= (quality.get('identity') ?? 0);
}

export function allowPageSchema(res, html) {
  const blocks = [...String(html).matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)];
  if (blocks.length) {
    const hashes = blocks.map(([, json]) => `'sha256-${createHash('sha256').update(json).digest('base64')}'`);
    res.setHeader('Content-Security-Policy', `${res.getHeader('Content-Security-Policy')}; script-src 'self' ${hashes.join(' ')}`);
  }
}

export function publicResponse(req, res, status, headers, body) {
  const vary = res.getHeader('Vary');
  res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  const send = (data) => res.writeHead(status, headers).end(req.method === 'HEAD' ? undefined : data);
  if (!acceptsGzip(req.headers['accept-encoding']) || (typeof body === 'string' ? Buffer.byteLength(body) : body.length) < 512) return send(body);
  gzip(body, (error, data) => {
    if (res.destroyed) return;
    if (!error) res.setHeader('Content-Encoding', 'gzip');
    send(error ? body : data);
  });
}
