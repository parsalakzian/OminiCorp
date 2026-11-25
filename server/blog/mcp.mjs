import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { articleSchema, sections } from './schema.mjs';
import { BlogConflict } from './store.mjs';

const result = (value, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError } : {}) });
const problem = (error) => result({ error }, true);
const id = z.number().int().positive();
const readOnly = { readOnlyHint: true, openWorldHint: false };

export async function handleMcp(req, res, body, { store, automation }) {
  const settings = store.getSettings();
  const mcp = new McpServer({ name: 'ominicorp-journal', version: '1.0.0' });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const register = (name, description, inputSchema, annotations, handler) => mcp.registerTool(name, { description, inputSchema, annotations }, async (data) => {
    try { return await handler(data); }
    catch (error) { return problem(error instanceof BlogConflict ? error.message : 'Editorial operation failed.'); }
  });
  function writeAllowed() { const state = store.getSettings(); return state.enabled && state.mcp && state.mcpWrite; }
  function publishAllowed() { return writeAllowed() && store.getSettings().mcpPublish; }
  register('list_articles', 'List journal articles with Persian and English metadata. Drafts are only available when MCP write access is enabled.', z.object({ lang: z.enum(['fa', 'en']).default('fa'), query: z.string().max(100).default(''), section: z.enum(sections).optional(), page: z.number().int().min(1).max(10000).default(1) }), readOnly, ({ lang, query, section, page }) => {
    const { items, total } = store.list({ lang, query, section, page, size: 15, admin: writeAllowed() });
    return result({ total, page, items: items.map(({ fa, en, ...item }) => ({ ...item, fa: { ...fa, body: undefined }, en: { ...en, body: undefined } })) });
  });
  register('get_article', 'Read both complete language versions of an article and its SEO and publication details.', z.object({ id }), readOnly, (input) => {
    const item = store.find(input.id);
    return item && (item.state === 'published' || writeAllowed()) ? result({ article: item }) : problem('Article not found.');
  });
  if (settings.mcpWrite) {
    register('create_article', 'Create a bilingual draft using the complete editorial schema. Use publish_article to publish.', z.object({ article: articleSchema.omit({ state: true }) }), { destructiveHint: false, openWorldHint: false }, ({ article }) => writeAllowed() ? result({ article: store.save({ ...article, state: 'draft' }) }) : problem('Write access is disabled.'));
    register('update_article', 'Replace both language versions and metadata without changing the publication state.', z.object({ id, article: articleSchema.omit({ state: true }) }), { idempotentHint: true, openWorldHint: false }, (input) => {
      if (!writeAllowed()) return problem('Write access is disabled.');
      const old = store.find(input.id);
      if (!old) return problem('Article not found.');
      if (old.state === 'published' && !publishAllowed()) return problem('Editing live content requires publishing access.');
      return result({ article: store.save({ ...input.article, state: old.state }, input.id) });
    });
    register('delete_article', 'Permanently remove an article and both translations.', z.object({ id }), { destructiveHint: true, openWorldHint: false }, (input) => {
      if (!writeAllowed()) return problem('Write access is disabled.');
      if (store.find(input.id)?.state === 'published' && !publishAllowed()) return problem('Removing live content requires publishing access.');
      return result({ removed: store.remove(input.id) });
    });
    if (settings.ai) register('generate_articles', 'Read current configured RSS/Atom feeds and create new bilingual drafts. Never publishes.', z.object({ limit: z.number().int().min(1).max(3).default(1) }), { destructiveHint: false, openWorldHint: true }, async ({ limit }) => writeAllowed() ? result(await automation.run({ articleLimit: limit })) : problem('Write access is disabled.'));
  }
  if (settings.mcpWrite && settings.mcpPublish) {
    register('publish_article', 'Publish or unpublish both complete language versions at the same time.', z.object({ id, published: z.boolean() }), { idempotentHint: true, destructiveHint: true, openWorldHint: false }, (input) => {
      if (!publishAllowed()) return problem('Publishing access is disabled.');
      const item = store.find(input.id);
      return item ? result({ article: store.save({ ...item, state: input.published ? 'published' : 'draft' }, input.id) }) : problem('Article not found.');
    });
  }
  try { await mcp.connect(transport); await transport.handleRequest(req, res, body); }
  finally { await mcp.close(); }
}
