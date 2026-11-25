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

function readField(params, key, size = 255, trim = true) {
  const raw = params.get(key) || '';
  const value = trim ? raw.trim() : raw;
  if (value.length > size || /[\r\n\0]/.test(value)) throw new Error('Invalid settings field');
  return value;
}

function secretField(params, previous, key, size) {
  if (params.has(`clear.${key}`)) return '';
  return readField(params, key, size, key !== 'smtpPassword') || previous[key] || '';
}

export function updateAiSecrets(params, previous) {
  const proxySecret = secretField(params, previous, 'proxySecret', 600);
  if (proxySecret) {
    const url = new URL(proxySecret);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid proxy URL');
  }
  return { ...previous, aiKey: secretField(params, previous, 'aiKey', 512), proxySecret };
}

export function updateSystem(params, previous) {
  const read = (key, size) => readField(params, key, size);
  const value = {
    ...previous,
    siteUrl: parseOrigin(read('siteUrl', 500)), mailEnabled: params.has('mailEnabled'), smtpHost: read('smtpHost'), smtpPort: read('smtpPort', 5),
    smtpMode: read('smtpMode', 10), smtpFrom: read('smtpFrom'), smtpTo: read('smtpTo'), smtpUser: read('smtpUser'),
    smtpPassword: secretField(params, previous, 'smtpPassword', 512),
  };
  if (!['starttls', 'tls', 'none'].includes(value.smtpMode) || (value.smtpPort && (!/^\d+$/.test(value.smtpPort) || +value.smtpPort < 1 || +value.smtpPort > 65535))) {
    throw new Error('Invalid SMTP port or security');
  }
  if (value.mailEnabled && !value.smtpHost) throw new Error('Missing SMTP host');
  smtpConfig(value);
  return value;
}
