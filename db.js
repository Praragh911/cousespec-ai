const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// server.js requires this file before it creates the data folder, so make it here too
const dir = process.env.VERCEL
    ? "/tmp/coursespec-data"
    : path.join(__dirname, "data");

fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(dir, "coursespec.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'Quality Coordinator',
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audits (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id      TEXT NOT NULL,
  data    TEXT NOT NULL,   -- the whole audit object as JSON
  updated TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
`);

const q = {
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    userCount: db.prepare("SELECT COUNT(*) AS n FROM users"),
    userInsert: db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)"),
    auditGet: db.prepare("SELECT data FROM audits WHERE user_id = ? AND id = ?"),
    auditList: db.prepare("SELECT data FROM audits WHERE user_id = ?"),
    auditUpsert: db.prepare(`INSERT INTO audits (user_id, id, data, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated`),
    auditDelete: db.prepare("DELETE FROM audits WHERE user_id = ? AND id = ?"),
};

module.exports = {
    createUser: (name, email, hash) => Number(q.userInsert.run(name, email, hash).lastInsertRowid),
    getUserById: (id) => q.userById.get(id),
    getUserByEmail: (email) => q.userByEmail.get(email),
    countUsers: () => q.userCount.get().n,

    getAudit: (uid, id) => { const r = q.auditGet.get(uid, id); return r ? JSON.parse(r.data) : null; },
    listAudits: (uid) => q.auditList.all(uid).map((r) => JSON.parse(r.data)),
    saveAudit: (uid, a) => { q.auditUpsert.run(uid, a.id, JSON.stringify(a), a.updated); },
    deleteAudit: (uid, id) => { q.auditDelete.run(uid, id); },
};
