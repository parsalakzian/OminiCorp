import { acceptsClientMethod, registeredCallbacks } from './oauth-clients.mjs';
import { createOAuthRegistration, registrationPath } from './oauth-registration.mjs';
import { constantEqual, digest, makeKey, tokenHash } from '../installation.mjs';

export const authorizePath = '/admin/oauth/authorize';
export const tokenPath = '/oauth/token';
export const resourceMetadata = '/.well-known/oauth-protected-resource/mcp';
export const issuerMetadata = '/.well-known/oauth-authorization-server';
const accessAge = 3600, refreshAge = 30 * 86400, codeAge = 120;
const pkceVerifier = /^[A-Za-z0-9._~-]{43,128}$/;
const keyPattern = /^[A-Za-z0-9_-]{43}$/;
const scope = 'mcp';
const resourceFor = (site) => `${site}/mcp`;
const readResource = (value, site) => value == null || value === `${resourceFor(site)}/` ? resourceFor(site) : value;
const validScope = (value) => value == null || value.trim() === scope || value.trim() === '';
const json = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
const reject = (res, status, error) => json(res, status, { error });

export function localOAuthReturn(value) {
  return typeof value === 'string' && value.length <= 4096 && value.startsWith(`${authorizePath}?`) && !/[\r\n]/.test(value) ? value : undefined;
}

function uniqueParams(params) { return [...params.keys()].every((key) => params.getAll(key).length === 1); }

export function createOAuth(store, read, report = () => {}) {
  const db = store.oauth;
  const system = () => store.getSystem().siteUrl;
  const dcr = createOAuthRegistration(store);
  const enabled = () => store.getSettings().mcp && (db.countClients('manual') > 0 || dcr.registrationEnabled());
  const clientAllowed = (client) => client.kind === 'manual' || (client.kind === 'dcr' && dcr.dcrAllowed(registeredCallbacks(client)));
  const getClient = (id) => {
    const client = db.getClient(id);
    return client && clientAllowed(client) ? client : undefined;
  };
  const header = () => enabled() ? `, resource_metadata="${system()}${resourceMetadata}", scope="${scope}"` : '';
  const live = (grant) => grant && grant.owner_hash === store.getOwner()?.hash && grant.resource === resourceFor(system());
  const authenticate = (bearer) => {
    if (!keyPattern.test(bearer)) return undefined;
    const grant = db.getGrant(tokenHash(bearer), 'access', Date.now());
    return live(grant) ? getClient(grant.client_id) : undefined;
  };
  const authRequest = (params) => {
    const invalid = (reason) => { report('authorize', reason); return null; };
    if (!enabled()) return invalid('disabled');
    if (!uniqueParams(params)) return invalid('duplicate_parameter');
    const id = params.get('client_id');
    const state = params.get('state');
    const redirect = params.get('redirect_uri');
    const challenge = params.get('code_challenge');
    const resource = readResource(params.get('resource'), system());
    if (resource !== resourceFor(system())) return invalid('invalid_target');
    if (state !== null && (!state.length || state.length > 1024)) return invalid('invalid_state');
    if (!keyPattern.test(challenge || '') || params.get('code_challenge_method') !== 'S256') return invalid('invalid_pkce');
    if (params.get('response_type') !== 'code') return invalid('unsupported_response_type');
    if (!validScope(params.get('scope'))) return invalid('invalid_scope');
    const client = db.getClient(id || '');
    if (!client) return invalid('unknown_client');
    if (!clientAllowed(client)) return invalid('client_disabled');
    if (!registeredCallbacks(client).includes(redirect)) return invalid('redirect_mismatch');
    return { client, redirect, challenge, resource, state };
  };
  const authorize = (res, value, deny, owner) => {
    const target = new URL(value.redirect);
    target.searchParams.set('iss', system());
    if (value.state !== null) target.searchParams.set('state', value.state);
    if (deny) target.searchParams.set('error', 'access_denied');
    else {
      const code = makeKey(), now = Date.now();
      db.putCode({ hash: tokenHash(code), client_id: value.client.id, kind: 'code', expires: now + codeAge * 1000,
        resource: value.resource, owner_hash: owner.hash, redirect: value.redirect, challenge: value.challenge, flow: makeKey() }, now);
      target.searchParams.set('code', code);
    }
    report('authorize', deny ? 'denied' : 'code_issued');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.writeHead(303, { Location: target.href }).end();
  };

  let attempts = 0, reset = 0, registrations = 0, registrationReset = 0;
  async function route(req, res, url) {
    const path = url.pathname;
    if (![resourceMetadata, '/.well-known/oauth-protected-resource', issuerMetadata, tokenPath, registrationPath].includes(path)) return false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    const stage = path === tokenPath ? 'token' : path === registrationPath ? 'register' : undefined;
    const fail = (status, error, reason = error) => {
      if (stage) report(stage, reason);
      return reject(res, status, error);
    };
    if (!enabled()) {
      if (stage && req.method === 'POST') report(stage, 'disabled');
      return res.writeHead(404).end();
    }
    const site = system();
    if (path === registrationPath || path === tokenPath) {
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader('Vary', 'Origin');
        if (origin !== site && !store.getSettings().mcpOrigins.includes(origin)) { report(stage, 'origin_denied'); return reject(res, 403, 'invalid_request'); }
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }).end();
    }
    if (path === registrationPath) {
      if (!dcr.registrationEnabled()) { if (req.method === 'POST') report(stage, 'disabled'); return res.writeHead(404).end(); }
      if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST, OPTIONS' }).end();
      const now = Date.now();
      if (now >= registrationReset) { registrationReset = now + 3600000; registrations = 0; }
      if (++registrations > 30) { report(stage, 'rate_limited'); return res.writeHead(429, { 'Retry-After': String(Math.ceil((registrationReset - now) / 1000)) }).end(); }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return fail(400, 'invalid_client_metadata');
      const raw = await read(req, 8192);
      if (!raw || !dcr.registrationEnabled()) return fail(400, 'invalid_client_metadata');
      let metadata;
      try { metadata = JSON.parse(raw); } catch { return fail(400, 'invalid_client_metadata'); }
      const result = dcr.register(metadata);
      if (result.error) return fail(result.error === 'temporarily_unavailable' ? 503 : 400, result.error);
      report(stage, 'created');
      return json(res, 201, result.data);
    }
    if (path !== tokenPath) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      if (path === issuerMetadata) return json(res, 200, { issuer: site, authorization_endpoint: site + authorizePath, token_endpoint: site + tokenPath, authorization_response_iss_parameter_supported: true,
        ...(dcr.registrationEnabled() ? { registration_endpoint: site + registrationPath } : {}),
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'], scopes_supported: [scope] });
      return json(res, 200, { resource: resourceFor(site), authorization_servers: [site], scopes_supported: [scope], bearer_methods_supported: ['header'], resource_name: 'OminiCorp MCP' });
    }
    if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST, OPTIONS' }).end();
    const now = Date.now();
    if (now >= reset) { reset = now + 60000; attempts = 0; }
    if (++attempts > 120) {
      report(stage, 'rate_limited');
      return res.writeHead(429, { 'Retry-After': String(Math.ceil((reset - now) / 1000)) }).end();
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return fail(400, 'invalid_request');
    const raw = await read(req, 8192);
    if (raw === null || !enabled()) return fail(400, 'invalid_request');
    const p = new URLSearchParams(raw);
    if (!uniqueParams(p)) return fail(400, 'invalid_request');
    let id = p.get('client_id'), secret = p.get('client_secret');
    let method = secret === null ? 'none' : 'client_secret_post';
    let rawBasicSecret;
    if (req.headers.authorization) {
      const match = req.headers.authorization.match(/^Basic ([A-Za-z0-9+/=]{1,1600})$/i);
      if (!match || p.has('client_secret')) return fail(400, 'invalid_request');
      const credentials = Buffer.from(match[1], 'base64').toString('utf8');
      const separator = credentials.indexOf(':');
      if (separator < 1) return fail(400, 'invalid_request');
      rawBasicSecret = credentials.slice(separator + 1);
      const decode = (value) => { try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return value; } };
      id = decode(credentials.slice(0, separator));
      secret = decode(rawBasicSecret);
      if (p.has('client_id') && p.get('client_id') !== id) return fail(400, 'invalid_request');
      method = 'client_secret_basic';
    }
    const registered = id && id.length <= 240 && db.getClient(id);
    const client = registered && clientAllowed(registered) && registered;
    const secrets = [secret, rawBasicSecret].filter((value) => typeof value === 'string' && value.length <= 256);
    if (!client || !acceptsClientMethod(client, method) || (method !== 'none' && !secrets.some((value) => constantEqual(tokenHash(value), client.secret)))) {
      if (method === 'client_secret_basic') res.setHeader('WWW-Authenticate', 'Basic realm="OminiCorp OAuth"');
      return fail(method === 'client_secret_basic' ? 401 : 400, 'invalid_client', !registered ? 'unknown_client' : !client ? 'client_disabled' : !acceptsClientMethod(client, method) ? 'client_auth_method_mismatch' : 'invalid_client_credentials');
    }
    const kind = ({ authorization_code: 'code', refresh_token: 'refresh' })[p.get('grant_type')];
    if (kind !== 'code' && kind !== 'refresh') return fail(400, 'unsupported_grant_type');
    const old = p.get(kind === 'code' ? 'code' : 'refresh_token');
    if (!old || !keyPattern.test(old)) return fail(400, 'invalid_grant');
    const resource = readResource(p.get('resource'), site);
    if (resource !== resourceFor(site)) return fail(400, 'invalid_target');
    if (!validScope(p.get('scope'))) return fail(400, 'invalid_scope');
    const verifier = p.get('code_verifier') || '';
    const access = makeKey(), refresh = makeKey();
    const issued = db.exchange(tokenHash(old), kind, Date.now(), (value) => live(value) && value.client_id === id && value.resource === resource &&
      (kind !== 'code' || (p.get('redirect_uri') === value.redirect && pkceVerifier.test(verifier) && constantEqual(digest(verifier).toString('base64url'), value.challenge))),
    ({ owner_hash, flow }) => [[access, 'access', accessAge], [refresh, 'refresh', refreshAge]].map(([key, tokenKind, age]) => ({
      hash: tokenHash(key), client_id: id, kind: tokenKind, expires: Date.now() + age * 1000, resource, owner_hash, flow,
    })));
    if (!issued) return fail(400, 'invalid_grant');
    report(stage, kind === 'code' ? 'code_exchanged' : 'refreshed');
    res.setHeader('Pragma', 'no-cache');
    return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: accessAge, refresh_token: refresh, scope });
  }
  return { enabled, authenticate, authRequest, authorize, route, header, clientEnabled: (client) => store.getSettings().mcp && Boolean(getClient(client.id)) };
}
