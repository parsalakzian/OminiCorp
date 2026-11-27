import { makeKey, tokenHash } from '../installation.mjs';

export const registrationPath = '/oauth/register';
export const chatgptClientId = 'https://chatgpt.com/oauth/client.json';
export const chatgptRedirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
export function validChatGPTPair(clientId, redirect) {
  if (clientId === chatgptClientId) return redirect === chatgptRedirect;
  const match = /^https:\/\/chatgpt\.com\/oauth\/([A-Za-z0-9_-]{1,128})\/client\.json$/.exec(clientId);
  return Boolean(match && redirect === `https://chatgpt.com/connector/oauth/${match[1]}`);
}

const methods = ['none', 'client_secret_basic', 'client_secret_post'];
const onlyCode = (values) => Array.isArray(values) && values.length === 1 && values[0] === 'code';
const grants = (values) => Array.isArray(values) && values.includes('authorization_code') && values.every((value) => ['authorization_code', 'refresh_token'].includes(value));
const record = (id, name, auth, secret, kind, redirect = chatgptRedirect) => ({ id, name, redirect, auth, secret: secret ? tokenHash(secret) : '', writeAccess: false, publishAccess: false, kind });

export function createChatGPTRegistration(store, fetchDocument = fetch) {
  const db = store.oauth;
  const enabled = () => {
    const settings = store.getSettings();
    return settings.mcp && settings.mcpChatGPT && Boolean(store.getOwner());
  };
  function configuration() {
    const { mcpCimdClient, mcpCimdCallback } = store.getSettings();
    return { id: mcpCimdClient, redirect: mcpCimdCallback };
  }
  const matchesCimd = (id, redirect) => {
    const config = configuration();
    return id === config.id && redirect === config.redirect && validChatGPTPair(id, redirect);
  };
  let cache;
  async function verifyDocument({ id, redirect }) {
    const response = await fetchDocument(id, { redirect: 'error', signal: AbortSignal.timeout(4500), headers: { Accept: 'application/json' } });
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
    return data?.client_id === id && onlyCode(data.response_types) &&
      Array.isArray(data.grant_types) && data.grant_types.includes('authorization_code') &&
      Array.isArray(data.redirect_uris) && data.redirect_uris.includes(redirect) && Array.isArray(available) && available.includes('none');
  }
  async function resolveCimd(id, redirect) {
    if (!enabled() || !matchesCimd(id, redirect)) return undefined;
    if (cache?.id !== id || cache?.redirect !== redirect) cache = { id, redirect, until: 0 };
    const entry = cache;
    if (Date.now() >= entry.until) {
      // Coalesce requests and bind both positive and negative cache entries to the exact pair.
      entry.pending ??= verifyDocument(entry).catch(() => false).then((valid) => {
        entry.valid = valid;
        entry.until = Date.now() + (valid ? 10 * 60000 : 15000);
      }).finally(() => { entry.pending = undefined; });
      await entry.pending;
    }
    if (!entry.valid || !enabled() || !matchesCimd(id, redirect)) return undefined;
    db.addClient(record(id, 'ChatGPT (CIMD)', 'none', '', 'cimd', redirect));
    return db.getClient(id);
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
  return { enabled, register, resolveCimd, matchesCimd };
}
