import { escape } from './escape.mjs';
import { homePath, latestArticleCount, siteHomeImages } from './home.mjs';
import { referencedImages } from './markdown.mjs';
import { mediaPath } from './media.mjs';
import { articlePath, coverSrc, journalLogo, journalPageSize, listUrl } from './render.mjs';
import { languages } from './schema.mjs';

export function sitemap(origin, { articles = [], categories = [], enabled = true } = {}) {
  const absolute = (value) => { const url = new URL(value, origin); url.hash = ''; return escape(url.href); };
  const localized = (pathname) => Object.fromEntries(languages.map((lang) => [lang, pathname(lang)]));
  const home = { urls: localized(homePath), images: [...siteHomeImages, ...(enabled ? articles.slice(0, latestArticleCount).map((item) => coverSrc(item)) : [])] };
  const entries = [home];
  if (enabled) {
    const grouped = new Map(categories.map(({ slug }) => [slug, []]));
    for (const article of articles) grouped.get(article.section)?.push(article);
    for (const [section, items] of [['', articles], ...grouped]) {
      const pages = Math.max(1, Math.ceil(items.length / journalPageSize));
      for (let page = 1; page <= pages; page++) {
        const covers = items.slice((page - 1) * journalPageSize, page * journalPageSize).map((item) => coverSrc(item));
        entries.push({ urls: localized((lang) => listUrl(lang, page, section)), images: [journalLogo, ...covers] });
      }
    }
    for (const article of articles) {
      entries.push({ urls: localized((lang) => articlePath(lang, article)), modified: article.modified,
        images: (lang) => [journalLogo, coverSrc(article), ...[...referencedImages(article[lang].body)].map(mediaPath)] });
    }
  }
  const urls = entries.flatMap(({ urls, images, modified }) => languages.map((lang) => {
    const alternates = [...languages, 'x-default'].map((alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${absolute(urls[alt === 'x-default' ? 'fa' : alt])}"/>`).join('');
    const unique = [...new Set((typeof images === 'function' ? images(lang) : images).map(absolute))];
    const pictures = unique.map((url) => `<image:image><image:loc>${url}</image:loc></image:image>`).join('');
    return `<url><loc>${absolute(urls[lang])}</loc>${modified ? `<lastmod>${escape(modified)}</lastmod>` : ''}${alternates}${pictures}</url>`;
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join('\n')}\n</urlset>\n`;
}
