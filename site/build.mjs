import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { render } from './render.mjs';
import { exportBlog } from './export-blog.mjs';

const check = process.argv.includes('--check');
const root = new URL('../', import.meta.url);
const domain = (await readFile(new URL('CNAME', root), 'utf8')).trim();
const files = new Map([['index.html', render('fa')], ['en.html', render('en')], ...exportBlog(`https://${domain}`)]);
for (const [file, html] of files) {
  const url = new URL(file, root);
  if (!check) {
    await mkdir(new URL('.', url), { recursive: true });
    await writeFile(url, html);
  } else if (await readFile(url, 'utf8').catch(() => '') !== html) {
    console.error(`${file} is out of date. Run npm run build.`);
    process.exitCode = 1;
  }
}
