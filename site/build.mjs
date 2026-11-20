import { readFile, writeFile } from 'node:fs/promises';
import { render } from './render.mjs';

const check = process.argv.includes('--check');
for (const [language, file] of [['fa', 'index.html'], ['en', 'en.html']]) {
  const url = new URL(`../${file}`, import.meta.url);
  const html = render(language);
  if (!check) {
    await writeFile(url, html);
  } else if (await readFile(url, 'utf8') !== html) {
    console.error(`${file} is out of date. Run npm run build.`);
    process.exitCode = 1;
  }
}
