import { escape } from './escape.mjs';
import { homePath, latestArticleCount, siteHomeImages } from './home.mjs';
import { referencedImages } from './markdown.mjs';
import { mediaPath } from './media.mjs';
import { articlePath, coverSrc, journalLogo, journalPageSize, listUrl } from './render.mjs';
import { languages } from './schema.mjs';

const priorities = {
  home: { fa: '1.0000', en: '0.8000' },
  journal: { fa: '0.8000', en: '0.6400' },
  collection: { fa: '0.6400', en: '0.5120' },
  article: { fa: '0.6400', en: '0.5120' },
};

function lastModified(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace(/\.\d{3}Z$/, '+00:00') : null;
}

function urlBlock(lang, { urls, images, modified, kind }, absolute) {
  const lastmod = lastModified(modified);
  const unique = [...new Set((typeof images === 'function' ? images(lang) : images).map(absolute))];
  return [
    '  <url>',
    `    <loc>${absolute(urls[lang])}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    `    <priority>${priorities[kind][lang]}</priority>`,
    ...[...languages, 'x-default'].map((alt) => `    <xhtml:link rel="alternate" hreflang="${alt}" href="${absolute(urls[alt === 'x-default' ? 'fa' : alt])}" />`),
    ...unique.flatMap((url) => ['    <image:image>', `      <image:loc>${url}</image:loc>`, '    </image:image>']),
    '  </url>',
  ].join('\n');
}

export function sitemap(origin, { articles = [], categories = [], enabled = true } = {}) {
  const absolute = (value) => { const url = new URL(value, origin); url.hash = ''; return escape(url.href); };
  const localized = (pathname) => Object.fromEntries(languages.map((lang) => [lang, pathname(lang)]));
  const home = { kind: 'home', urls: localized(homePath), images: [...siteHomeImages, ...(enabled ? articles.slice(0, latestArticleCount).map((item) => coverSrc(item)) : [])] };
  const entries = [home];
  if (enabled) {
    const grouped = new Map(categories.map(({ slug }) => [slug, []]));
    for (const article of articles) grouped.get(article.section)?.push(article);
    for (const [section, items] of [['', articles], ...grouped]) {
      const pages = Math.max(1, Math.ceil(items.length / journalPageSize));
      for (let page = 1; page <= pages; page++) {
        const covers = items.slice((page - 1) * journalPageSize, page * journalPageSize).map((item) => coverSrc(item));
        entries.push({ kind: !section && page === 1 ? 'journal' : 'collection', urls: localized((lang) => listUrl(lang, page, section)), images: [journalLogo, ...covers] });
      }
    }
    for (const article of articles) {
      entries.push({ kind: 'article', urls: localized((lang) => articlePath(lang, article)), modified: article.modified,
        images: (lang) => [journalLogo, coverSrc(article), ...[...referencedImages(article[lang].body)].map(mediaPath)] });
    }
  }
  const urls = entries.flatMap((entry) => languages.map((lang) => urlBlock(lang, entry, absolute)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n\n')}\n</urlset>\n`;
}
