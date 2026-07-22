// Self-verifying bun:sqlite. A file-backed database (so real fs I/O and
// journaling engage - :memory: would dodge the syscalls) gets a known set of
// rows written through several paths (single inserts, a prepared statement
// in a transaction, blobs of incompressible bytes); everything is then read
// back and checked against what was written, and PRAGMA integrity_check must
// say ok. A journal/WAL write that came up short, or a page read that lied,
// surfaces as a WSF-CORRUPTION - a wrong answer sqlite handed the app - or
// as a SQLite error the app must survive without crashing.
import { Database } from "bun:sqlite";
import { promises as fsp } from "node:fs";
console.log("STAGE: setup");
let corrupt = 0;
const fail = msg => {
  corrupt++;
  console.log(`WSF-CORRUPTION: ${msg}`);
};
await fsp.rm("wsf-sq", { recursive: true, force: true });
await fsp.mkdir("wsf-sq", { recursive: true });

const payload = (n, seed) => {
  const b = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    b[i] = s >>> 24;
  }
  return b;
};
const sha = data => new Bun.CryptoHasher("sha256").update(data).digest("hex");

for (const mode of ["delete", "wal"]) {
  // one fresh database file per journal mode: never delete a database out
  // from under a handle that may still be settling
  const path = `wsf-sq/t-${mode}.db`;
  const db = new Database(path);
  db.exec(`PRAGMA journal_mode = ${mode};`);
  db.exec("CREATE TABLE kv (k INTEGER PRIMARY KEY, v TEXT, h TEXT)");
  db.exec("CREATE TABLE blobs (k INTEGER PRIMARY KEY, b BLOB, h TEXT)");

  // --- writes: single inserts, then a prepared statement in a transaction
  console.log(`STAGE: write-${mode}`);
  const N = 400;
  const expect = new Map();
  for (let k = 0; k < 100; k++) {
    const v = `row-${k}-` + "x".repeat(k % 50);
    expect.set(k, v);
    db.run("INSERT INTO kv (k, v, h) VALUES (?, ?, ?)", [k, v, sha(v)]);
  }
  const ins = db.prepare("INSERT INTO kv (k, v, h) VALUES (?, ?, ?)");
  db.transaction(() => {
    for (let k = 100; k < N; k++) {
      const v = `tx-${k}-${"y".repeat(k % 37)}`;
      expect.set(k, v);
      ins.run(k, v, sha(v));
    }
  })();
  // blobs across page-boundary sizes
  const blobExpect = new Map();
  const bins = db.prepare("INSERT INTO blobs (k, b, h) VALUES (?, ?, ?)");
  const sizes = [1, 511, 4096, 4097, 65537, 300000];
  db.transaction(() => {
    for (const [i, n] of sizes.entries()) {
      const b = payload(n, 700 + i);
      const h = sha(b);
      blobExpect.set(i, h);
      bins.run(i, b, h);
    }
  })();

  // --- reads: verify every row's value against its stored hash and ours
  console.log(`STAGE: read-${mode}`);
  const rows = db.query("SELECT k, v, h FROM kv ORDER BY k").all();
  if (rows.length !== N) fail(`${mode}: kv count ${rows.length} != ${N}`);
  for (const r of rows) {
    const want = expect.get(r.k);
    if (r.v !== want) fail(`${mode}: kv[${r.k}] value mismatch`);
    if (r.h !== sha(r.v)) fail(`${mode}: kv[${r.k}] stored hash disagrees with value`);
  }
  for (const r of db.query("SELECT k, b, h FROM blobs ORDER BY k").all()) {
    const got = sha(r.b);
    if (got !== blobExpect.get(r.k)) fail(`${mode}: blob[${r.k}] hash mismatch (${r.b.length} bytes)`);
    if (r.h !== got) fail(`${mode}: blob[${r.k}] stored hash disagrees`);
  }
  // Finalize prepared statements before integrity_check/close: an
  // un-finalized statement keeps the database locked.
  ins.finalize();
  bins.finalize();
  const ic = db.query("PRAGMA integrity_check").all();
  const icOk = ic.length === 1 && ic[0].integrity_check === "ok";
  if (!icOk) fail(`${mode}: integrity_check = ${JSON.stringify(ic).slice(0, 120)}`);
  db.close(true);

  // --- reopen: the persisted file must read back identically
  console.log(`STAGE: reopen-${mode}`);
  const db2 = new Database(path);
  const rows2 = db2.query("SELECT COUNT(*) AS c, SUM(k) AS s FROM kv").get();
  if (rows2.c !== N) fail(`${mode}: reopened count ${rows2.c} != ${N}`);
  const bl2 = db2.query("SELECT k, b FROM blobs ORDER BY k").all();
  for (const r of bl2) if (sha(r.b) !== blobExpect.get(r.k)) fail(`${mode}: reopened blob[${r.k}] mismatch`);
  db2.close(true);
}

console.log("STAGE: cleanup");
await fsp.rm("wsf-sq", { recursive: true, force: true });
console.log(`sqlite-integrity ok modes=2 corrupt=${corrupt}`);
