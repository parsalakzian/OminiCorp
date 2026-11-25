import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readConfig } from './config.mjs';

const derive = promisify(scrypt);
export const defaultOrigin = 'https://ominicorp.com';
export const digest = (value) => createHash('sha256').update(value).digest();
export const constantEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(digest(a), digest(b));
export const makeKey = () => randomBytes(32).toString('base64url');
export const tokenHash = (value) => digest(value).toString('hex');
export const validPassword = (value) => typeof value === 'string' && value.length >= 16 && value.length <= 256;
export const defaultSystem = { siteUrl: defaultOrigin, mailEnabled: false, smtpHost: '', smtpPort: '', smtpMode: 'starttls', smtpFrom: '', smtpTo: '', smtpUser: '' };

export async function passwordRecord(value) {
  if (!validPassword(value)) throw new Error('Invalid admin password');
  const salt = randomBytes(24).toString('hex');
  const hash = (await derive(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 48 * 1024 ** 2 })).toString('hex');
  return { salt, hash };
}
export async function checkPassword(value, record) {
  if (!record || !validPassword(value)) return false;
  const key = await derive(value, record.salt, 64, { N: 32768, r: 8, p: 1, maxmem: 48 * 1024 ** 2 });
  return timingSafeEqual(key, Buffer.from(record.hash, 'hex'));
}

export function parseOrigin(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) throw new Error('نشانی عمومی باید مبدأ HTTPS باشد (HTTP فقط برای localhost).');
  return url.origin;
}

export function smtpConfig(system) {
  if (!system.mailEnabled) return { smtp: null };
  return readConfig({ PUBLIC_SITE_URL: system.siteUrl, SMTP_HOST: system.smtpHost, SMTP_PORT: system.smtpPort, SMTP_SECURITY: system.smtpMode,
    SMTP_USER: system.smtpUser, SMTP_PASS: system.smtpPassword, SMTP_FROM: system.smtpFrom, SMTP_TO: system.smtpTo });
}

export function updateSystem(params, previous) {
  const read = (key, size = 255) => {
    const value = (params.get(key) || '').trim();
    if (value.length > size || /[\r\n\0]/.test(value)) throw new Error('طول یا قالب یکی از تنظیمات معتبر نیست.');
    return value;
  };
  const secret = (key, size) => {
    if (params.has(`clear.${key}`)) return '';
    const value = key === 'smtpPassword' ? params.get(key) || '' : read(key, size);
    if (value.length > size || /[\r\n\0]/.test(value)) throw new Error('Invalid secret value');
    return value || previous[key] || '';
  };
  const mcpToken = read('mcpToken', 256);
  if (mcpToken && !/^[A-Za-z\d._~-]{32,256}$/.test(mcpToken)) throw new Error('توکن MCP باید دست‌کم ۳۲ کاراکتر و بدون فاصله باشد.');
  const proxy = secret('proxySecret', 600);
  if (proxy) {
    const url = new URL(proxy);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error('آدرس پراکسی باید HTTP یا HTTPS باشد و مسیر یا query نداشته باشد.');
  }
  const value = {
    siteUrl: parseOrigin(read('siteUrl', 500)), mailEnabled: params.has('mailEnabled'), smtpHost: read('smtpHost'), smtpPort: read('smtpPort', 5),
    smtpMode: read('smtpMode', 10), smtpFrom: read('smtpFrom'), smtpTo: read('smtpTo'), smtpUser: read('smtpUser'),
    smtpPassword: secret('smtpPassword', 512), aiKey: secret('aiKey', 512), proxySecret: proxy,
    mcpHash: params.has('clear.mcpToken') ? '' : mcpToken ? tokenHash(mcpToken) : previous.mcpHash || '',
  };
  if (!['starttls', 'tls', 'none'].includes(value.smtpMode) || (value.smtpPort && (!/^\d+$/.test(value.smtpPort) || +value.smtpPort < 1 || +value.smtpPort > 65535))) {
    throw new Error('پورت یا نوع امنیت SMTP معتبر نیست.');
  }
  if (value.mailEnabled && !value.smtpHost) throw new Error('برای فعال‌کردن فرم‌ها نشانی سرور SMTP لازم است.');
  try { smtpConfig(value); } catch { throw new Error('تنظیمات SMTP (ایمیل‌ها، احراز هویت، پورت و TLS) را بررسی کنید.'); }
  return value;
}
