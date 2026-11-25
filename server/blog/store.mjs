import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { articleSchema, defaults, normalizeSource, settingsSchema, titleKey } from './schema.mjs';
import { constantEqual, defaultSystem } from '../installation.mjs';
import { sampleDate, seed } from './seed.mjs';

export class BlogConflict extends Error {}

export function openBlog(path, { seedContent = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (![0, 1].includes(version)) { db.close(); throw new Error('Unsupported blog schema version'); }
  if (!version) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE articles (id INTEGER PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('draft','published')),
      section TEXT NOT NULL, fa_slug TEXT NOT NULL UNIQUE, en_slug TEXT NOT NULL UNIQUE,
      fa_search TEXT NOT NULL, en_search TEXT NOT NULL, payload TEXT NOT NULL,
      published TEXT, modified TEXT NOT NULL) STRICT;
    CREATE INDEX article_publication ON articles(state, published DESC, id DESC);
    CREATE INDEX article_section ON articles(state, section, published DESC);
    CREATE TABLE sources (url TEXT PRIMARY KEY, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, title_key TEXT NOT NULL) STRICT;
    CREATE INDEX sources_article ON sources(article_id);
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    PRAGMA user_version=1; COMMIT;`);
  const parse = (row) => row && ({ ...JSON.parse(row.payload), id: row.id, published: row.published, modified: row.modified });
  const find = (id) => parse(db.prepare('SELECT * FROM articles WHERE id=?').get(id));
  const sourceUrl = db.prepare('SELECT article_id FROM sources WHERE url=?');
  const titles = db.prepare('SELECT DISTINCT title_key FROM sources');
  const meta = (key) => { const found = db.prepare('SELECT value FROM metadata WHERE key=?').get(key); return found ? JSON.parse(found.value) : undefined; };
  const setMeta = (key, value) => db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));

  function save(input, id, now = new Date().toISOString()) {
    const item = articleSchema.parse(input);
    const old = id && find(id);
    if (id && !old) return null;
    if (old?.published && (old.fa.slug !== item.fa.slug || old.en.slug !== item.en.slug)) {
      const error = new BlogConflict('Published slugs are immutable');
      error.kind = 'slug-locked';
      throw error;
    }
    const published = old?.published || (item.state === 'published' ? now : null);
    const columns = [item.state, item.section, item.fa.slug, item.en.slug,
      titleKey(`${item.fa.title} ${item.fa.excerpt} ${item.fa.tags.join(' ')}`), titleKey(`${item.en.title} ${item.en.excerpt} ${item.en.tags.join(' ')}`),
      JSON.stringify(item), published, now];
    db.exec('BEGIN IMMEDIATE');
    try {
      if (id) {
        db.prepare('UPDATE articles SET state=?,section=?,fa_slug=?,en_slug=?,fa_search=?,en_search=?,payload=?,published=?,modified=? WHERE id=?').run(...columns, id);
        db.prepare('DELETE FROM sources WHERE article_id=?').run(id);
      } else {
        id = db.prepare('INSERT INTO articles(state,section,fa_slug,en_slug,fa_search,en_search,payload,published,modified) VALUES(?,?,?,?,?,?,?,?,?)').run(...columns).lastInsertRowid;
      }
      const insert = db.prepare('INSERT INTO sources VALUES(?,?,?)');
      const links = new Map(item.sources.map((entry) => [normalizeSource(entry.url), titleKey(entry.title)]));
      for (const [url, title] of links) insert.run(url, id, title);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (error.errcode === 2067 || error.errcode === 1555) throw new BlogConflict('Slug or source is already assigned to another article.');
      throw error;
    }
    return find(id);
  }

  if (!meta('initialized')) {
    if (seedContent && !db.prepare('SELECT 1 FROM articles LIMIT 1').get()) seed.forEach((item) => save(item, undefined, sampleDate));
    setMeta('initialized', true);
  }

  return {
    find, save,
    list({ lang = 'fa', query = '', section = '', page = 1, size = 9, admin = false } = {}) {
      const langField = lang === 'en' ? 'en_search' : 'fa_search';
      const filter = `WHERE (? OR state='published') AND (?='' OR section=?) AND (?='' OR instr(${langField},?)>0)`;
      const terms = [Number(admin), section, section, titleKey(query), titleKey(query)];
      const total = db.prepare(`SELECT count(*) AS count FROM articles ${filter}`).get(...terms).count;
      const items = db.prepare(`SELECT * FROM articles ${filter} ORDER BY ${admin ? 'modified' : 'published'} DESC,id DESC LIMIT ? OFFSET ?`).all(...terms, size, (page - 1) * size).map(parse);
      return { items, total };
    },
    lookup(lang, slug) { return parse(db.prepare(`SELECT * FROM articles WHERE state='published' AND ${lang === 'en' ? 'en_slug' : 'fa_slug'}=?`).get(slug)); },
    published() { return db.prepare("SELECT fa_slug,en_slug,modified FROM articles WHERE state='published'").all(); },
    remove(id) { return Boolean(db.prepare('DELETE FROM articles WHERE id=?').run(id).changes); },
    hasSource: (url) => Boolean(sourceUrl.get(normalizeSource(url))),
    sourceTitles: () => titles.all().map((row) => row.title_key),
    articleTitles: () => db.prepare("SELECT json_extract(payload,'$.fa.title') AS fa,json_extract(payload,'$.en.title') AS en FROM articles").all().map((entry) => ({ fa: titleKey(entry.fa), en: titleKey(entry.en) })),
    getSystem: () => ({ ...defaultSystem, ...meta('system') }),
    setSystem: (value) => setMeta('system', value),
    getOwner: () => meta('owner'),
    setOwner: (value) => setMeta('owner', value),
    issueSetup(hash, expires) {
      if (meta('owner')) return false;
      setMeta('setup', { hash, expires });
      return true;
    },
    verifySetup(hash, now = Date.now()) {
      const setup = meta('setup');
      return !meta('owner') && setup?.expires > now && constantEqual(setup.hash, hash);
    },
    finishSetup(hash, owner, siteUrl) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const setup = meta('setup');
        if (meta('owner') || !setup || setup.expires <= Date.now() || !constantEqual(setup.hash, hash)) {
          db.exec('ROLLBACK');
          return false;
        }
        setMeta('owner', owner);
        setMeta('system', { ...defaultSystem, ...meta('system'), siteUrl });
        db.prepare("DELETE FROM metadata WHERE key='setup'").run();
        db.exec('COMMIT');
        return true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    getSettings: () => ({ ...defaults, ...meta('settings') }),
    saveConfiguration(settings, system) {
      const validated = settingsSchema.parse(settings);
      db.exec('BEGIN IMMEDIATE');
      try {
        setMeta('settings', validated);
        setMeta('system', system);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    setSettings(value) { const settings = settingsSchema.parse(value); setMeta('settings', settings); return settings; },
    getRun: () => meta('run'),
    setRun: (value) => setMeta('run', value),
    close: () => db.close(),
  };
}
