import { categoryDescription, categoryName, categoryThemes, defaultCategories } from './categories.mjs';
import { pagination } from './pagination.mjs';
import { defaultCover as image, mediaFromPath, mediaPreview } from './media.mjs';
import { renderMarkdown } from './markdown.mjs';

import { escape } from './escape.mjs';
export { escape } from './escape.mjs';
export const listPath = (lang) => lang === 'en' ? '/en/blog' : '/blog';
export const categoryPath = (lang, slug) => `${listPath(lang)}/category/${encodeURIComponent(slug)}`;
export const articlePath = (lang, item) => `${listPath(lang)}/${encodeURIComponent(item[lang].slug)}`;
export const otherLang = (lang) => lang === 'en' ? 'fa' : 'en';
export const labels = {
  fa: { name: 'مجلهٔ اومینی‌کورپ', tagline: 'مجلهٔ فناوری و طراحی', title: 'فناوری، از زاویهٔ کاربردی', intro: 'راهنماها و تحلیل‌هایی برای ساختن، امن‌کردن و بهتر کردن محصولات دیجیتال.', home: 'سایت اصلی', list: 'همهٔ نوشته‌ها', latest: 'آخرین نوشته‌ها', read: 'خواندن مقاله', empty: 'نوشته‌ای پیدا نشد.', search: 'جست‌وجو در مجله', searchButton: 'جست‌وجو', sources: 'منابع', back: 'بازگشت به مجله', time: 'دقیقه مطالعه', missing: 'این نوشته پیدا نشد', error: 'این صفحه در دسترس نیست.' },
  en: { name: 'OminiCorp Journal', tagline: 'The technology & design journal', title: 'Technology, in practice.', intro: 'Guides and analysis for building, securing, and improving digital products.', home: 'Main site', list: 'All articles', latest: 'Latest articles', read: 'Read article', empty: 'No articles found.', search: 'Search the journal', searchButton: 'Search', sources: 'Sources', back: 'Back to the journal', time: 'min read', missing: 'Article not found', error: 'This page is not available.' },
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

function coverImage(lang, item, { preview = false, eager = false, decorative = false } = {}) {
  const dimensions = item.cover ? '' : ' width="1250" height="698"';
  return `<img src="${escape(coverSrc(item, preview))}"${dimensions} alt="${escape(decorative ? '' : coverAlt(item, lang))}" ${eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'}>`;
}

function featuredCover(lang, item) {
  return `<a class="journal-art" href="${articlePath(lang, item)}">${coverImage(lang, item, { eager: true })}<span class="journal-feature-caption"><small>${lang === 'fa' ? 'تازه‌ترین مقاله' : 'Latest article'}</small><strong>${escape(item[lang].title)}</strong></span></a>`;
}

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
export function listUrl(lang, page = 1, section = '', query = '') {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', page);
  if (query) params.set('q', query);
  return (section ? categoryPath(lang, section) : listPath(lang)) + (params.size ? `?${params}` : '');
}

function categoryNavigation(lang, categories, section, query, overall) {
  const fa = lang === 'fa';
  const number = new Intl.NumberFormat(lang);
  const tile = (category) => {
    const slug = category?.slug || '';
    const title = category ? categoryName(category, lang) : labels[lang].list;
    const count = category?.count ?? overall;
    const theme = category?.theme || 'mint';
    return `<li><a class="topic-tile" data-theme="${theme}" href="${escape(listUrl(lang, 1, slug, query))}"${slug === section ? ' aria-current="page"' : ''}><span class="topic-icon" aria-hidden="true">${category ? categoryThemes[theme].icon : '▦'}</span><span class="topic-name">${escape(title)}</span><span class="topic-count" aria-label="${number.format(count)} ${fa ? 'نوشته' : count === 1 ? 'article' : 'articles'}">${number.format(count)}</span></a></li>`;
  };
  const active = categories.find((entry) => entry.slug === section);
  const shown = categories.slice(0, 5);
  if (active && !shown.includes(active)) shown.push(active);
  const more = categories.filter((entry) => !shown.includes(entry));
  return `<nav class="shell journal-topics" aria-labelledby="topic-title"><div class="journal-list-head"><h2 id="topic-title">${fa ? 'مرور دسته‌ها' : 'Browse categories'}</h2><span class="journal-count" aria-hidden="true">${fa ? 'موضوعی را انتخاب کنید' : 'Explore by topic'}</span></div><ul class="topic-grid">${tile(null)}${shown.map(tile).join('')}</ul>${more.length ? `<details class="topic-more"><summary>${fa ? 'دسته‌های بیشتر' : 'More categories'}</summary><ul class="topic-grid">${more.map(tile).join('')}</ul></details>` : ''}</nav>`;
}

export function renderList(lang, origin, { items, total, page, section, query, size, categories, staticPreview = false }) {
  const c = labels[lang], fa = lang === 'fa';
  const category = categories.find(({ slug }) => slug === section);
  const categoryTitle = categoryName(category, lang);
  const description = categoryDescription(category, lang) || c.intro;
  const canonical = listUrl(lang, page, section);
  const alternates = Object.fromEntries(['fa', 'en'].map((l) => [l, listUrl(l, page, section)]));
  const number = (value) => new Intl.NumberFormat(lang).format(value);
  const bySlug = new Map(categories.map((entry) => [entry.slug, entry]));
  const card = (item) => {
    const t = item[lang], topic = bySlug.get(item.section);
    const theme = topic?.theme || 'mint';
    return `<article class="journal-card" data-theme="${theme}"><a class="journal-card-cover" href="${articlePath(lang, item)}" tabindex="-1" aria-hidden="true">${coverImage(lang, item, { decorative: true })}</a><div class="journal-card-body"><div class="journal-meta"><a href="${categoryPath(lang, item.section)}">${escape(categoryName(topic, lang))}</a><time datetime="${item.published}">${date(item.published, lang)}</time></div><h3><a href="${articlePath(lang, item)}">${escape(t.title)}</a></h3><p>${escape(t.excerpt)}</p><a class="read-link" href="${articlePath(lang, item)}" aria-label="${escape(`${c.read}: ${t.title}`)}">${c.read} ${icon('↗')}</a></div></article>`;
  };
  const search = staticPreview ? '' : `<form action="${listUrl(lang, 1, section)}" method="get" class="journal-search" role="search"><label class="sr-only" for="journal-search">${c.search}</label><input id="journal-search" type="search" name="q" maxlength="100" placeholder="${c.search}" value="${escape(query)}"><button class="button button-primary button-small" type="submit">${c.searchButton}</button>${query ? `<a class="button button-muted button-small" href="${listUrl(lang, 1, section)}" aria-label="${fa ? 'پاک‌کردن جست‌وجو' : 'Clear search'}">×</a>` : ''}</form>`;
  const featured = !category && !query && page === 1 ? items[0] : undefined;
  const header = `<section class="journal-hero${featured ? '' : ' journal-hero-compact'}"><div class="shell journal-hero-grid"><div><div class="eyebrow"><span class="signal"></span>${category ? (fa ? 'دستهٔ مجله' : 'Journal category') : c.tagline}</div><h1>${escape(categoryTitle || c.title)}</h1><p>${escape(description)}</p>${search}</div>${featured ? featuredCover(lang, featured) : ''}</div></section>`;
  const resultsTitle = query ? (fa ? 'نتایج جست‌وجو' : 'Search results') : category ? (fa ? 'نوشته‌های این دسته' : 'Articles in this category') : c.latest;
  const body = `${top(lang, alternates[otherLang(lang)])}<main id="journal">${header}${categoryNavigation(lang, categories, section, query, categories.reduce((sum, entry) => sum + entry.count, 0))}
  <section class="shell journal-list" aria-labelledby="latest"><div class="journal-list-head"><h2 id="latest">${resultsTitle}</h2><span class="journal-count">${number(total)} ${fa ? 'نوشته' : total === 1 ? 'article' : 'articles'}</span></div>${items.length ? `<div class="journal-cards">${items.map(card).join('')}</div>` : `<p class="journal-empty">${c.empty}</p>`}${pagination({ page, total, size, lang, href: (n) => listUrl(lang, n, section, query) })}</section></main>${footer(lang)}`;
  return documentPage({ lang, origin, title: `${categoryTitle ? `${categoryTitle} | ` : ''}${c.name}${page > 1 ? ` • ${number(page)}` : ''}`, description, canonical, alternates, noindex: Boolean(query || (category && !category.count)), body,
    schema: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: categoryTitle || c.name, url: new URL(canonical, origin).href, inLanguage: lang } });
}

export function renderArticle(lang, origin, item, related = [], preview = false, category = defaultCategories.find(({ slug }) => slug === item.section)) {
  const c = labels[lang], t = item[lang], canonical = articlePath(lang, item);
  const alternates = Object.fromEntries(['fa', 'en'].map((l) => [l, articlePath(l, item)]));
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BlogPosting', mainEntityOfPage: new URL(canonical, origin).href, headline: t.title, description: t.description, datePublished: item.published, dateModified: item.modified, inLanguage: lang, articleSection: categoryName(category, lang), image: [new URL(coverSrc(item), origin).href], author: { '@type': 'Organization', name: item.author }, publisher: { '@type': 'Organization', name: 'OminiCorp', logo: { '@type': 'ImageObject', url: new URL('/assets/media/logo.webp', origin).href } }, keywords: t.tags.join(', '), citation: item.sources.map((entry) => entry.url) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: c.name, item: new URL(listPath(lang), origin).href }, { '@type': 'ListItem', position: 2, name: t.title, item: new URL(canonical, origin).href }] },
  ] };
  const body = `${top(lang, preview ? `/admin/articles/${item.id}/preview/${otherLang(lang)}` : alternates[otherLang(lang)])}<main id="journal" class="shell article-page">${preview ? `<p class="desk-notice"><a href="/admin/articles/${item.id}">${lang === 'fa' ? 'پیش‌نمایش خصوصی · بازگشت به ویرایشگر' : 'Private preview · Back to editor'}</a></p>` : ''}<article><header class="article-header"><a class="read-link" href="${listPath(lang)}">${icon(lang === 'fa' ? '→' : '←')} ${c.back}</a><div class="journal-meta"><a href="${categoryPath(lang, item.section)}">${escape(categoryName(category, lang))}</a><time datetime="${item.published}">${date(item.published, lang)}</time><span>${new Intl.NumberFormat(lang).format(minutes(t.body))} ${c.time}</span></div><h1>${escape(t.title)}</h1><p>${escape(t.excerpt)}</p><div class="article-byline"><span class="signal"></span><bdi>${escape(item.author)}</bdi></div></header><div class="article-cover">${coverImage(lang, item, { preview, eager: true })}</div><div class="article-content">${renderMarkdown(t.body, preview)}${item.sources.length ? `<aside class="article-sources"><h2>${c.sources}</h2><ul>${item.sources.map((entry) => `<li><a href="${escape(entry.url)}" rel="external noreferrer"><bdi>${escape(entry.title)}</bdi></a></li>`).join('')}</ul></aside>` : ''}<ul class="article-tags">${t.tags.map((tag) => `<li>${escape(tag)}</li>`).join('')}</ul></div></article>${related.length ? `<aside class="journal-related"><h2>${lang === 'fa' ? 'بیشتر بخوانید' : 'Read next'}</h2>${related.map((other) => `<a href="${articlePath(lang, other)}">${escape(other[lang].title)} ${icon('↗')}</a>`).join('')}</aside>` : ''}</main>${footer(lang)}`;
  return documentPage({ lang, title: t.seoTitle, description: t.description, origin, canonical: preview ? null : canonical, alternates: preview ? null : alternates, type: 'article', schema: preview ? null : schema, noindex: preview, article: item, socialImage: coverSrc(item), body });
}

export function renderMissing(lang, origin) {
  const c = labels[lang];
  return documentPage({ lang, origin, title: c.missing, noindex: true, body: `${top(lang, listPath(otherLang(lang)))}<main id="journal" class="shell journal-list"><h1>${c.missing}</h1><p>${c.error}</p><a class="read-link" href="${listPath(lang)}">${c.back}</a></main>${footer(lang)}` });
}

export function sitemap(origin, rows, enabled = true, categories = []) {
  const paths = (path) => escape(new URL(path, origin).href);
  const index = { fa: '/blog', en: '/en/blog' };
  const pairs = [{ fa: '/', en: '/en.html' }, ...(enabled ? [index, ...categories.filter(({ count }) => count > 0).map(({ slug }) => ({ fa: categoryPath('fa', slug), en: categoryPath('en', slug) }))] : []), ...rows.map((row) => ({ fa: `${index.fa}/${encodeURIComponent(row.fa_slug)}`, en: `${index.en}/${encodeURIComponent(row.en_slug)}`, lastmod: row.modified }))];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${pairs.flatMap((pair) => ['fa', 'en'].map((lang) => `<url><loc>${paths(pair[lang])}</loc>${pair.lastmod ? `<lastmod>${escape(pair.lastmod)}</lastmod>` : ''}${['fa', 'en', 'x-default'].map((alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${paths(pair[alt === 'x-default' ? 'fa' : alt])}"/>`).join('')}</url>`)).join('')}</urlset>`;
}
