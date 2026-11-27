import { escape } from './blog/escape.mjs';

export const icons = '<link rel="icon" type="image/webp" href="/assets/media/logo.webp"><link rel="apple-touch-icon" sizes="180x180" href="/assets/media/apple-touch-icon.png">';
export const shareHome = { src: '/assets/media/share-home.jpg', width: 1200, height: 630, type: 'image/jpeg' };
export const shareJournal = { src: '/assets/media/share-journal.jpg', width: 1200, height: 630, type: 'image/jpeg' };
const locale = { fa: 'fa_IR', en: 'en_US' };
const meta = (attribute, name, value) => value ? `<meta ${attribute}="${name}" content="${escape(value)}">` : '';

export function seoHead({ lang, origin, title, description, canonical, alternates, image, schema, type = 'website', article, noindex }) {
  const absolute = (path) => new URL(path, origin).href;
  const lines = [`<title>${escape(title)}</title>`, meta('name', 'description', description)];
  if (noindex) lines.push('<meta name="robots" content="noindex,follow">');
  if (canonical) {
    const url = absolute(canonical);
    const picture = absolute(image.src);
    lines.push(`<link rel="canonical" href="${escape(url)}">`);
    if (alternates) for (const language of ['fa', 'en', 'x-default']) {
      lines.push(`<link rel="alternate" hreflang="${language}" href="${escape(absolute(alternates[language === 'x-default' ? 'fa' : language]))}">`);
    }
    const og = { type, site_name: 'OminiCorp', locale: locale[lang], 'locale:alternate': locale[lang === 'fa' ? 'en' : 'fa'],
      url, title, description, image: picture, 'image:type': image.type, 'image:width': image.width, 'image:height': image.height, 'image:alt': image.alt };
    for (const [key, value] of Object.entries(og)) lines.push(meta('property', `og:${key}`, value));
    for (const [key, value] of Object.entries({ card: 'summary_large_image', title, description, image: picture, 'image:alt': image.alt })) lines.push(meta('name', `twitter:${key}`, value));
    if (article) lines.push(meta('property', 'article:published_time', article.published), meta('property', 'article:modified_time', article.modified));
  }
  if (schema) lines.push(`<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`);
  return lines.filter(Boolean).join('\n  ');
}
