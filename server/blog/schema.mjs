import { z } from 'zod';
import { mediaFromPath } from './media.mjs';
import { parseOrigin } from '../installation.mjs';

export const languages = ['fa', 'en'];
export const sections = ['engineering', 'security', 'ai', 'design'];
const words = (limit, min = 1) => z.string().trim().min(min).max(limit);
export const slug = z.string().min(2).max(100).regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);
export function webUrl(value) {
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}
export const source = z.object({ title: words(300), url: z.string().max(1800).refine(webUrl) });
export const translation = z.object({
  title: words(120, 5), slug, excerpt: words(255, 15), seoTitle: words(72, 5), description: words(180, 30),
  tags: z.array(words(36)).min(1).max(8), body: words(30000, 70),
});
export const coverSchema = z.object({
  src: z.string().trim().max(1800).refine((value) => Boolean(mediaFromPath(value)) || (value.startsWith('https://') && webUrl(value))),
  altFa: z.string().trim().max(180).default(''), altEn: z.string().trim().max(180).default(''),
});
export const articleSchema = z.object({
  section: z.enum(sections), author: words(80), state: z.enum(['draft', 'published']),
  cover: coverSchema.nullable().optional(),
  sources: z.array(source).max(10), fa: translation, en: translation,
});
const https = (value) => webUrl(value) && new URL(value).protocol === 'https:';
export const settingsSchema = z.object({
  enabled: z.boolean(), mcp: z.boolean(), mcpWrite: z.boolean(), mcpPublish: z.boolean(),
  mcpOrigins: z.array(z.string().max(350).refine((origin) => {
    try { return parseOrigin(origin) === origin; } catch { return false; }
  })).max(10).default([]),
  ai: z.boolean(), scheduling: z.boolean(), autopublish: z.boolean(),
  aiEndpoint: z.string().max(500).refine((value) => !value || https(value) && !new URL(value).search && !new URL(value).hash),
  aiModel: z.string().trim().max(120), useProxy: z.boolean(),
  proxyUrl: z.string().max(500).refine((value) => {
    if (!value) return true;
    if (!webUrl(value)) return false;
    const url = new URL(value);
    return url.pathname === '/' && !url.search && !url.hash;
  }),
  feeds: z.array(z.string().max(500).refine(https)).max(12),
  interval: z.number().int().min(15).max(10080), batch: z.number().int().min(1).max(20),
});
export const defaults = {
  enabled: true, mcp: false, mcpWrite: false, mcpPublish: false, mcpOrigins: [], ai: false, scheduling: false, autopublish: false,
  aiEndpoint: 'https://api.openai.com/v1/chat/completions', aiModel: '', useProxy: false, proxyUrl: '', feeds: [], interval: 60, batch: 3,
};

export function normalizeSource(value) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_|^(fbclid|gclid|mc_(cid|eid)|ref)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/^http:/, 'https:');
}
export function titleKey(value) {
  return value.normalize('NFKC').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u064B-\u065F]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
