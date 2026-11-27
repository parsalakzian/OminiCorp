import { authMethods } from './oauth-clients.mjs';
import { makeKey, tokenHash } from '../installation.mjs';
import { accessModes } from './mcp-access.mjs';

export const registrationPath = '/oauth/register';
export const maxDcrCallbacks = 11;
export const defaultDcrCallback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const onlyCode = (values) => Array.isArray(values) && values.length === 1 && values[0] === 'code';
const grants = (values) => Array.isArray(values) && values.includes('authorization_code') && values.every((value) => ['authorization_code', 'refresh_token'].includes(value));

export function createOAuthRegistration(store) {
  const db = store.oauth;
  const allowedCallbacks = () => {
    const settings = store.getSettings();
    return settings.mcp && store.getOwner() ? settings.mcpDcrCallbacks : [];
  };
  const registrationEnabled = () => allowedCallbacks().length > 0;
  const dcrAllowed = (callbacks) => {
    const allowed = allowedCallbacks();
    return callbacks.length > 0 && callbacks.every((callback) => allowed.includes(callback));
  };
  function register(data) {
    const auth = data?.token_endpoint_auth_method ?? 'client_secret_basic';
    if (!authMethods.includes(auth)) return { error: 'invalid_client_metadata' };
    if (!onlyCode(data?.response_types ?? ['code']) || !grants(data?.grant_types ?? ['authorization_code']) || (data?.scope !== undefined && data.scope !== 'mcp')) return { error: 'invalid_client_metadata' };
    const callbacks = data?.redirect_uris;
    if (!Array.isArray(callbacks) || callbacks.length > 10 || new Set(callbacks).size !== callbacks.length || !dcrAllowed(callbacks)) return { error: 'invalid_redirect_uri' };
    if (db.countClients('dcr') >= 100) return { error: 'temporarily_unavailable' };
    const [redirect, ...redirects] = callbacks;
    const id = `dcr-${makeKey()}`;
    const preferredName = typeof data.client_name === 'string' ? data.client_name.trim().slice(0, 100) : '';
    const name = preferredName || new URL(redirect).hostname;
    const secret = auth === 'none' ? '' : makeKey();
    db.addClient({ id, name, redirect, redirects, auth, secret: secret ? tokenHash(secret) : '', kind: 'dcr', ...accessModes.full });
    return { data: { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      redirect_uris: callbacks, client_name: name, token_endpoint_auth_method: auth, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'mcp' } };
  }
  return { registrationEnabled, dcrAllowed, register };
}
