import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const hash = (token) => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const day = 24 * 60 * 60 * 1000;

export function openSubscribers(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 4000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE subscribers (
        email TEXT PRIMARY KEY NOT NULL,
        requested_at INTEGER NOT NULL,
        confirmed_at INTEGER,
        confirmation TEXT UNIQUE,
        unsubscribe TEXT UNIQUE NOT NULL
      ) STRICT;
      CREATE INDEX subscribers_expiry ON subscribers (requested_at) WHERE confirmed_at IS NULL;
      PRAGMA user_version = 1;
      COMMIT;`);
  } else if (version !== 1) {
    db.close();
    throw new Error('Unsupported subscribers database version');
  }
  const purge = db.prepare('DELETE FROM subscribers WHERE confirmed_at IS NULL AND requested_at < ?');
  const reserve = db.prepare(`INSERT INTO subscribers (email, requested_at, confirmation, unsubscribe) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET requested_at=excluded.requested_at, confirmation=excluded.confirmation, unsubscribe=excluded.unsubscribe
    WHERE subscribers.confirmed_at IS NULL AND subscribers.requested_at <= ?`);
  const cancel = db.prepare('DELETE FROM subscribers WHERE confirmation = ? AND confirmed_at IS NULL');
  const confirm = db.prepare('UPDATE subscribers SET confirmed_at = ?, confirmation = NULL WHERE confirmation = ? AND requested_at >= ? AND confirmed_at IS NULL');
  const remove = db.prepare('DELETE FROM subscribers WHERE unsubscribe = ?');
  const list = db.prepare('SELECT email FROM subscribers WHERE confirmed_at IS NOT NULL ORDER BY email');

  const purgeExpired = (now = Date.now()) => purge.run(now - 2 * day);
  purgeExpired();

  return {
    purgeExpired,
    reserve(email, now = Date.now()) {
      purgeExpired(now);
      const confirmToken = token();
      const optOutToken = token();
      const inserted = reserve.run(email, now, hash(confirmToken), hash(optOutToken), now - 15 * 60 * 1000);
      return inserted.changes ? { confirmToken, optOutToken } : null;
    },
    cancel: (value) => cancel.run(hash(value)),
    confirm: (value, now = Date.now()) => Boolean(confirm.run(now, hash(value), now - 2 * day).changes),
    remove: (value) => Boolean(remove.run(hash(value)).changes),
    list: () => list.all().map(({ email }) => email),
    close: () => db.close(),
  };
}
