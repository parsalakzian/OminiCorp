import { adminCsrf, systemFrame } from './admin.mjs';
import { documentPage, escape } from './render.mjs';
import { authorizePath, issuerMetadata, resourceMetadata, tokenPath } from './oauth.mjs';
import { registrationPath } from './oauth-chatgpt.mjs';
import { registeredCallbacks } from './oauth-clients.mjs';

export const mcpBase = '/admin/system/mcp';
export const connectionsPath = `${mcpBase}/connections`;
export const newClientPath = `${connectionsPath}/new`;
const action = `${mcpBase}/oauth`;
const kinds = { manual: 'دستی', dcr: 'ثبت پویا · DCR', cimd: 'سند کلاینت · CIMD' };
const checked = (value) => value ? ' checked' : '';
const accessLabel = (write, publish) => write && publish ? 'خواندن، نوشتن و انتشار' : write ? 'خواندن و نوشتن' : 'فقط خواندن';
const permissionFields = (item = {}) => `<div class="mcp-switches"><label><input type="checkbox" name="writeAccess"${checked(item.writeAccess)}> <span>نوشتن و مدیریت رسانه</span></label><label><input type="checkbox" name="publishAccess"${checked(item.publishAccess)}> <span>انتشار و مدیریت محتوای عمومی (نیازمند نوشتن)</span></label></div>`;

export function mcpNavigation(active) {
  const link = (id, href, label) => `<a class="button ${id === active ? 'button-primary' : 'button-muted'}" href="${href}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="mcp-nav" aria-label="بخش‌های MCP">${link('settings', mcpBase, 'تنظیمات سرور')}${link('clients', connectionsPath, 'اتصال‌های MCP')}${link('new', newClientPath, '＋ کلاینت جدید')}</nav>`;
}

export function endpointCard(origin) {
  const rows = [['MCP URL', '/mcp'], ['Authorization URL', authorizePath], ['Token URL', tokenPath], ['Protected Resource', resourceMetadata], ['Issuer Discovery', issuerMetadata], ['Registration URL (DCR)', registrationPath]];
  return `<section class="desk-card desk-editor mcp-endpoint-card"><h2>نشانی‌های اتصال</h2><p>نوع انتقال: Streamable HTTP · Authorization Code + PKCE S256 · Scope: <bdi>mcp</bdi></p><dl class="mcp-endpoints">${rows.map(([label, path]) => `<div><dt>${label}</dt><dd><code dir="ltr">${escape(origin + path)}</code></dd></div>`).join('')}</dl><p>برای کلاینتی که OAuth ندارد، از توکن Bearer ثابت استفاده کنید. DCR فقط وقتی دست‌کم یک callback مجاز باشد یا اتصال ChatGPT فعال باشد در متادیتا اعلام می‌شود.</p><a class="read-link" href="/mcp">راهنمای اتصال ↗</a></section>`;
}

export function connectionsPage({ origin, csrf, clients, status, activeClient, notice, secret }) {
  const reveal = secret ? `<div class="desk-token" data-oauth-reveal><label class="desk-field">راز کلاینت (فقط یک بار نمایش داده می‌شود)<input readonly dir="ltr" value="${escape(secret)}" autocomplete="off"></label></div>` : '';
  const row = (item) => {
    const identity = `${adminCsrf(csrf)}<input type="hidden" name="client_id" value="${escape(item.id)}">`;
    const active = activeClient(item);
    const effectiveWrite = active && status.mcpWrite && item.writeAccess;
    return `<li class="desk-card mcp-client"><header class="mcp-client-head"><div class="mcp-client-name"><span class="mcp-client-mark" aria-hidden="true">↗</span><div><h2>${escape(item.name)}</h2><bdi class="mcp-client-id">${escape(item.id)}</bdi></div></div><div class="mcp-tags"><span class="desk-pill">${kinds[item.kind]}</span><span class="desk-pill${active ? ' published' : ''}">${active ? 'مجاز' : 'متوقف'}</span></div></header>
    <dl class="mcp-client-info"><div><dt>دسترسی مؤثر</dt><dd>${active ? accessLabel(effectiveWrite, status.mcpPublish && item.publishAccess) : 'بدون دسترسی'}</dd></div><div><dt>روش احراز</dt><dd><bdi>${escape(item.auth)}</bdi></dd></div></dl>
    <details class="mcp-disclosure"><summary>تنظیم مجوزها و نشانی‌ها</summary><div class="mcp-disclosure-body"><p>نشانی‌های بازگشت</p><ul class="mcp-callbacks">${registeredCallbacks(item).map((value) => `<li><code dir="ltr">${escape(value)}</code></li>`).join('')}</ul>
      <form method="post" action="${action}/access" class="desk-editor">${identity}${permissionFields(item)}<p>مجوزها روی اتصال موجود اعمال می‌شوند و از دسترسی سراسری سرور بالاتر نمی‌روند.</p><button class="button button-primary button-small" type="submit">ذخیرهٔ مجوزهای کلاینت</button></form></div></details>
    <details class="mcp-disclosure mcp-danger"><summary>لغو دسترسی${item.kind === 'manual' && item.auth !== 'none' ? ' یا چرخش راز' : ''}</summary><div class="mcp-disclosure-body"><p>لغو، کلاینت و همهٔ توکن‌های آن را حذف می‌کند. چرخش راز نیز توکن‌های همین کلاینت را نامعتبر می‌کند.</p><div class="mcp-actions">${item.kind === 'manual' && item.auth !== 'none' ? `<form method="post" action="${action}/rotate">${identity}<button class="button button-outline button-small" type="submit">چرخش راز کلاینت</button></form>` : ''}<form method="post" action="${action}/remove">${identity}<button class="button button-muted button-small desk-danger" type="submit">لغو کلاینت</button></form></div></div></details></li>`;
  };
  return systemFrame({ origin, csrf, active: 'mcp', title: 'اتصال‌های MCP', intro: 'کلاینت‌های ثبت‌شده و دسترسی مؤثر هر اتصال را مدیریت کنید.', notice }, `${mcpNavigation('clients')}${reveal}<div class="mcp-list-head"><p>${new Intl.NumberFormat('fa').format(clients.length)} کلاینت OAuth ثبت‌شده</p><a class="read-link" href="${mcpBase}">مدیریت توکن ثابت ↗</a></div>${clients.length ? `<ul class="mcp-client-list">${clients.map(row).join('')}</ul>` : `<section class="desk-card mcp-empty"><h2>هنوز کلاینت OAuth ثبت نشده</h2><p>برای ثبت اولین اتصال، کلاینت جدید بسازید.</p><a class="button button-primary" href="${newClientPath}">ثبت کلاینت جدید</a></section>`}`);
}

export function newClientPage({ origin, csrf, error, data }) {
  const value = (key) => escape(data?.get(key) || '');
  const option = (auth, label) => `<option value="${auth}"${data?.get('auth') === auth ? ' selected' : ''}>${label}</option>`;
  return systemFrame({ origin, csrf, active: 'mcp', title: 'کلاینت جدید MCP', intro: 'ثبت دستی OAuth برای اتصال یک سرویس یا ابزار خارجی.', error }, `${mcpNavigation('new')}<div class="mcp-new-layout"><section class="desk-card desk-editor"><h2>مشخصات کلاینت</h2>
  <form method="post" action="${action}" class="desk-editor">${adminCsrf(csrf)}
  <label class="desk-field">نام نمایشی کلاینت<input name="name" required maxlength="100" value="${value('name')}" placeholder="Gemini CLI"></label>
  <label class="desk-field">شناسهٔ کلاینت (Client ID)<input name="client_id" required minlength="3" maxlength="100" dir="ltr" value="${value('client_id')}" placeholder="gemini-cli"></label>
  <label class="desk-field">نشانی بازگشت (Redirect URI)<textarea name="redirect_uri" rows="3" maxlength="12020" dir="ltr" required placeholder="https://client.example/oauth/callback">${value('redirect_uri')}</textarea><small>هر نشانی در یک خط؛ حداکثر ۱۰ نشانی دقیق HTTPS یا loopback محلی.</small></label>
  <label class="desk-field">روش احراز در Token Endpoint<select name="auth" dir="ltr">${option('none','Public client (PKCE)')}${option('client_secret_basic','Confidential · client_secret_basic')}${option('client_secret_post','Confidential · client_secret_post')}</select></label>
  <label class="desk-field">راز کلاینت (اختیاری)<input type="password" name="client_secret" autocomplete="new-password" dir="ltr" minlength="16" maxlength="256"><small>فقط برای کلاینت محرمانه. اگر خالی بماند، راز تصادفی ساخته و یک بار نمایش داده می‌شود.</small></label>
  <fieldset class="mcp-permission-box"><legend>مجوزهای اولیه</legend>${permissionFields({ writeAccess: data?.get('writeAccess') === 'on', publishAccess: data?.get('publishAccess') === 'on' })}</fieldset>
  <div class="mcp-actions"><button class="button button-primary" type="submit">ثبت کلاینت OAuth</button><a class="button button-muted" href="${connectionsPath}">بازگشت به فهرست</a></div></form></section>${endpointCard(origin)}</div>`);
}

export function consentPage(origin, csrf, client, request) {
  return documentPage({ lang: 'fa', origin, title: 'اجازهٔ اتصال OAuth | اومینی‌کورپ', noindex: true, body: `<main class="desk-login"><section class="desk-card"><h1>اجازهٔ اتصال به MCP</h1><p>کلاینت <bdi><strong>${escape(client.name)}</strong> (${escape(client.id)})</bdi> می‌خواهد به MCP وصل شود.</p><p>دسترسی: ${client.publishAccess ? 'خواندن، نوشتن و انتشار' : client.writeAccess ? 'خواندن و نوشتن' : 'فقط خواندن'}، محدود به تنظیمات فعلی MCP.</p><p class="desk-endpoint" dir="ltr"><code>${escape(client.redirect)}</code></p><form method="post" action="${authorizePath}">${adminCsrf(csrf)}<input type="hidden" name="request" value="${escape(request)}"><button class="button button-primary" type="submit" name="decision" value="allow">اجازه اتصال</button><button class="button button-muted" type="submit" name="decision" value="deny">رد اتصال</button></form></section></main>` });
}
