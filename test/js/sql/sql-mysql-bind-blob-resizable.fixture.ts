// Reproducer for a borrowed-bytes bug in MySQL BLOB parameter binding when
// the source is a resizable ArrayBuffer or a WebAssembly.Memory-backed view.
//
// Value.fromJS for BLOB params pins the backing ArrayBuffer and borrows its
// bytes without copying. A pin only stops .transfer()/detach; it does NOT
// stop resize() or protect pages a WebAssembly.Memory owns. So a later
// parameter in the same bind loop can run user JS (an array index getter
// here) that invalidates or rewrites the bytes before execute.write() reads
// them:
//  - resizable ArrayBuffer: buf.resize(0) zero-fills and decommits the
//    trimmed region, so the borrowed slice points at memory that is gone
//    (a segfault in practice);
//  - wasm memory view: filling the live pages in place makes a borrow see
//    the mutated bytes at write time instead of the bound ones.
//
// With the fix the borrow helper copies the bytes of storage a pin cannot
// hold in place (WebAssembly.Memory and resizable non-shared ArrayBuffers)
// when the param is converted, so the original bytes reach the server.

import { SQL, randomUUIDv7 } from "bun";

// CI runs MySQL over TCP (MYSQL_URL); the local/sandboxed environment reaches
// the server through its unix socket as root (no TCP user configured).
function makeSQL() {
  const url = process.env.MYSQL_URL;
  if (url) {
    const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
    return new SQL({ url, tls, max: 1 });
  }
  const path = process.env.MYSQL_SOCKET;
  if (!path) throw new Error("MYSQL_URL or MYSQL_SOCKET is required");
  return new SQL({ adapter: "mysql", path, username: "root", database: "bun_sql_test", max: 1 });
}

const sql = makeSQL();

try {
  const tbl = "blob_resize_" + randomUUIDv7("hex").replaceAll("-", "");
  await sql.unsafe(`CREATE TEMPORARY TABLE ${tbl} (id INT, data BLOB, name VARCHAR(255))`).simple();

  // Prime the prepared-statement cache with signature [LONG, BLOB, STRING].
  await sql.unsafe(`INSERT INTO ${tbl} (id, data, name) VALUES (?, ?, ?)`, [0, new Uint8Array(4).fill(0xaa), "prime"]);
  console.log("CONNECTED");

  const buf = new ArrayBuffer(64, { maxByteLength: 1 << 20 });
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
      // By the 2nd access the BLOB param has already been converted to a
      // Value, so this is the first point at which mutating `buf` races with
      // the borrowed slice. resize(0) zeros and drops the 64 bytes in place.
      if (calls >= 2 && buf.byteLength > 0) buf.resize(0);
      return "evil";
    },
  });

  await sql.unsafe(`INSERT INTO ${tbl} (id, data, name) VALUES (?, ?, ?)`, values);

  const [row] = await sql.unsafe(`SELECT data, name FROM ${tbl} WHERE id = 1`);
  const gotHex = Buffer.from(row.data).toString("hex");

  // Same shape for a WebAssembly.Memory-backed view, which also reports
  // neither .resizable nor .shared. No grow here: mutate the pages in place
  // from the later parameter's getter. A borrow reads the bytes at
  // execute.write() time and sees the mutation; the fix copies them when the
  // BLOB param is converted, so the original bytes reach the server.
  const mem = new WebAssembly.Memory({ initial: 1 });
  const wasmTa = new Uint8Array(mem.buffer, 0, 64);
  for (let i = 0; i < wasmTa.length; i++) wasmTa[i] = i;
  const wasmOriginalHex = Buffer.from(wasmTa).toString("hex");

  const wasmValues: unknown[] = [2, wasmTa, "placeholder"];
  let wasmCalls = 0;
  Object.defineProperty(wasmValues, "2", {
    enumerable: true,
    configurable: true,
    get() {
      wasmCalls++;
      if (wasmCalls >= 2) wasmTa.fill(0xff);
      return "evil";
    },
  });

  await sql.unsafe(`INSERT INTO ${tbl} (id, data, name) VALUES (?, ?, ?)`, wasmValues);

  const [wasmRow] = await sql.unsafe(`SELECT data, name FROM ${tbl} WHERE id = 2`);
  const wasmGotHex = Buffer.from(wasmRow.data).toString("hex");

  console.log(
    JSON.stringify({
      calls,
      shrunk: buf.byteLength === 0,
      originalHex,
      gotHex,
      name: row.name,
      match: gotHex === originalHex,
      wasmCalls,
      wasmOriginalHex,
      wasmGotHex,
      wasmName: wasmRow.name,
      wasmMatch: wasmGotHex === wasmOriginalHex,
    }),
  );
} finally {
  await sql.close();
}
