import { constantEqual, tokenHash } from '../installation.mjs';
import { handleMcp } from './mcp.mjs';
import { documentPage, escape } from './render.mjs';

const methods = 'POST, OPTIONS';
const corsHeaders = ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'];
const allowedHeaders = new Set(corsHeaders.map((name) => name.toLowerCase()));
const jsonError = (res, status, error) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error }));

function guide(origin) {
  const endpoint = escape(`${origin}/mcp`);
  return documentPage({ lang: 'fa', origin, title: 'راهنمای اتصال MCP | اومینی‌کورپ', noindex: true, body: `<main class="desk-login"><section class="desk-card"><p class="journal-kicker" dir="ltr">OMINI / CONNECTION GUIDE</p><h1>راهنمای اتصال MCP</h1><p>بازکردن این نشانی در مرورگر، اتصال یا اعتبار توکن را بررسی نمی‌کند. اتصال را در کلاینت MCP انجام دهید.</p><dl><dt>نشانی سرور</dt><dd class="desk-endpoint" dir="ltr"><code>${endpoint}</code></dd><dt>نوع اتصال</dt><dd dir="ltr">Streamable HTTP</dd><dt>احراز هویت</dt><dd class="desk-endpoint" dir="ltr"><code>Authorization: Bearer &lt;token&gt;</code></dd></dl><p>توکن را در نشانی وارد نکنید. کلاینت باید بتواند هدر احراز هویت سفارشی بفرستد.</p><a class="read-link" href="/admin/system/mcp">تنظیمات و راهنمای مدیر ↗</a></section></main>` });
}

export function createMcpHttp({ store, automation, read }) {
  let count = 0, windowEnd = 0;
  return async function mcp(req, res) {
    const settings = store.getSettings();
    const { mcpHash, siteUrl } = store.getSystem();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Vary', 'Accept, Origin');
    // The human-facing help contains no tools, secrets, or installation status.
    if (['GET', 'HEAD'].includes(req.method) && req.headers.accept?.split(',').some((type) => type.trim().split(';')[0] === 'text/html')) {
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
      return jsonError(res, 405, 'Use Streamable HTTP POST. A standalone or legacy SSE stream is not provided.');
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return jsonError(res, 415, 'Send Content-Type: application/json.');
    const now = Date.now();
    if (now >= windowEnd) { windowEnd = now + 60000; count = 0; }
    if (++count > 120) { res.setHeader('Retry-After', '60'); return jsonError(res, 429, 'Too many MCP requests.'); }
    const raw = await read(req, 600000);
    if (raw === null) return jsonError(res, 413, 'MCP request is too large.');
    let body;
    try { body = JSON.parse(raw); } catch { return jsonError(res, 400, 'Invalid JSON request.'); }
    await handleMcp(req, res, body, { store, automation });
  };
}
