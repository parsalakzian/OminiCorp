export function openOAuthStore(db, version) {
  if (version < 4) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE oauth_client (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect TEXT NOT NULL, auth TEXT NOT NULL,
      secret TEXT NOT NULL DEFAULT '', writeAccess INTEGER NOT NULL CHECK(writeAccess IN (0,1)),
      publishAccess INTEGER NOT NULL CHECK(publishAccess IN (0,1))) STRICT;
    CREATE TABLE oauth_grant (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_client(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('code','access','refresh')), expires INTEGER NOT NULL,
      resource TEXT NOT NULL, owner_hash TEXT NOT NULL, redirect TEXT NOT NULL DEFAULT '', challenge TEXT NOT NULL DEFAULT '',
      flow TEXT NOT NULL) STRICT;
    CREATE INDEX oauth_expiry ON oauth_grant(expires);
    CREATE INDEX oauth_client_grants ON oauth_grant(client_id);
    CREATE INDEX oauth_flow ON oauth_grant(flow);
    PRAGMA user_version=4; COMMIT;`);
  const find = db.prepare('SELECT * FROM oauth_client WHERE id=?');
  const grant = db.prepare('SELECT * FROM oauth_grant WHERE hash=? AND kind=? AND expires>?');
  const insert = db.prepare('INSERT INTO oauth_grant(hash,client_id,kind,expires,resource,owner_hash,redirect,challenge,flow) VALUES(?,?,?,?,?,?,?,?,?)');
  const remove = db.prepare('DELETE FROM oauth_grant WHERE hash=?');
  const prune = db.prepare('DELETE FROM oauth_grant WHERE expires<=?');
  const put = ({ hash, client_id, kind, expires, resource, owner_hash, redirect = '', challenge = '', flow }) => insert.run(hash, client_id, kind, expires, resource, owner_hash, redirect, challenge, flow);
  return {
    getClient: (id) => find.get(id),
    clients: () => db.prepare('SELECT id,name,redirect,auth,writeAccess,publishAccess FROM oauth_client ORDER BY id').all(),
    hasClients: () => Boolean(db.prepare('SELECT 1 FROM oauth_client LIMIT 1').get()),
    addClient: ({ id, name, redirect, auth, secret, writeAccess, publishAccess }) => db.prepare('INSERT OR IGNORE INTO oauth_client VALUES(?,?,?,?,?,?,?)').run(id, name, redirect, auth, secret, Number(writeAccess), Number(publishAccess)).changes === 1,
    removeClient: (id) => db.prepare('DELETE FROM oauth_client WHERE id=?').run(id).changes === 1,
    getGrant: (hash, kind, now) => grant.get(hash, kind, now),
    putCode(value, now) { prune.run(now); put(value); },
    exchange(hash, kind, now, verify, issue) {
      db.exec('BEGIN IMMEDIATE');
      try {
        prune.run(now);
        const value = grant.get(hash, kind, now);
        const valid = value && verify(value);
        if (valid) {
          remove.run(hash);
          if (kind === 'refresh') db.prepare("DELETE FROM oauth_grant WHERE flow=? AND kind='access'").run(value.flow);
          for (const row of issue(value)) put(row);
        }
        db.exec('COMMIT');
        return Boolean(valid);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
