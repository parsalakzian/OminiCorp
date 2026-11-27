import { makeKey, tokenHash } from '../installation.mjs';

export const registrationPath = '/oauth/register';
export const chatgptClientId = 'https://chatgpt.com/oauth/client.json';
export const chatgptRedirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const methods = ['none', 'client_secret_basic', 'client_secret_post'];
const onlyCode = (values) => Array.isArray(values) && values.length === 1 && values[0] === 'code';
const grants = (values) => Array.isArray(values) && values.includes('authorization_code') && values.every((value) => ['authorization_code', 'refresh_token'].includes(value));
const record = (id, name, auth, secret, kind) => ({ id, name, redirect: chatgptRedirect, auth, secret: secret ? tokenHash(secret) : '', writeAccess: false, publishAccess: false, kind });

export function createChatGPTRegistration(store, fetchDocument = fetch) {
  const db = store.oauth;
  const enabled = () => {
    const settings = store.getSettings();
    return settings.mcp && settings.mcpChatGPT && Boolean(store.getOwner());
  };
  let documentUntil = 0, validDocument = false, pending;
  async function verifyDocument() {
    const response = await fetchDocument(chatgptClientId, { redirect: 'error', signal: AbortSignal.timeout(4500), headers: { Accept: 'application/json' } });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) { await reader.cancel(); return false; }
        parts.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
    const available = data?.token_endpoint_auth_methods_supported ?? [data?.token_endpoint_auth_method];
    return data?.client_id === chatgptClientId && onlyCode(data.response_types) &&
      Array.isArray(data.grant_types) && data.grant_types.includes('authorization_code') &&
      Array.isArray(data.redirect_uris) && data.redirect_uris.includes(chatgptRedirect) && Array.isArray(available) && available.includes('none');
  }
  async function resolveCimd() {
    if (!enabled()) return undefined;
    if (Date.now() >= documentUntil) {
      // One bounded request even if multiple authorization attempts arrive together.
      pending ??= verifyDocument().then((valid) => {
        validDocument = valid;
        documentUntil = Date.now() + (valid ? 10 * 60000 : 15 * 1000);
        return valid;
      }).catch(() => { validDocument = false; documentUntil = Date.now() + 15000; return false; }).finally(() => { pending = undefined; });
      if (!await pending) return undefined;
    }
    if (!enabled() || !validDocument) return undefined;
    const client = record(chatgptClientId, 'ChatGPT (CIMD)', 'none', '', 'cimd');
    db.addClient(client);
    return db.getClient(chatgptClientId);
  }
  function register(data) {
    const auth = data?.token_endpoint_auth_method ?? 'client_secret_basic';
    if (!methods.includes(auth)) return { error: 'invalid_client_metadata' };
    if (!onlyCode(data?.response_types ?? ['code']) || !grants(data?.grant_types ?? ['authorization_code']) || (data?.scope !== undefined && data.scope !== 'mcp')) return { error: 'invalid_client_metadata' };
    if (!Array.isArray(data?.redirect_uris) || data.redirect_uris.length !== 1 || data.redirect_uris[0] !== chatgptRedirect) return { error: 'invalid_redirect_uri' };
    if (db.countClients('dcr') >= 100) return { error: 'temporarily_unavailable' };
    const id = `chatgpt-${makeKey()}`;
    const secret = auth === 'none' ? '' : makeKey();
    db.addClient(record(id, 'ChatGPT (DCR)', auth, secret, 'dcr'));
    return { data: { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      redirect_uris: [chatgptRedirect], client_name: 'ChatGPT', token_endpoint_auth_method: auth, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'mcp' } };
  }
  return { enabled, register, resolveCimd };
}
