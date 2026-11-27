import { makeKey, parseOrigin, tokenHash } from '../installation.mjs';

export const clientIdPattern = /^[A-Za-z0-9._~-]{3,100}$/;
export const authMethods = ['none', 'client_secret_basic', 'client_secret_post'];
export const confidentialMethods = authMethods.slice(1);

export function validateCallback(uri) {
  if (!/^https?:\/\//.test(uri || '') || uri.length > 1200 || /[\s\\#]/.test(uri)) throw new Error('Invalid redirect URI');
  const parsed = new URL(uri);
  if (parsed.username || parsed.password || parsed.hostname.includes('*') || !['https:', 'http:'].includes(parsed.protocol) || parseOrigin(parsed.origin) !== parsed.origin ||
    ['code', 'state', 'error', 'iss'].some((key) => parsed.searchParams.has(key))) throw new Error('Invalid redirect URI');
  return uri;
}

export function callbackList(value, max = 10) {
  const entries = [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  if (entries.length > max) throw new Error('Too many redirect URIs');
  return entries.map(validateCallback);
}

export function registeredCallbacks(client) {
  return [client.redirect, ...JSON.parse(client.redirects || '[]')];
}

export function acceptsClientMethod(client, method) {
  return client.auth === method || (client.kind === 'manual' && confidentialMethods.includes(client.auth) && confidentialMethods.includes(method));
}

export function manualClient(params) {
  const id = params.get('client_id')?.trim(), name = params.get('name')?.trim();
  const auth = params.get('auth');
  const [redirect, ...redirects] = callbackList(params.get('redirect_uri') || '');
  if (!clientIdPattern.test(id || '') || !name || name.length > 100 || !redirect || !authMethods.includes(auth)) throw new Error('Invalid client');
  const supplied = params.get('client_secret') || '';
  if (supplied && (auth === 'none' || supplied.length < 16 || supplied.length > 256 || /[^\x21-\x7e]/.test(supplied))) throw new Error('Invalid client secret');
  const secret = auth === 'none' ? '' : (supplied || makeKey());
  const writeAccess = params.get('writeAccess') === 'on';
  return { client: { id, name, redirect, redirects, auth, secret: secret && tokenHash(secret), writeAccess, publishAccess: writeAccess && params.get('publishAccess') === 'on' }, secret: supplied ? '' : secret };
}
