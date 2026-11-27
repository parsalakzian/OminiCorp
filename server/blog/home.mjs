import { categoryName } from './categories.mjs';
import { escape } from './escape.mjs';
import { articlePath, coverSrc, listPath } from './render.mjs';

export const latestArticleCount = 3;
export const siteHomeImages = ['/assets/media/hero.webp', '/assets/media/logo.webp'];
export const homePath = (lang) => lang === 'fa' ? '/' : '/en.html';

const copy = {
  fa: { kicker: 'مجلهٔ اومینی‌کورپ', title: 'تازه‌ترین نوشته‌ها', intro: 'راهنماها و تحلیل‌های تازه دربارهٔ فناوری، امنیت و طراحی محصول.', all: 'همهٔ نوشته‌ها', latest: 'تازه‌ترین' },
  en: { kicker: 'OminiCorp Journal', title: 'Latest articles', intro: 'Fresh guides and perspectives on technology, security, and product design.', all: 'Browse the journal', latest: 'Latest' },
};

export function renderLatestArticles(lang, items = [], categories = []) {
  if (!items.length) return '';
  const c = copy[lang];
  const bySlug = new Map(categories.map((value) => [value.slug, value]));
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
  const card = (item, index) => {
    const article = item[lang];
    const topic = categoryName(bySlug.get(item.section), lang);
    return `<article class="home-journal-card"><a href="${articlePath(lang, item)}" class="home-journal-link" aria-labelledby="home-journal-title-${item.id}">
      <div class="home-journal-cover"><img src="${escape(coverSrc(item))}" alt="" loading="lazy" decoding="async">${index === 0 ? `<span class="home-journal-badge">${c.latest}</span>` : ''}</div>
      <div class="home-journal-copy"><div class="home-journal-meta">${topic ? `<span>${escape(topic)}</span>` : ''}<time datetime="${escape(item.published)}">${date.format(new Date(item.published))}</time></div>
        <h3 id="home-journal-title-${item.id}">${escape(article.title)}</h3><p>${escape(article.excerpt)}</p></div></a></article>`;
  };
  return `<section class="home-journal" aria-labelledby="home-journal-title"><div class="shell panel-section">
    <div class="home-journal-head"><div><div class="eyebrow"><span class="signal" aria-hidden="true"></span>${c.kicker}</div><h2 id="home-journal-title">${c.title}</h2><p>${c.intro}</p></div>
    <a class="button button-outline" href="${listPath(lang)}">${c.all}<span aria-hidden="true">↗</span></a></div>
    <div class="home-journal-grid">${items.slice(0, latestArticleCount).map(card).join('')}</div></div></section>`;
}
