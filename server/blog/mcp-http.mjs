import { constantEqual, tokenHash } from '../installation.mjs';
import { imageContentTypes, maxImageBytes, maxImageInput, maxImageMiB, MediaError } from './media.mjs';
import { handleMcp } from './mcp.mjs';
import { documentPage, escape } from './render.mjs';

const methods = 'POST, OPTIONS';
const corsHeaders = ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'];
const allowedHeaders = new Set(corsHeaders.map((name) => name.toLowerCase()));
const jsonError = (res, status, error) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error }));

function responseType(accept = '') {
  const qualities = new Map();
  for (const value of accept.split(',')) {
    const [media, ...params] = value.trim().split(';');
    const type = media.trim().toLowerCase();
    if (type !== 'application/json' && type !== 'text/event-stream') continue;
    const quality = params.map((param) => param.trim()).find((param) => /^q\s*=/i.test(param));
    const weight = quality ? Number(quality.slice(quality.indexOf('=') + 1)) : 1;
    if (Number.isFinite(weight) && weight >= 0 && weight <= 1) qualities.set(type, Math.max(qualities.get(type) || 0, weight));
  }
  const json = qualities.get('application/json');
  const stream = qualities.get('text/event-stream');
  // Streamable HTTP clients advertise both; choose SSE on equal preference.
  if (!json || !stream) return undefined;
  return json > stream ? 'json' : 'sse';
}

const rpcError = (res, status, code, message) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  .end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));

function guide(origin) {
  const endpoint = escape(`${origin}/mcp`);
  return documentPage({ lang: 'fa', origin, title: 'راهنمای اتصال MCP | اومینی‌کورپ', noindex: true, body: `<main class="desk-login"><section class="desk-card"><p class="journal-kicker" dir="ltr">OMINI / CONNECTION GUIDE</p><h1>راهنمای اتصال MCP</h1><p>بازکردن این نشانی در مرورگر، اتصال یا اعتبار توکن را بررسی نمی‌کند. اتصال را در کلاینت MCP انجام دهید.</p><dl><dt>نشانی سرور</dt><dd class="desk-endpoint" dir="ltr"><code>${endpoint}</code></dd><dt>نوع اتصال</dt><dd dir="ltr">Streamable HTTP</dd><dt>پروتکل پیام</dt><dd dir="ltr">JSON-RPC 2.0 · SSE / JSON</dd><dt>احراز هویت</dt><dd class="desk-endpoint" dir="ltr"><code>Authorization: Bearer &lt;token&gt;</code></dd></dl><p>توکن را در نشانی وارد نکنید. کلاینت باید بتواند هدر احراز هویت سفارشی بفرستد.</p><p>برای تصویر از ابزار <code>upload_image</code> با لینک HTTPS یا مسیر باینری <code>POST /mcp/media</code> با همان توکن و مجوز نوشتن استفاده کنید.</p><a class="read-link" href="/admin/system/mcp">تنظیمات و راهنمای مدیر ↗</a></section></main>` });
}

export function createMcpHttp({ store, automation, readBytes, importImage }) {
  let count = 0, windowEnd = 0, activeWrites = 0;
  return async function mcp(req, res, binary = false) {
    const settings = store.getSettings();
    const { mcpHash, siteUrl } = store.getSystem();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Vary', 'Accept, Origin');
    // The human-facing help contains no tools, secrets, or installation status.
    if (!binary && ['GET', 'HEAD'].includes(req.method) && req.headers.accept?.split(',').some((type) => type.trim().split(';')[0] === 'text/html')) {
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : guide(siteUrl));
    }
    const origin = req.headers.origin;
    if (origin && origin !== siteUrl && !settings.mcpOrigins.includes(origin)) return jsonError(res, 403, 'Origin is not allowed. Configure this exact origin in MCP settings.');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', methods);
      if (origin) {
        res.setHeader('Vary', 'Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
        const requested = (req.headers['access-control-request-headers'] || '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
        if (req.headers['access-control-request-method'] !== 'POST' || requested.some((name) => !allowedHeaders.has(name))) return jsonError(res, 403, 'Unsupported MCP preflight.');
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', corsHeaders.join(', '));
      }
      return res.writeHead(204).end();
    }
    if (!settings.mcp || !mcpHash) return jsonError(res, 404, 'MCP is disabled or has no configured token.');
    const bearer = req.headers.authorization?.match(/^Bearer[ \t]+([A-Za-z\d._~-]{32,256})$/i)?.[1];
    if (!bearer || !constantEqual(tokenHash(bearer), mcpHash)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="OminiCorp Journal"');
      return jsonError(res, 401, bearer ? 'The Bearer token is invalid or was rotated.' : 'Send Authorization: Bearer <token>. If it was sent, check that your reverse proxy forwards it.');
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', methods);
      return jsonError(res, 405, binary ? 'Use POST with the raw file as the body.' : 'Use Streamable HTTP POST on /mcp. SSE is returned on POST; legacy and standalone GET streams are not provided.');
    }
    const stillAuthenticated = () => store.getSettings().mcp && constantEqual(tokenHash(bearer), store.getSystem().mcpHash);
    const canWrite = () => stillAuthenticated() && store.getSettings().mcpWrite;
    if (binary && !settings.mcpWrite) return jsonError(res, 403, 'Enable MCP write access in Site Settings to upload media.');
    const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (binary ? !imageContentTypes.includes(type) : type !== 'application/json') {
      return jsonError(res, 415, binary ? 'Send a raw PNG, JPEG or WebP file, with its image content type or application/octet-stream. Do not use multipart.' : 'Send Content-Type: application/json.');
    }
    const mode = binary ? undefined : responseType(req.headers.accept);
    if (!binary && !mode) return rpcError(res, 406, -32000, 'Send Accept: application/json, text/event-stream.');
    const now = Date.now();
    if (now >= windowEnd) { windowEnd = now + 60000; count = 0; }
    if (++count > 120 || (settings.mcpWrite && activeWrites >= 3)) {
      res.setHeader('Retry-After', count > 120 ? '60' : '2');
      return jsonError(res, 429, 'Too many MCP requests. Retry shortly.');
    }
    if (settings.mcpWrite) activeWrites++;
    const client = new AbortController();
    const onClose = () => client.abort();
    res.once('close', onClose);
    try {
      const limit = binary ? maxImageBytes : settings.mcpWrite ? maxImageInput + 64 * 1024 : 600000;
      const raw = await readBytes(req, limit);
      if (raw === null) return jsonError(res, 413, binary ? `Image exceeds ${maxImageMiB} MiB.` : 'MCP request too large. For images, use a public HTTPS url or send the raw file to POST /mcp/media.');
      if (!stillAuthenticated()) return jsonError(res, 401, 'MCP authorization changed while receiving the request.');
      if (binary) {
        if (!canWrite()) return jsonError(res, 403, 'MCP write access is disabled.');
        try {
          const image = store.uploadImage(raw, type === 'application/octet-stream' ? undefined : type);
          return res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ image }));
        } catch (error) {
          if (!(error instanceof MediaError)) throw error;
          return jsonError(res, 422, error.message);
        }
      }
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch { return rpcError(res, 400, -32700, 'Parse error: Invalid JSON'); }
      await handleMcp(req, res, body, { store, automation, importImage, canWrite, signal: client.signal, mode });
    } finally {
      res.off('close', onClose);
      if (settings.mcpWrite) activeWrites--;
    }
  };
}
