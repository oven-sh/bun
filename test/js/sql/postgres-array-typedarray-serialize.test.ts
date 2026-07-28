// sql.array(values, type) must serialize TypedArray elements to the same
// array literal as the equivalent Buffer or number[] input. Before the fix
// every non-Buffer ArrayBufferView was treated as a nested dimension and its
// per-element string serializations were written back INTO the typed array
// via TypedArray.prototype.map, so a Uint8Array([1,2,44]) bytea element went
// on the wire as {{0,0,0}} ('"1"' → NaN → 0) instead of {"\x01022c"}.
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
    fromBuffer: '{"\\x01022c"}',
    fromUint8: '{"\\x01022c"}',
    fromClamped: '{"\\x01022c"}',
  });
});

test("DataView element in a BYTEA array is hex-encoded like Buffer", async () => {
  const fromDataView = await bindLiteral(sql => sql.array([new DataView(new Uint8Array([0xca, 0xfe]).buffer)], "BYTEA"));
  expect(fromDataView).toBe('{"\\xcafe"}');
});

test("Uint8Array element in a non-BYTEA array follows the Buffer hex path", async () => {
  const fromBuffer = await bindLiteral(sql => sql.array([Buffer.from([65, 66])], "TEXT"));
  const fromUint8 = await bindLiteral(sql => sql.array([new Uint8Array([65, 66])], "TEXT"));
  expect({ fromBuffer, fromUint8 }).toEqual({ fromBuffer: '{"4142"}', fromUint8: '{"4142"}' });
});

test("numeric TypedArray element becomes a nested dimension without coercion loss", async () => {
  expect(await bindLiteral(sql => sql.array([new Float32Array([1.5, -2.25])], "DOUBLE PRECISION"))).toBe(
    "{{1.5,-2.25}}",
  );
  expect(await bindLiteral(sql => sql.array([new BigInt64Array([1n, -2n])], "BIGINT"))).toBe("{{1,-2}}");
  // Int16Array with a non-numeric element type: the quoted per-element strings
  // previously coerced to NaN → 0 inside TypedArray.prototype.map.
  expect(await bindLiteral(sql => sql.array([new Int16Array([7, 8])], "TEXT"))).toBe('{{"7","8"}}');
});

test("top-level Int16Array with a non-numeric element type is serialized without coercion", async () => {
  const got = await bindLiteral(sql => sql.array(new Int16Array([7, 8, 9]), "TEXT"));
  expect(got).toBe('{"7","8","9"}');
});
