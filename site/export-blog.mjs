import { articlePath, listPath, renderArticle, renderList, sitemap } from '../server/blog/render.mjs';
import { sampleDate, seed } from '../server/blog/seed.mjs';

export function exportBlog(origin) {
  const articles = seed.map((article, offset) => ({ ...article, id: offset + 1, published: sampleDate, modified: sampleDate }));
  const output = new Map();
  for (const lang of ['fa', 'en']) {
    output.set(`${listPath(lang).slice(1)}/index.html`, renderList(lang, origin, { items: articles, total: articles.length, page: 1, section: '', query: '', size: 9, staticPreview: true }));
    for (const article of articles) {
      const file = `${decodeURIComponent(articlePath(lang, article).slice(1))}/index.html`;
      output.set(file, renderArticle(lang, origin, article, articles.filter((item) => item !== article)));
    }
  }
  output.set('robots.txt', `User-agent: *\nDisallow: /admin\nDisallow: /mcp\nSitemap: ${origin}/sitemap.xml\n`);
  output.set('sitemap.xml', sitemap(origin, articles.map((article) => ({ fa_slug: article.fa.slug, en_slug: article.en.slug, modified: sampleDate }))));
  return output;
}
