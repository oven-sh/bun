// sql.array(values, type) must hex-encode any ArrayBufferView element (Buffer,
// Uint8Array, DataView, ...) in a BYTEA or JSON array and reject one anywhere
// else. Before the fix every non-Buffer view was treated as a nested dimension
// and its per-element string serializations were written back INTO the typed
// array via TypedArray.prototype.map, so a Uint8Array([1,2,44]) bytea element
// went on the wire as {{0,0,0}} ('"1"' → NaN → 0) instead of {"\x01022c"}.
//
// The serialization happens entirely on the client before Bind, so a scripted
// v3 backend that records the first Bind parameter is sufficient.

import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

function readFirstBindParameter(body: Buffer): string {
  // PostgreSQL FE/BE §55.7 Bind: String(portal) String(stmt) Int16(nFmt)
  // Int16[nFmt] Int16(nParams) (Int32 len, Byte[len])[nParams] ...
  let o = body.indexOf(0) + 1;
  o = body.indexOf(0, o) + 1;
  const nFmt = body.readInt16BE(o);
  o += 2 + 2 * nFmt;
  o += 2; // nParams
  const len = body.readInt32BE(o);
  o += 4;
  return len < 0 ? "NULL" : body.toString("utf8", o, o + len);
}

let captured: string | undefined;
const backend = await listeningServer(socket => {
  let pending = Buffer.alloc(0);
  let sawStartup = false;
  socket.on("data", chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (!sawStartup) {
      if (pending.length < 4) return;
      const len = pending.readInt32BE(0);
      if (pending.length < len) return;
      pending = pending.subarray(len);
      sawStartup = true;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    }
    pending = pgReadFrontendMessages(pending, (type, body) => {
      if (type === 0x50 /* Parse */) {
        socket.write(
          Buffer.concat([
            pgParseComplete(),
            pgParameterDescription([25]),
            pgRowDescription([{ name: "v", typeOid: 25 }]),
            pgReadyForQuery(),
          ]),
        );
      } else if (type === 0x42 /* Bind */) {
        captured = readFirstBindParameter(body);
        socket.write(
          Buffer.concat([
            pgBindComplete(),
            pgDataRow([Buffer.from("ok")]),
            pgCommandComplete("SELECT 1"),
            pgReadyForQuery(),
          ]),
        );
      }
    });
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => backend.server.close(() => r())));

async function bindLiteral(make: (sql: SQL) => unknown): Promise<string> {
  captured = undefined;
  const sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port: backend.port,
    username: "u",
    database: "db",
    tls: false,
    max: 1,
    prepare: true,
    connectionTimeout: 2,
  });
  try {
    await sql`select ${make(sql)} as v`;
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
  if (captured === undefined) throw new Error("no Bind observed");
  return captured;
}

test("Uint8Array element in a BYTEA array is hex-encoded like Buffer", async () => {
  const bytes = [1, 2, 44];
  const fromBuffer = await bindLiteral(sql => sql.array([Buffer.from(bytes)], "BYTEA"));
  const fromUint8 = await bindLiteral(sql => sql.array([new Uint8Array(bytes)], "BYTEA"));
  const fromClamped = await bindLiteral(sql => sql.array([new Uint8ClampedArray(bytes)], "BYTEA"));
  expect({ fromBuffer, fromUint8, fromClamped }).toEqual({
    fromBuffer: '{"\\\\x01022c"}',
    fromUint8: '{"\\\\x01022c"}',
    fromClamped: '{"\\\\x01022c"}',
  });
});

test("DataView and bare ArrayBuffer/SharedArrayBuffer elements in a BYTEA array are hex-encoded like Buffer", async () => {
  const backing = new Uint8Array([0xca, 0xfe]);
  const sab = new SharedArrayBuffer(2);
  new Uint8Array(sab).set(backing);
  const fromDataView = await bindLiteral(sql => sql.array([new DataView(backing.buffer)], "BYTEA"));
  const fromArrayBuffer = await bindLiteral(sql => sql.array([backing.buffer], "BYTEA"));
  const fromSharedArrayBuffer = await bindLiteral(sql => sql.array([sab], "BYTEA"));
  expect({ fromDataView, fromArrayBuffer, fromSharedArrayBuffer }).toEqual({
    fromDataView: '{"\\\\xcafe"}',
    fromArrayBuffer: '{"\\\\xcafe"}',
    fromSharedArrayBuffer: '{"\\\\xcafe"}',
  });
});

test("byte-view elements honour byteOffset / byteLength", async () => {
  const backing = new Uint8Array([0xaa, 0xca, 0xfe, 0xbb]);
  const fromDataView = await bindLiteral(sql => sql.array([new DataView(backing.buffer, 1, 2)], "BYTEA"));
  const fromSubarray = await bindLiteral(sql => sql.array([backing.subarray(1, 3)], "BYTEA"));
  expect({ fromDataView, fromSubarray }).toEqual({ fromDataView: '{"\\\\xcafe"}', fromSubarray: '{"\\\\xcafe"}' });
});

test("ArrayBufferView element in a JSON array is hex-encoded like Buffer", async () => {
  const fromBuffer = await bindLiteral(sql => sql.array([Buffer.from([65, 66])], "JSON"));
  const fromUint8 = await bindLiteral(sql => sql.array([new Uint8Array([65, 66])], "JSON"));
  expect({ fromBuffer, fromUint8 }).toEqual({ fromBuffer: '{"\\"4142\\""}', fromUint8: '{"\\"4142\\""}' });
});

test("binary element in a non-BYTEA non-JSON array is rejected", () => {
  // sql.array() serializes eagerly, so the error surfaces before any I/O.
  const sql = new SQL({ adapter: "postgres", hostname: "127.0.0.1", port: 1, database: "d", max: 1 });
  const elements = [
    new Uint8Array([65, 66]),
    Buffer.from([65, 66]),
    new Float32Array([1.5, 2.5]),
    new Uint8Array([65, 66]).buffer,
  ];
  for (const element of elements) {
    for (const type of ["TEXT", "INT", "REAL"]) {
      const err = (() => {
        try {
          sql.array([element], type);
        } catch (e) {
          return e as Error;
        }
        throw new Error(`expected sql.array([${element.constructor.name}], ${JSON.stringify(type)}) to throw`);
      })();
      expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
      expect(err.message).toContain("BYTEA, JSON, or JSONB");
    }
  }
});

test("top-level TypedArray with a non-numeric element type is serialized without coercion", async () => {
  // serializeArray must not use TypedArray.prototype.map, which would coerce the
  // per-element '"7"' strings back to NaN → 0.
  expect(await bindLiteral(sql => sql.array(new Int16Array([7, 8, 9]), "TEXT"))).toBe('{"7","8","9"}');
  expect(await bindLiteral(sql => sql.array(new Float32Array([1.5, -2.25]), "TEXT"))).toBe('{"1.5","-2.25"}');
});
