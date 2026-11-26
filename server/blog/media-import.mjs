import { lookup } from 'node:dns/promises';
import { addAbortListener } from 'node:events';
import { get } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { maxImageBytes, maxImageMiB, MediaError } from './media.mjs';

const redirects = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 4;
const globalV6 = ipaddr.parse('2000::');
function publicIp(value) {
  try {
    const ip = ipaddr.parse(value);
    return ip.range() === 'unicast' && (ip.kind() === 'ipv4' || ip.match(globalV6, 3));
  } catch { return false; }
}

function sourceUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && url.href.length <= 4096) return url;
  } catch { /* report bad URL below */ }
  throw new MediaError('Use a direct public HTTPS image URL on the standard port, without credentials.');
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const listener = addAbortListener(signal, () => reject(signal.reason));
    promise.then(resolve, reject).finally(() => listener[Symbol.dispose]());
  });
}

function request(url, address, signal) {
  return new Promise((resolve, reject) => {
    const socket = get(url, { agent: false, signal, headers: { Accept: 'image/*', 'Accept-Encoding': 'identity' },
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family) }, resolve);
    socket.once('error', reject);
  });
}

export function createImageImporter({ resolve = lookup, open = request } = {}) {
  return async function importImage(source, clientSignal) {
    const timeout = AbortSignal.timeout(20_000);
    const signal = clientSignal ? AbortSignal.any([timeout, clientSignal]) : timeout;
    let url = sourceUrl(source);
    try {
      for (let step = 0; step <= maxRedirects; step++) {
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const family = isIP(hostname);
        // No DNS search-list lookups or local-only names for remote sources.
        if (!family && (!hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|home\.arpa)\.?$/i.test(hostname))) throw new MediaError('Image source must resolve to a public address.');
        const addresses = family ? [{ address: hostname, family }] : await abortable(resolve(hostname, { all: true }), signal);
        signal.throwIfAborted();
        if (!addresses.length || addresses.some(({ address }) => !publicIp(address))) throw new MediaError('Image source must resolve only to public addresses.');
        // Keep the original host for TLS and HTTP but connect to a verified address, without another DNS resolution.
        const response = await open(url, addresses.find(({ family }) => family === 4) || addresses[0], signal);
        try {
          if (redirects.has(response.statusCode) && response.headers.location) {
            url = sourceUrl(response.headers.location, url);
            continue;
          }
          if (response.statusCode !== 200) throw new MediaError(`Image URL returned HTTP ${response.statusCode}. Use a link that opens the file without login.`);
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new MediaError('Image host must serve the raw file, without content encoding.');
          if (Number(response.headers['content-length']) > maxImageBytes) throw new MediaError(`Image exceeds the ${maxImageMiB} MiB per-file limit.`);
          let size = 0;
          const chunks = [];
          for await (const chunk of response) {
            size += chunk.length;
            if (size > maxImageBytes) throw new MediaError(`Image exceeds the ${maxImageMiB} MiB per-file limit.`);
            chunks.push(chunk);
          }
          return Buffer.concat(chunks, size);
        } finally { response.destroy(); }
      }
      throw new MediaError('Too many redirects for the image URL.');
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError(signal.aborted ? 'Image download timed out or was cancelled.' : 'Could not reach the image host. Check that the direct HTTPS URL is publicly accessible.');
    }
  };
}
