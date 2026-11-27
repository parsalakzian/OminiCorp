import { defaultCover, mediaFromPath } from './media.mjs';

export function coverSize(item, lookup) {
  if (!item.cover || item.cover.src === defaultCover) return { width: 1250, height: 698 };
  const id = mediaFromPath(item.cover.src);
  return id ? lookup?.(id) : undefined;
}

export function sizeAttributes(size) {
  return size ? ` width="${size.width}" height="${size.height}"` : '';
}
