import { openOAuthStore } from './oauth-store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CategoryError, categorySchema, defaultCategories, maxCategories } from './categories.mjs';
import { articleSchema, defaults, normalizeSource, settingsSchema, titleKey } from './schema.mjs';
import { constantEqual, defaultSystem } from '../installation.mjs';
import { inspectImage, MediaError, mediaFromPath, mediaPath } from './media.mjs';
import { referencedImages } from './markdown.mjs';
import { sampleDate, seed } from './seed.mjs';

export class BlogConflict extends Error {}

export function openBlog(path, { seedContent = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=4000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (![0, 1, 2, 3, 4, 5, 6].includes(version)) { db.close(); throw new Error('Unsupported blog schema version'); }
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
  if (version < 2) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE media (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('image/png','image/jpeg','image/webp')),
      width INTEGER NOT NULL, height INTEGER NOT NULL, data BLOB NOT NULL, created TEXT NOT NULL,
      size INTEGER GENERATED ALWAYS AS (length(data)) STORED) STRICT;
    CREATE TABLE article_media (article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL REFERENCES media(id) ON DELETE RESTRICT, PRIMARY KEY(article_id, media_id)) STRICT;
    CREATE INDEX article_media_lookup ON article_media(media_id);
    PRAGMA user_version=2; COMMIT;`);
  if (version < 3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE categories (slug TEXT PRIMARY KEY, nameFa TEXT NOT NULL, nameEn TEXT NOT NULL,
        descriptionFa TEXT NOT NULL, descriptionEn TEXT NOT NULL, theme TEXT NOT NULL, position INTEGER NOT NULL) STRICT;
        CREATE INDEX article_category ON articles(section);
        CREATE TRIGGER article_category_insert BEFORE INSERT ON articles WHEN NOT EXISTS(SELECT 1 FROM categories WHERE slug=NEW.section)
          BEGIN SELECT RAISE(ABORT, 'Unknown article category'); END;
        CREATE TRIGGER article_category_update BEFORE UPDATE OF section ON articles WHEN NOT EXISTS(SELECT 1 FROM categories WHERE slug=NEW.section)
          BEGIN SELECT RAISE(ABORT, 'Unknown article category'); END;
        CREATE TRIGGER category_in_use BEFORE DELETE ON categories WHEN EXISTS(SELECT 1 FROM articles WHERE section=OLD.slug)
          BEGIN SELECT RAISE(ABORT, 'Category in use'); END;`);
      const addDefault = db.prepare('INSERT INTO categories VALUES(?,?,?,?,?,?,?)');
      for (const { slug, nameFa, nameEn, descriptionFa, descriptionEn, theme, position } of defaultCategories) {
        addDefault.run(slug, nameFa, nameEn, descriptionFa, descriptionEn, theme, position);
      }
      db.exec('PRAGMA user_version=3; COMMIT;');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  const oauth = openOAuthStore(db, version);
  const findCategory = (slug) => db.prepare('SELECT * FROM categories WHERE slug=?').get(slug);
  const categories = (admin = false) => db.prepare(`SELECT categories.*, (SELECT count(*) FROM articles
    WHERE section=categories.slug AND (?=1 OR state='published')) AS count FROM categories ORDER BY position, slug`).all(Number(admin));
  const mediaColumns = 'id, type, width, height, size, created';
  const mediaInfo = (row) => ({ ...row, url: mediaPath(row.id) });
  const mediaExists = db.prepare('SELECT 1 FROM media WHERE id=?');
  const parse = (row) => row && ({ cover: null, ...JSON.parse(row.payload), id: row.id, published: row.published, modified: row.modified });
  const find = (id) => parse(db.prepare('SELECT * FROM articles WHERE id=?').get(id));
  const sourceUrl = db.prepare('SELECT article_id FROM sources WHERE url=?');
  const titles = db.prepare('SELECT DISTINCT title_key FROM sources');
  const meta = (key) => { const found = db.prepare('SELECT value FROM metadata WHERE key=?').get(key); return found ? JSON.parse(found.value) : undefined; };
  const setMeta = (key, value) => db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));

  function save(input, id, now = new Date().toISOString()) {
    const old = id && find(id);
    const item = articleSchema.parse({ ...input, cover: input.cover === undefined ? old?.cover ?? null : input.cover });
    if (id && !old) return null;
    if (old?.published && (old.fa.slug !== item.fa.slug || old.en.slug !== item.en.slug)) {
      const error = new BlogConflict('Published slugs are immutable');
      error.kind = 'slug-locked';
      throw error;
    }
    const references = new Set([...referencedImages(item.fa.body), ...referencedImages(item.en.body)]);
    const coverId = mediaFromPath(item.cover?.src);
    if (coverId) references.add(coverId);
    const published = old?.published || (item.state === 'published' ? now : null);
    const columns = [item.state, item.section, item.fa.slug, item.en.slug,
      titleKey(`${item.fa.title} ${item.fa.excerpt} ${item.fa.tags.join(' ')}`), titleKey(`${item.en.title} ${item.en.excerpt} ${item.en.tags.join(' ')}`),
      JSON.stringify(item), published, now];
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!findCategory(item.section)) throw new CategoryError('Article category does not exist.');
      for (const imageId of references) if (!mediaExists.get(imageId)) throw new MediaError('Article refers to an image that is not in the media library.');
      if (id) {
        db.prepare('UPDATE articles SET state=?,section=?,fa_slug=?,en_slug=?,fa_search=?,en_search=?,payload=?,published=?,modified=? WHERE id=?').run(...columns, id);
        db.prepare('DELETE FROM sources WHERE article_id=?').run(id);
        db.prepare('DELETE FROM article_media WHERE article_id=?').run(id);
      } else {
        id = db.prepare('INSERT INTO articles(state,section,fa_slug,en_slug,fa_search,en_search,payload,published,modified) VALUES(?,?,?,?,?,?,?,?,?)').run(...columns).lastInsertRowid;
      }
      const insert = db.prepare('INSERT INTO sources VALUES(?,?,?)');
      const links = new Map(item.sources.map((entry) => [normalizeSource(entry.url), titleKey(entry.title)]));
      for (const [url, title] of links) insert.run(url, id, title);
      const attach = db.prepare('INSERT INTO article_media VALUES(?,?)');
      for (const imageId of references) attach.run(id, imageId);
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
    find, save, categories, findCategory,
    saveCategory(input, slug) {
      const value = categorySchema.parse(input);
      if (slug && slug !== value.slug) throw new CategoryError('A category slug cannot be changed.');
      const fields = [value.nameFa, value.nameEn, value.descriptionFa, value.descriptionEn, value.theme, value.position];
      if (slug) {
        if (!db.prepare('UPDATE categories SET nameFa=?, nameEn=?, descriptionFa=?, descriptionEn=?, theme=?, position=? WHERE slug=?').run(...fields, slug).changes) return null;
      } else {
        if (findCategory(value.slug)) throw new CategoryError('This category slug already exists.');
        const inserted = db.prepare('INSERT INTO categories SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM categories) < ? ON CONFLICT(slug) DO NOTHING').run(value.slug, ...fields, maxCategories).changes;
        if (!inserted) throw new CategoryError('Category limit reached or slug already exists.');
      }
      return findCategory(value.slug);
    },
    removeCategory(slug) {
      if (!findCategory(slug)) return false;
      try {
        const deleted = db.prepare('DELETE FROM categories WHERE slug=? AND (SELECT count(*) FROM categories)>1').run(slug).changes;
        if (!deleted) throw new CategoryError('Keep at least one category.');
        return true;
      } catch (error) {
        if (error.errcode === 1811) throw new CategoryError('Move articles to another category before deleting this one.');
        throw error;
      }
    },
    list({ lang = 'fa', query = '', section = '', page = 1, size = 9, admin = false, state = '', bilingual = false } = {}) {
      const langField = lang === 'en' ? 'en_search' : 'fa_search';
      const filter = `WHERE (? OR state='published') AND (?='' OR state=?) AND (?='' OR section=?) AND (?='' OR instr(${langField},?)>0 OR (? AND instr(en_search,?)>0))`;
      const term = titleKey(query);
      const terms = [Number(admin), state, state, section, section, term, term, Number(bilingual), term];
      const total = db.prepare(`SELECT count(*) AS count FROM articles ${filter}`).get(...terms).count;
      const items = db.prepare(`SELECT * FROM articles ${filter} ORDER BY ${admin ? 'modified' : 'published'} DESC,id DESC LIMIT ? OFFSET ?`).all(...terms, size, (page - 1) * size).map(parse);
      return { items, total };
    },
    lookup(lang, slug) { return parse(db.prepare(`SELECT * FROM articles WHERE state='published' AND ${lang === 'en' ? 'en_slug' : 'fa_slug'}=?`).get(slug)); },
    published() { return db.prepare("SELECT * FROM articles WHERE state='published' ORDER BY published DESC,id DESC").all().map(parse); },
    remove(id) { return Boolean(db.prepare('DELETE FROM articles WHERE id=?').run(id).changes); },
    uploadImage(data, declaredType) {
      const { id, type, width, height } = inspectImage(data, declaredType);
      db.prepare('INSERT INTO media(id,type,width,height,data,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
        .run(id, type, width, height, data, new Date().toISOString());
      const row = db.prepare(`SELECT ${mediaColumns} FROM media WHERE id=?`).get(id);
      return mediaInfo(row);
    },
    listImages(page = 1, size = 24) {
      const total = db.prepare('SELECT count(*) AS total FROM media').get().total;
      const items = db.prepare(`SELECT ${mediaColumns}, (SELECT count(*) FROM article_media WHERE media_id=media.id) AS used
        FROM media ORDER BY created DESC, id DESC LIMIT ? OFFSET ?`).all(size, (page - 1) * size).map(mediaInfo);
      return { items, total };
    },
    oauth,
    imageSize(id) { return db.prepare('SELECT width,height FROM media WHERE id=?').get(id); },
    getImage(id, publicOnly = false) {
      return db.prepare(`SELECT type,size,data FROM media WHERE id=? AND (?=0 OR EXISTS (
        SELECT 1 FROM article_media JOIN articles ON articles.id=article_id WHERE media_id=media.id AND state='published'))`).get(id, Number(publicOnly));
    },
    removeImage(id) {
      try { return Boolean(db.prepare('DELETE FROM media WHERE id=?').run(id).changes); }
      catch (error) {
        if (error.errcode === 1811 || error.errcode === 787) throw new MediaError('Image is in use by an article.');
        throw error;
      }
    },
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
