import { sections } from './schema.mjs';
import { defaultCover as image, mediaFromPath, mediaPreview } from './media.mjs';
import { renderMarkdown } from './markdown.mjs';

export const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const listPath = (lang) => lang === 'en' ? '/en/blog' : '/blog';
export const articlePath = (lang, item) => `${listPath(lang)}/${encodeURIComponent(item[lang].slug)}`;
export const otherLang = (lang) => lang === 'en' ? 'fa' : 'en';
export const labels = {
  fa: { name: 'مجلهٔ اومینی‌کورپ', tagline: 'مجلهٔ فناوری و طراحی', title: 'فناوری، از زاویهٔ کاربردی', intro: 'راهنماها و تحلیل‌هایی برای ساختن، امن‌کردن و بهتر کردن محصولات دیجیتال.', home: 'سایت اصلی', list: 'همهٔ نوشته‌ها', latest: 'آخرین نوشته‌ها', read: 'خواندن مقاله', empty: 'نوشته‌ای پیدا نشد.', search: 'جست‌وجو در مجله', searchButton: 'جست‌وجو', prev: 'صفحهٔ قبل', next: 'صفحهٔ بعد', sources: 'منابع', back: 'بازگشت به مجله', time: 'دقیقه مطالعه', engineering: 'مهندسی', security: 'امنیت', ai: 'هوش مصنوعی', design: 'طراحی', missing: 'این نوشته پیدا نشد', error: 'این صفحه در دسترس نیست.' },
  en: { name: 'OminiCorp Journal', tagline: 'The technology & design journal', title: 'Technology, in practice.', intro: 'Guides and analysis for building, securing, and improving digital products.', home: 'Main site', list: 'All articles', latest: 'Latest articles', read: 'Read article', empty: 'No articles found.', search: 'Search the journal', searchButton: 'Search', prev: 'Previous page', next: 'Next page', sources: 'Sources', back: 'Back to the journal', time: 'min read', engineering: 'Engineering', security: 'Security', ai: 'Artificial intelligence', design: 'Design', missing: 'Article not found', error: 'This page is not available.' },
};
const mark = '<span class="wordmark"><img src="/assets/media/logo.webp" alt="" width="41" height="30"><strong dir="ltr">OMINI<span>CORP</span></strong></span>';
const icon = (value) => `<span class="journal-arrow" aria-hidden="true">${value}</span>`;
const date = (value, lang) => new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
const minutes = (body) => Math.max(1, Math.ceil(body.trim().split(/\s+/).length / 185));
const asJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const coverAlt = (item, lang) => item.cover?.[lang === 'fa' ? 'altFa' : 'altEn'] || '';
const coverSrc = (item, preview) => {
  const src = item.cover?.src || image;
  const id = mediaFromPath(src);
  return preview && id ? mediaPreview(id) : src;
};

export function documentPage({ lang, title, description, origin, canonical, alternates, schema, type = 'website', noindex = false, body, admin = false, article, socialImage = image }) {
  const abs = (path) => escape(new URL(path, origin).href);
  return `<!doctype html><html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080d0b"><title>${escape(title)}</title>
  ${description ? `<meta name="description" content="${escape(description)}">` : ''}${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
  ${canonical ? `<link rel="canonical" href="${abs(canonical)}">` : ''}${alternates ? ['fa', 'en', 'x-default'].map((language) => `<link rel="alternate" hreflang="${language}" href="${abs(alternates[language === 'x-default' ? 'fa' : language])}">`).join('') : ''}
  ${canonical ? `<meta property="og:type" content="${type}"><meta property="og:site_name" content="OminiCorp"><meta property="og:locale" content="${lang === 'fa' ? 'fa_IR' : 'en_US'}"><meta property="og:locale:alternate" content="${lang === 'fa' ? 'en_US' : 'fa_IR'}"><meta property="og:url" content="${abs(canonical)}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${abs(socialImage)}"><meta name="twitter:card" content="summary_large_image">` : ''}
${article ? `<meta property="article:published_time" content="${escape(article.published)}"><meta property="article:modified_time" content="${escape(article.modified)}">` : ''}
  ${schema ? `<script type="application/ld+json">${asJson(schema)}</script>` : ''}<link rel="icon" href="/assets/media/logo.webp" type="image/webp"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/blog.css">${admin ? '<script type="module" src="/assets/blog-admin.mjs"></script>' : ''}</head><body>${body}</body></html>`;
}

function top(lang, target) {
  const c = labels[lang];
  return `<a class="skip-link" href="#journal">${lang === 'fa' ? 'رفتن به محتوا' : 'Skip to content'}</a><header class="journal-header"><div class="shell journal-nav"><a class="journal-brand" href="${listPath(lang)}">${mark}<span>${c.name}</span></a><div><a class="button button-muted button-small" href="${lang === 'fa' ? '/' : '/en.html'}">${c.home}${icon('↗')}</a><a class="locale" lang="${otherLang(lang)}" hreflang="${otherLang(lang)}" href="${target}" aria-label="${lang === 'fa' ? 'English' : 'فارسی'}">${lang === 'fa' ? 'EN' : 'فا'}</a></div></div></header>`;
}
const footer = (lang) => `<footer class="journal-footer"><div class="shell">${mark}<p>${labels[lang].tagline}</p><a href="${listPath(lang)}">${labels[lang].list} ${icon('↗')}</a></div></footer>`;
const listUrl = (lang, page, section, query) => { const params = new URLSearchParams(); if (page > 1) params.set('page', page); if (section) params.set('section', section); if (query) params.set('q', query); return listPath(lang) + (params.size ? `?${params}` : ''); };

export function renderList(lang, origin, { items, total, page, section, query, size, staticPreview = false }) {
  const c = labels[lang];
  const canonical = listUrl(lang, page, section, '');
  const alternates = Object.fromEntries(['fa', 'en'].map((l) => [l, listUrl(l, page, section, '')]));
  const number = (value) => new Intl.NumberFormat(lang).format(value);
  const card = (item, index) => {
    const t = item[lang];
    return `<article class="journal-card" data-section="${item.section}"><a class="journal-card-cover" href="${articlePath(lang, item)}" tabindex="-1" aria-hidden="true">${item.cover ? `<img src="${escape(coverSrc(item))}" alt="" loading="lazy" decoding="async">` : `<span dir="ltr">OC / ${String((page - 1) * size + index + 1).padStart(2, '0')}</span><span class="cover-orbit"></span><span class="cover-code" dir="ltr">${{engineering:'&lt;/&gt;', security:'[ + ]', ai:'✦', design:'◇'}[item.section]}</span>`}</a><div class="journal-card-body"><div class="journal-meta"><span>${c[item.section]}</span><time datetime="${item.published}">${date(item.published, lang)}</time></div><h3><a href="${articlePath(lang, item)}">${escape(t.title)}</a></h3><p>${escape(t.excerpt)}</p><a class="read-link" href="${articlePath(lang, item)}" aria-label="${escape(`${c.read}: ${t.title}`)}">${c.read} ${icon('↗')}</a></div></article>`;
  };
  const pagination = `<nav class="journal-pagination" aria-label="${lang === 'fa' ? 'صفحه‌بندی' : 'Pagination'}">${page > 1 ? `<a rel="prev" class="button button-muted" href="${escape(listUrl(lang, page - 1, section, query))}">${c.prev}</a>` : ''}${total > page * size ? `<a rel="next" class="button button-muted" href="${escape(listUrl(lang, page + 1, section, query))}">${c.next}</a>` : ''}</nav>`;
  const body = `${top(lang, listUrl(otherLang(lang), page, section, ''))}<main id="journal"><section class="journal-hero"><div class="shell journal-hero-grid"><div><div class="eyebrow"><span class="signal"></span>${c.tagline}</div><h1>${c.title}</h1><p>${c.intro}</p>${staticPreview ? '' : `<form action="${listPath(lang)}" method="get" class="journal-search" role="search"><label class="sr-only" for="journal-search">${c.search}</label><input id="journal-search" type="search" name="q" maxlength="100" placeholder="${c.search}" value="${escape(query)}"><button class="button button-primary" type="submit">${c.searchButton}</button></form>`}</div><div class="journal-art"><img src="${image}" width="1250" height="698" alt="" fetchpriority="high"><small dir="ltr">OMINI / TECH BRIEF</small></div></div></section>
  <section class="shell journal-list" aria-labelledby="latest"><div class="journal-list-head"><div><p class="journal-kicker" dir="ltr">// THE INDEX</p><h2 id="latest">${section ? c[section] : c.latest}</h2></div><span class="journal-count">${number(total)} ${lang === 'fa' ? 'نوشته' : 'articles'}</span></div>${staticPreview ? '' : `<nav class="journal-filters" aria-label="${c.list}">${['', ...sections].map((key) => `<a class="filter-pill"${key === section ? ' aria-current="true"' : ''} href="${escape(listUrl(lang, 1, key, query))}">${key ? c[key] : c.list}</a>`).join('')}</nav>`}${items.length ? `<div class="journal-cards">${items.map(card).join('')}</div>` : `<p class="journal-empty">${c.empty}</p>`}${pagination}</section></main>${footer(lang)}`;
  return documentPage({ lang, origin, title: `${section ? `${c[section]} | ` : ''}${c.name}${page > 1 ? ` • ${number(page)}` : ''}`, description: c.intro, canonical, alternates, noindex: Boolean(query), body,
    schema: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: c.name, url: new URL(canonical, origin).href, inLanguage: lang } });
}

export function renderArticle(lang, origin, item, related = [], preview = false) {
  const c = labels[lang], t = item[lang], canonical = articlePath(lang, item);
  const alternates = Object.fromEntries(['fa', 'en'].map((l) => [l, articlePath(l, item)]));
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BlogPosting', mainEntityOfPage: new URL(canonical, origin).href, headline: t.title, description: t.description, datePublished: item.published, dateModified: item.modified, inLanguage: lang, image: [new URL(coverSrc(item), origin).href], author: { '@type': 'Organization', name: item.author }, publisher: { '@type': 'Organization', name: 'OminiCorp', logo: { '@type': 'ImageObject', url: new URL('/assets/media/logo.webp', origin).href } }, keywords: t.tags.join(', '), citation: item.sources.map((entry) => entry.url) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: c.name, item: new URL(listPath(lang), origin).href }, { '@type': 'ListItem', position: 2, name: t.title, item: new URL(canonical, origin).href }] },
  ] };
  const body = `${top(lang, preview ? `/admin/articles/${item.id}/preview/${otherLang(lang)}` : alternates[otherLang(lang)])}<main id="journal" class="shell article-page">${preview ? `<p class="desk-notice"><a href="/admin/articles/${item.id}">${lang === 'fa' ? 'پیش‌نمایش خصوصی · بازگشت به ویرایشگر' : 'Private preview · Back to editor'}</a></p>` : ''}<article><header class="article-header"><a class="read-link" href="${listPath(lang)}">${icon(lang === 'fa' ? '→' : '←')} ${c.back}</a><div class="journal-meta"><span>${c[item.section]}</span><time datetime="${item.published}">${date(item.published, lang)}</time><span>${new Intl.NumberFormat(lang).format(minutes(t.body))} ${c.time}</span></div><h1>${escape(t.title)}</h1><p>${escape(t.excerpt)}</p><div class="article-byline"><span class="signal"></span><bdi>${escape(item.author)}</bdi></div></header><div class="article-cover"><img src="${escape(coverSrc(item, preview))}"${item.cover ? '' : ' width="1250" height="698"'} alt="${escape(coverAlt(item, lang))}" fetchpriority="high"></div><div class="article-content">${renderMarkdown(t.body, preview)}${item.sources.length ? `<aside class="article-sources"><h2>${c.sources}</h2><ul>${item.sources.map((entry) => `<li><a href="${escape(entry.url)}" rel="external noreferrer"><bdi>${escape(entry.title)}</bdi></a></li>`).join('')}</ul></aside>` : ''}<ul class="article-tags">${t.tags.map((tag) => `<li>${escape(tag)}</li>`).join('')}</ul></div></article>${related.length ? `<aside class="journal-related"><h2>${lang === 'fa' ? 'بیشتر بخوانید' : 'Read next'}</h2>${related.map((other) => `<a href="${articlePath(lang, other)}">${escape(other[lang].title)} ${icon('↗')}</a>`).join('')}</aside>` : ''}</main>${footer(lang)}`;
  return documentPage({ lang, title: t.seoTitle, description: t.description, origin, canonical: preview ? null : canonical, alternates: preview ? null : alternates, type: 'article', schema: preview ? null : schema, noindex: preview, article: item, socialImage: coverSrc(item), body });
}

export function renderMissing(lang, origin) {
  const c = labels[lang];
  return documentPage({ lang, origin, title: c.missing, noindex: true, body: `${top(lang, listPath(otherLang(lang)))}<main id="journal" class="shell journal-list"><h1>${c.missing}</h1><p>${c.error}</p><a class="read-link" href="${listPath(lang)}">${c.back}</a></main>${footer(lang)}` });
}

export function sitemap(origin, rows, enabled = true) {
  const paths = (path) => escape(new URL(path, origin).href);
  const index = { fa: '/blog', en: '/en/blog' };
  const pairs = [{ fa: '/', en: '/en.html' }, ...(enabled ? [index] : []), ...rows.map((row) => ({ fa: `${index.fa}/${encodeURIComponent(row.fa_slug)}`, en: `${index.en}/${encodeURIComponent(row.en_slug)}`, lastmod: row.modified }))];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${pairs.flatMap((pair) => ['fa', 'en'].map((lang) => `<url><loc>${paths(pair[lang])}</loc>${pair.lastmod ? `<lastmod>${escape(pair.lastmod)}</lastmod>` : ''}${['fa', 'en', 'x-default'].map((alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${paths(pair[alt === 'x-default' ? 'fa' : alt])}"/>`).join('')}</url>`)).join('')}</urlset>`;
}
