// scenario: crypto + compression + sqlite — CNG/random, zlib streams, and the
// sqlite file/locking syscalls (memory-mapped I/O, LockFile)
const crypto = require("crypto");
const zlib = require("zlib");
const { Database } = require("bun:sqlite");

// crypto: hashes, hmac, random, pbkdf2, cipher, webcrypto digest
const h = crypto.createHash("sha256").update("payload").digest("hex").slice(0, 8);
const hm = crypto.createHmac("sha256", "key").update("m").digest("hex").slice(0, 8);
const rnd = crypto.randomBytes(64).length;
const dk = crypto.pbkdf2Sync("pw", "salt", 1000, 32, "sha256").length;
const cipher = crypto.createCipheriv("aes-256-cbc", crypto.randomBytes(32), crypto.randomBytes(16));
const enc = Buffer.concat([cipher.update("secret data"), cipher.final()]).length;
const wd = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("x"))).length;

// compression: gzip roundtrip + deflate stream
const raw = Buffer.from("compress me ".repeat(2000));
const gz = zlib.gzipSync(raw);
const un = zlib.gunzipSync(gz).length;
const br = zlib.brotliCompressSync(raw).length;

// sqlite: file-backed db exercises real file locking + I/O
const db = new Database("scratch.sqlite");
db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
for (let i = 0; i < 200; i++) ins.run("row" + i);
const count = db.query("SELECT COUNT(*) AS c FROM t").get().c;
db.close();
// The db file is deliberately left in place: on Windows it is still locked
// right after close() (unlink -> EBUSY) — an observation worth handing to
// the hunting session, but not something this workload should die on. The
// per-run directory is wiped anyway.

console.log(`data ok h=${h} hm=${hm} rnd=${rnd} dk=${dk} enc=${enc} wd=${wd} gz=${un} br=${br} sql=${count}`);
