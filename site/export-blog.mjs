import { articlePath, categoryPath, listPath, renderArticle, renderList, sitemap } from '../server/blog/render.mjs';
import { defaultCategories } from '../server/blog/categories.mjs';
import { sampleDate, seed } from '../server/blog/seed.mjs';

export function exportBlog(origin) {
  const articles = seed.map((article, offset) => ({ ...article, id: offset + 1, published: sampleDate, modified: sampleDate })).reverse();
  const categories = defaultCategories.map((entry) => ({ ...entry, count: articles.filter((item) => item.section === entry.slug).length }));
  const output = new Map();
  for (const lang of ['fa', 'en']) {
    for (const section of ['', ...categories.map(({ slug }) => slug)]) {
      const path = section ? categoryPath(lang, section) : listPath(lang);
      const items = articles.filter((item) => !section || item.section === section);
      output.set(`${path.slice(1)}/index.html`, renderList(lang, origin, { items, total: items.length, page: 1, section, query: '', size: 6, categories, staticPreview: true }));
    }
    for (const article of articles) {
      const file = `${decodeURIComponent(articlePath(lang, article).slice(1))}/index.html`;
      output.set(file, renderArticle(lang, origin, article, articles.filter((item) => item !== article)));
    }
  }
  output.set('robots.txt', `User-agent: *\nDisallow: /admin\nDisallow: /mcp\nSitemap: ${origin}/sitemap.xml\n`);
  output.set('sitemap.xml', sitemap(origin, articles.map((article) => ({ fa_slug: article.fa.slug, en_slug: article.en.slug, modified: sampleDate })), true, categories));
  return output;
}
