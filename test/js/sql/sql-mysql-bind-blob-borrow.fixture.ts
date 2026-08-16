// Reproducer for a borrowed-bytes bug in MySQL BLOB parameter binding.
//
// Value.fromJS for BLOB params borrowed the ArrayBuffer backing store
// without protecting it. The bind loop in MySQLQuery.bind() then continues
// to later parameters, which can run user JS (array index getters, toJSON,
// toString coercion) that transfers or detaches the earlier buffer.
// execute.write() then reads bytes that no longer belong to the original
// buffer.
//
// For a non-resizable ArrayBuffer, `buf.transfer()` with no arguments is
// zero-copy in JSC — the new buffer takes ownership of the *same* backing
// pointer. Overwriting the new buffer therefore mutates the bytes the
// borrowed slice still points at, and those mutated bytes are what go on
// the wire. With the fix the backing ArrayBuffer is pinned for the
// duration of bind+execute, so `transfer()` hands the user a copy instead
// of detaching and the original bytes reach the server.

import { SQL, randomUUIDv7 } from "bun";

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required");

const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
const sql = new SQL({ url, tls, max: 1 });

try {
  const tbl = "blob_borrow_" + randomUUIDv7("hex").replaceAll("-", "");
  await sql.unsafe(`CREATE TEMPORARY TABLE ${tbl} (id INT, data BLOB, name VARCHAR(255))`).simple();

  // Prime the prepared-statement cache with signature [LONG, BLOB, STRING]
  // so the next call with the same signature goes straight to
  // bindAndExecute (statement already .prepared).
  await sql.unsafe(`INSERT INTO ${tbl} (id, data, name) VALUES (?, ?, ?)`, [0, new Uint8Array(4).fill(0xaa), "prime"]);
  // Marker so the harness can distinguish "couldn't connect" from
  // "connected then crashed" when no MySQL is available.
  console.log("CONNECTED");

  const buf = new ArrayBuffer(64);
  const ta = new Uint8Array(buf);
  for (let i = 0; i < ta.length; i++) ta[i] = i;
  const originalHex = Buffer.from(ta).toString("hex");

  const values: unknown[] = [1, ta, "placeholder"];
  let calls = 0;
  Object.defineProperty(values, "2", {
    enumerable: true,
    configurable: true,
    get() {
      calls++;
      // The array is iterated once by Signature.generate (type inference
      // only — no user JS on the values themselves) and again by bind().
      // By the 2nd access the BLOB param has already been converted to a
      // Value, so this is the first point at which mutating `buf` can race
      // with the borrowed slice.
      if (calls >= 2 && buf.byteLength > 0) {
        // Zero-copy transfer: the new buffer owns the same backing pointer.
        // Overwriting it mutates what the borrowed slice still points at.
        const moved = buf.transfer();
        new Uint8Array(moved).fill(0xff);
      }
      return "evil";
    },
  });

  await sql.unsafe(`INSERT INTO ${tbl} (id, data, name) VALUES (?, ?, ?)`, values);

  // The backing ArrayBuffer is pinned for the duration of bind+execute,
  // which makes `buf.transfer()` inside the getter return a copy instead
  // of detaching. Once the query has resolved the pin must be released —
  // verify `buf` is detachable again.
  let detachableAfter = true;
  if (buf.byteLength > 0) {
    buf.transfer();
    detachableAfter = buf.byteLength === 0;
  }

  const [row] = await sql.unsafe(`SELECT data, name FROM ${tbl} WHERE id = 1`);
  const gotHex = Buffer.from(row.data).toString("hex");

  console.log(
    JSON.stringify({
      calls,
      detached: buf.byteLength === 0,
      detachableAfter,
      originalHex,
      gotHex,
      name: row.name,
      match: gotHex === originalHex,
    }),
  );
} finally {
  await sql.close();
}
