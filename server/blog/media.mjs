import { createHash } from 'node:crypto';
import { imageSize } from 'image-size';

export const maxImageBytes = 3 * 1024 * 1024;
export const maxImageBase64 = 4 * Math.ceil(maxImageBytes / 3);
export const mediaQuota = 256 * 1024 * 1024;
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
  if (!data.length || data.length > maxImageBytes) throw new MediaError('Image must be at most 3 MiB.');
  let info;
  try { info = imageSize(data); } catch { throw new MediaError('Invalid or unsupported image.'); }
  const type = types.get(info.type);
  if (type && !completeContainer(data, info.type)) throw new MediaError('The image appears to be incomplete.');
  if (!type || (declaredType && type !== declaredType) || !info.width || !info.height ||
    info.width > 4096 || info.height > 4096) throw new MediaError('Use PNG, JPEG or WebP with dimensions up to 4096 × 4096.');
  return { id: createHash('sha256').update(data).digest('hex'), type, width: info.width, height: info.height, size: data.length };
}

export function decodeImage(value) {
  if (value.length > maxImageBase64) throw new MediaError('Image must be at most 3 MiB.');
  const data = Buffer.from(value, 'base64');
  if (data.toString('base64') !== value) throw new MediaError('Use standard Base64 without a data URL.');
  return data;
}

export function sendImage(req, res, item, cache = 'no-store') {
  if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
  if (!item) return res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
  return res.writeHead(200, { 'Content-Type': item.type, 'Content-Length': item.size, 'Cache-Control': cache,
    'Content-Security-Policy': "default-src 'none'; sandbox" }).end(req.method === 'HEAD' ? undefined : item.data);
}
