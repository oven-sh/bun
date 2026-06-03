// Bun.SQL Postgres `bytea` parameters accept BufferSource values. The bind
// writer (`PostgresRequest::write_bind`, `types::Tag::bytea`) read them through a
// Rust `&[u8]` built by `ArrayBuffer::byte_slice()`. For a SharedArrayBuffer or
// resizable ArrayBuffer backing store, another agent can mutate (or the owner
// resize) the bytes during the read, so the slice is not stable. The fix copies
// shared/resizable inputs to owned bytes before forming the slice; fixed unshared
// inputs keep the borrowed fast path.
//
// Uses a minimal mock Postgres server (no Docker) that captures the Bind ('B')
// message and asserts the serialized `bytea` parameter equals exactly the view's
// range. 0xff guard bytes outside the view ensure a whole-buffer/wrong-range
// regression would be caught. Covers prepare:false and default prepared routes.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

function pkt(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}
function i16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}
function i32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

const authenticationOk = pkt("R", i32(0));
const readyForQuery = pkt("Z", Buffer.from("I"));
const parseComplete = pkt("1");
const bindComplete = pkt("2");
const noData = pkt("n");
// ParameterDescription: 1 parameter, type oid 17 = bytea.
const parameterDescriptionBytea = pkt("t", Buffer.concat([i16(1), i32(17)]));
const commandComplete = pkt("C", Buffer.from("SELECT 0\0"));

function parseBindFirstParam(body: Buffer): { length: number; bytes: Buffer; format: number } {
  let off = body.indexOf(0, 0) + 1; // portal cstring
  off = body.indexOf(0, off) + 1; // statement cstring
  const formatCount = body.readInt16BE(off);
  off += 2;
  const formats: number[] = [];
  for (let i = 0; i < formatCount; i++) {
    formats.push(body.readInt16BE(off));
    off += 2;
  }
  off += 2; // paramCount (we only inspect the first)
  const length = body.readInt32BE(off);
  off += 4;
  const bytes = length === -1 ? Buffer.alloc(0) : Buffer.from(body.subarray(off, off + length));
  return { length, bytes, format: formats[0] ?? 0 };
}

async function captureBindParam(value: Uint8Array | ArrayBuffer | SharedArrayBuffer, prepare: boolean) {
  const { promise, resolve } = Promise.withResolvers<{ length: number; bytes: Buffer; format: number }>();
  const server = net.createServer(socket => {
    let startup = true;
    let pending = Buffer.alloc(0);
    socket.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (startup) {
        if (pending.length < 4) return;
        const len = pending.readInt32BE(0);
        if (pending.length < len) return;
        pending = pending.subarray(len);
        startup = false;
        socket.write(Buffer.concat([authenticationOk, readyForQuery]));
      }
      while (pending.length >= 5) {
        const type = String.fromCharCode(pending[0]);
        const len = pending.readInt32BE(1);
        if (pending.length < 1 + len) return;
        const body = pending.subarray(5, 1 + len);
        pending = pending.subarray(1 + len);
        if (type === "P") socket.write(parseComplete);
        else if (type === "D") socket.write(Buffer.concat([parameterDescriptionBytea, noData]));
        else if (type === "B") {
          resolve(parseBindFirstParam(body));
          socket.write(bindComplete);
        } else if (type === "E") socket.write(commandComplete);
        else if (type === "S") socket.write(readyForQuery);
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  const sql = new SQL({
    url: `postgres://u@127.0.0.1:${port}/db`,
    max: 1,
    prepare,
    idleTimeout: 1,
    connectionTimeout: 5,
  });
  try {
    const query = sql`select ${value}::bytea`;
    const captured = await Promise.race([promise, query.then(() => null).catch(() => null)]);
    if (!captured) throw new Error("query completed before Bind was captured");
    return captured;
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

// Range bytes are 1..len; everything outside the view is a 0xff guard so a
// whole-buffer or wrong-offset serialization would fail the byte assertion.
function fillRange(all: Uint8Array, offset: number, len: number) {
  all.fill(0xff);
  for (let i = 0; i < len; i++) all[offset + i] = (i + 1) & 0xff;
}
function sabView(offset: number, len: number) {
  const sab = new SharedArrayBuffer(offset + len + 4);
  fillRange(new Uint8Array(sab), offset, len);
  return new Uint8Array(sab, offset, len);
}
function resizableView(offset: number, len: number) {
  const ab = new ArrayBuffer(offset + len + 4, { maxByteLength: offset + len + 16 });
  fillRange(new Uint8Array(ab), offset, len);
  return new Uint8Array(ab, offset, len);
}
function fixedView(len: number) {
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i++) u8[i] = (i + 1) & 0xff;
  return u8;
}
// A view binds the view's range; raw buffers (not views) bind the whole buffer.
// The classification routes both typed-array views AND raw ArrayBuffer /
// SharedArrayBuffer to Tag::bytea, so cover the raw cases too.
function asView(view: Uint8Array): { value: Uint8Array; expected: Buffer } {
  return { value: view, expected: Buffer.from(view) };
}
function rawShared(len: number): { value: SharedArrayBuffer; expected: Buffer } {
  const sab = new SharedArrayBuffer(len);
  const all = new Uint8Array(sab);
  for (let i = 0; i < len; i++) all[i] = (i + 1) & 0xff;
  return { value: sab, expected: Buffer.from(all) };
}
function rawResizable(len: number): { value: ArrayBuffer; expected: Buffer } {
  const ab = new ArrayBuffer(len, { maxByteLength: len + 16 });
  const all = new Uint8Array(ab);
  for (let i = 0; i < len; i++) all[i] = (i + 1) & 0xff;
  return { value: ab, expected: Buffer.from(all) };
}

type Case = { value: Uint8Array | ArrayBuffer | SharedArrayBuffer; expected: Buffer };
const cases: { name: string; prepare: boolean; make: () => Case }[] = [
  {
    name: "prepare:false, Uint8Array(SharedArrayBuffer) nonzero offset",
    prepare: false,
    make: () => asView(sabView(13, 64)),
  },
  {
    name: "default prepared, Uint8Array(SharedArrayBuffer) nonzero offset",
    prepare: true,
    make: () => asView(sabView(13, 48)),
  },
  {
    name: "prepare:false, Uint8Array(resizable ArrayBuffer) nonzero offset",
    prepare: false,
    make: () => asView(resizableView(13, 40)),
  },
  { name: "prepare:false, raw SharedArrayBuffer (not a view)", prepare: false, make: () => rawShared(50) },
  { name: "default prepared, raw resizable ArrayBuffer (not a view)", prepare: true, make: () => rawResizable(36) },
  { name: "prepare:false, zero-length SharedArrayBuffer view", prepare: false, make: () => asView(sabView(8, 0)) },
  {
    name: "default prepared, fixed unshared Uint8Array (borrowed fast path)",
    prepare: true,
    make: () => asView(fixedView(24)),
  },
];

test.each(cases)("Postgres bytea bind preserves exact bytes: $name", async ({ prepare, make }) => {
  const { value, expected } = make();
  const { length, bytes, format } = await captureBindParam(value, prepare);
  expect(length).toBe(expected.length);
  expect(bytes).toEqual(expected); // toEqual surfaces the byte diff on failure
  expect(format).toBe(1); // binary bytea
});
