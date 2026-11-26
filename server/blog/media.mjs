import { createHash } from 'node:crypto';
import { imageSize } from 'image-size';

export const maxImageMiB = 25;
export const maxImageBytes = maxImageMiB * 1024 * 1024;
export const maxImageBase64 = 4 * Math.ceil(maxImageBytes / 3);
export const maxImageInput = maxImageBase64 + 2 * 1024 * 1024;
export const imageContentTypes = ['application/octet-stream', 'image/png', 'image/jpeg', 'image/webp'];
export const mediaId = /^[a-f0-9]{64}$/;
export const mediaPath = (id) => `/journal-media/${id}`;
export const mediaPreview = (id) => `/admin/media/${id}`;
export const mediaFromPath = (value) => /^\/journal-media\/([a-f0-9]{64})$/.exec(value || '')?.[1];
export const defaultCover = '/assets/media/blog.webp';
const types = new Map([['png', 'image/png'], ['jpg', 'image/jpeg'], ['webp', 'image/webp']]);
export class MediaError extends Error {}

// Reject truncated containers in addition to sniffing the format and dimensions.
function completeContainer(data, format) {
  if (format === 'png') return data.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  if (format === 'jpg') return data.lastIndexOf(Buffer.from([0xff, 0xd9])) > 2;
  return data.length >= 20 && data.readUInt32LE(4) === data.length - 8;
}

export function inspectImage(data, declaredType) {
  if (!data.length || data.length > maxImageBytes) throw new MediaError(`Image must be at most ${maxImageMiB} MiB.`);
  let info;
  try { info = imageSize(data); } catch { throw new MediaError('Invalid or unsupported image.'); }
  const type = types.get(info.type);
  if (type && !completeContainer(data, info.type)) throw new MediaError('The image appears to be incomplete.');
  if (!type || (declaredType && type !== declaredType) || !info.width || !info.height ||
    info.width > 12000 || info.height > 12000 || info.width * info.height > 64_000_000) {
    throw new MediaError('Use PNG, JPEG or WebP with dimensions up to 12,000 pixels per side and 64 megapixels total.');
  }
  return { id: createHash('sha256').update(data).digest('hex'), type, width: info.width, height: info.height, size: data.length };
}

export function decodeImage(value) {
  const prefix = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(value);
  const encoded = value.slice(prefix?.[0].length || 0).replace(/[\t\n\r ]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (encoded.length > maxImageBase64) throw new MediaError(`Image must be at most ${maxImageMiB} MiB.`);
  const data = Buffer.from(encoded, 'base64');
  const canonical = data.toString('base64');
  if (!data.length || (encoded !== canonical && encoded !== canonical.replace(/=+$/, ''))) {
    throw new MediaError('Invalid Base64 image. If your client cannot send files as Base64, send a public HTTPS url or use POST /mcp/media.');
  }
  return { data, declaredType: prefix?.[1].toLowerCase() };
}

export function sendImage(req, res, item, cache = 'no-store') {
  if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
  if (!item) return res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
  return res.writeHead(200, { 'Content-Type': item.type, 'Content-Length': item.size, 'Cache-Control': cache,
    'Content-Security-Policy': "default-src 'none'; sandbox" }).end(req.method === 'HEAD' ? undefined : item.data);
}
