// https://github.com/oven-sh/bun/issues/1366
import { Database } from "bun:sqlite";
import { rmSync } from "fs";

const dir = process.env.SQLITE_DIR;

rmSync(dir + "get-persist.sqlite", { force: true });

var db = Database.open(dir + "get-persist.sqlite", { create: true });

// Note, I've played with various values and it doesn't seem to change
// the behavior. The "beter-sqlite3" npm package does not exhibit this
// bug, so it doesn't seem to be a general SQLite thing.
db.run(`PRAGMA journal_mode = WAL`);
db.run(`PRAGMA synchrounous = NORMAL`);

db.run(
  `CREATE TABLE IF NOT EXISTS examples (
    id TEXT PRIMARY KEY
  )`,
);

// This persists, but if you place this call
db.run(
  `
    INSERT INTO examples
    VALUES ('hello')
    ON CONFLICT (id) DO
      UPDATE SET id='hello'
    RETURNING id
  `,
);

db.query(`SELECT id FROM examples WHERE id='hello'`).get().id;
db.query(
  `
INSERT INTO examples
VALUES ('world')
ON CONFLICT (id) DO
  UPDATE SET id='world'
RETURNING id
`,
).get();

process.exit(0);
