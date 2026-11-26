import { escape } from './escape.mjs';

export const pageCount = (total, size) => Math.max(1, Math.ceil(total / size));
export function pagination({ page, total, size, href, lang = 'fa' }) {
  const last = pageCount(total, size);
  if (last === 1 && page === 1) return '';
  const fa = lang === 'fa', number = (value) => new Intl.NumberFormat(lang).format(value);
  const link = (n, text, label, rel) => `<a class="page-step" href="${escape(href(n))}" aria-label="${escape(label)}"${rel ? ` rel="${rel}"` : ''}>${text}</a>`;
  const pages = [...new Set([1, page - 1, page, page + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  return `<nav class="journal-pagination page-controls" aria-label="${fa ? 'صفحه‌بندی' : 'Pagination'}">${page > 1 ? link(Math.min(last, page - 1), fa ? '→' : '←', fa ? 'صفحهٔ قبل' : 'Previous page', 'prev') : ''}${pages.map((n, i) => `${i && n > pages[i - 1] + 1 ? '<span aria-hidden="true">…</span>' : ''}${n === page ? `<span class="page-step is-current" aria-current="page">${number(n)}</span>` : link(n, number(n), `${fa ? 'صفحهٔ' : 'Page'} ${number(n)}`)}`).join('')}${page < last ? link(page + 1, fa ? '←' : '→', fa ? 'صفحهٔ بعد' : 'Next page', 'next') : ''}</nav>`;
}
