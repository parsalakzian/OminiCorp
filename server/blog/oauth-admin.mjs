import { adminCsrf } from './admin.mjs';
import { documentPage, escape } from './render.mjs';
import { authorizePath, issuerMetadata } from './oauth.mjs';

export function oauthPanel(origin, csrf, clients, reveal) {
  const action = '/admin/system/mcp/oauth';
  return `<section class="desk-card desk-editor"><h2>کلاینت‌های OAuth</h2><p>کلاینت را با شناسه و نشانی بازگشت دقیقش ثبت کنید. OAuth در کنار توکن ثابت کار می‌کند و به رضایت مدیر و PKCE نیاز دارد.</p>
  <p dir="ltr" class="desk-endpoint"><a href="${issuerMetadata}"><code>${escape(origin + issuerMetadata)}</code></a></p>
  ${reveal ? `<div class="desk-token" data-oauth-reveal><label class="desk-field">راز کلاینت (فقط یک بار نمایش داده می‌شود)<input readonly dir="ltr" value="${escape(reveal)}" autocomplete="off"></label></div>` : ''}
  ${clients.length ? `<ul>${clients.map((client) => `<li><strong>${escape(client.name)}</strong> · <bdi>${escape(client.id)}</bdi><p dir="ltr" class="desk-endpoint"><code>${escape(client.redirect)}</code></p><p>${client.publishAccess ? 'نوشتن و انتشار' : client.writeAccess ? 'خواندن و نوشتن' : 'فقط خواندن'} · <bdi>${escape(client.auth)}</bdi></p>${client.kind === 'dcr' ? `<form method="post" action="${action}/access" class="desk-editor">${adminCsrf(csrf)}<input type="hidden" name="client_id" value="${escape(client.id)}"><label><input type="checkbox" name="writeAccess"${client.writeAccess ? ' checked' : ''}> اجازهٔ نوشتن برای این کلاینت DCR</label><label><input type="checkbox" name="publishAccess"${client.publishAccess ? ' checked' : ''}> اجازهٔ انتشار برای این کلاینت DCR</label><p>برای دسترسی کامل هر دو گزینه و مجوزهای سراسری نوشتن و انتشار MCP را فعال کنید. این کلاینت می‌تواند مقاله و رسانه را تغییر دهد یا حذف کند.</p><button class="button button-outline" type="submit">ذخیرهٔ مجوزهای کلاینت</button></form>` : ''}<form method="post" action="${action}/remove">${adminCsrf(csrf)}<input type="hidden" name="client_id" value="${escape(client.id)}"><button class="button button-muted" type="submit">لغو کلاینت و تمام توکن‌های آن</button></form></li>`).join('')}</ul>` : '<p>هنوز کلاینتی ثبت نشده است.</p>'}
  <form method="post" action="${action}" class="desk-editor">${adminCsrf(csrf)}
  <label class="desk-field">نام نمایشی کلاینت<input name="name" required maxlength="100"></label>
  <label class="desk-field">شناسهٔ کلاینت (Client ID)<input name="client_id" required minlength="3" maxlength="100" dir="ltr"></label>
  <label class="desk-field">نشانی بازگشت (Redirect URI)<input type="url" name="redirect_uri" required maxlength="1200" dir="ltr"></label>
  <label class="desk-field">روش احراز در Token Endpoint<select name="auth" dir="ltr"><option value="none">Public client (PKCE)</option><option value="client_secret_basic">client_secret_basic</option><option value="client_secret_post">client_secret_post</option></select></label>
  <label><input type="checkbox" name="writeAccess"> اجازهٔ نوشتن در صورت فعال‌بودن در MCP</label>
  <label><input type="checkbox" name="publishAccess"> اجازهٔ انتشار در صورت مجازبودن نوشتن و انتشار در MCP</label>
  <button class="button button-outline" type="submit">ثبت کلاینت OAuth</button></form></section>`;
}

export function consentPage(origin, csrf, client, request) {
  return documentPage({ lang: 'fa', origin, title: 'اجازهٔ اتصال OAuth | اومینی‌کورپ', noindex: true, body: `<main class="desk-login"><section class="desk-card"><h1>اجازهٔ اتصال به MCP</h1><p>کلاینت <bdi><strong>${escape(client.name)}</strong> (${escape(client.id)})</bdi> می‌خواهد به MCP وصل شود.</p><p>دسترسی: ${client.publishAccess ? 'خواندن، نوشتن و انتشار' : client.writeAccess ? 'خواندن و نوشتن' : 'فقط خواندن'}، محدود به تنظیمات فعلی MCP.</p><p class="desk-endpoint" dir="ltr"><code>${escape(client.redirect)}</code></p><form method="post" action="${authorizePath}">${adminCsrf(csrf)}<input type="hidden" name="request" value="${escape(request)}"><button class="button button-primary" type="submit" name="decision" value="allow">اجازه اتصال</button><button class="button button-muted" type="submit" name="decision" value="deny">رد اتصال</button></form></section></main>` });
}
