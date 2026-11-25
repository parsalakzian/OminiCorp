import MarkdownIt from 'markdown-it';
import { mediaFromPath, mediaPreview } from './media.mjs';

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: true });
for (const name of ['heading_open', 'heading_close']) {
  const original = markdown.renderer.rules[name];
  markdown.renderer.rules[name] = (tokens, i, options, env, renderer) => {
    if (tokens[i].tag === 'h1') tokens[i].tag = 'h2';
    return original ? original(tokens, i, options, env, renderer) : renderer.renderToken(tokens, i, options);
  };
}
const image = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, i, options, env, renderer) => {
  const token = tokens[i];
  const id = mediaFromPath(token.attrGet('src'));
  if (!id) return markdown.utils.escapeHtml(renderer.renderInlineAsText(token.children, options, env));
  if (env.preview) token.attrSet('src', mediaPreview(id));
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  return image(tokens, i, options, env, renderer);
};

export const renderMarkdown = (body, preview) => markdown.render(body, { preview });
export function referencedImages(body) {
  const ids = new Set();
  for (const token of markdown.parse(body, {})) {
    for (const child of token.children || []) {
      if (child.type !== 'image') continue;
      const id = mediaFromPath(child.attrGet('src'));
      if (id) ids.add(id);
    }
  }
  return ids;
}
