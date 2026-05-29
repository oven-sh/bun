// A result column whose name is all digits with an interior underscore (e.g.
// `2024_01`) must stay a NAMED key. The shared ColumnIdentifier classifier was
// rewritten from Zig to Rust; the Zig version hand-parsed only `'0'..'9'` (any
// other byte meant "this is a name"), but the Rust port routed the name through
// `parse_unsigned`, which — mirroring `std.fmt.parseInt` — skips embedded `_`
// digit separators. So `2024_01` parsed to the integer 202401 and was
// misclassified as a positional array index.
//
// On release 1.3.14 the row decodes as `{ product, "2024_01", "2024_02" }`; on
// the Rust build (before this fix) `2024_01`/`2024_02` collapse to indices
// 202401/202402, so those keys vanish and a debug build aborts on the
// `cell.index < count` assertion in the object-building slow path.
//
// Uses a minimal mock MySQL server so the test runs without Docker. The
// classifier is shared with Postgres, so this covers that decoder too.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import net from "net";

// --- MySQL wire format helpers ---------------------------------------------

function u16le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}
function u24le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]);
}
function u32le(n: number): Buffer {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}
function packet(seq: number, payload: Buffer): Buffer {
  return Buffer.concat([u24le(payload.length), Buffer.from([seq]), payload]);
}
function lenenc(n: number): Buffer {
  if (n < 0xfb) return Buffer.from([n]);
  if (n < 0xffff) return Buffer.concat([Buffer.from([0xfc]), u16le(n)]);
  throw new Error("lenenc: not needed for this test");
}
function lenencStr(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  return Buffer.concat([lenenc(buf.length), buf]);
}

// --- Capability flags ------------------------------------------------------

const CLIENT_PROTOCOL_41 = 1 << 9;
const CLIENT_SECURE_CONNECTION = 1 << 15;
const CLIENT_PLUGIN_AUTH = 1 << 19;
const CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 1 << 21;
const CLIENT_DEPRECATE_EOF = 1 << 24;
const SERVER_CAPS =
  CLIENT_PROTOCOL_41 |
  CLIENT_SECURE_CONNECTION |
  CLIENT_PLUGIN_AUTH |
  CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA |
  CLIENT_DEPRECATE_EOF;

// MYSQL_TYPE_* values. From src/sql/mysql/mysql_types.rs.
const MYSQL_TYPE_LONG = 0x03;
const MYSQL_TYPE_VAR_STRING = 0xfd;

// --- Packet builders -------------------------------------------------------

function handshakeV10(): Buffer {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  return packet(
    0,
    Buffer.concat([
      Buffer.from([10]),
      Buffer.from("mock-5.7.0\0"),
      u32le(1),
      authData1,
      Buffer.from([0]),
      u16le(SERVER_CAPS & 0xffff),
      Buffer.from([0x2d]),
      u16le(0x0002),
      u16le((SERVER_CAPS >>> 16) & 0xffff),
      Buffer.from([21]),
      Buffer.alloc(10, 0),
      authData2,
      Buffer.from("mysql_native_password\0"),
    ]),
  );
}

function okPacket(seq: number, header = 0x00): Buffer {
  return packet(seq, Buffer.from([header, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function columnDef(name: string, type: number, flags = 0): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]),
    u16le(33),
    u32le(1024),
    Buffer.from([type]),
    u16le(flags),
    Buffer.from([0]),
    Buffer.from([0, 0]),
  ]);
}

function stmtPrepareOK(startSeq: number, stmtId: number, columns: Buffer[]): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]),
        u32le(stmtId),
        u16le(columns.length),
        u16le(0), // num_params
        Buffer.from([0x00]),
        u16le(0),
      ]),
    ),
  );
  for (const c of columns) packets.push(packet(seq++, c));
  return Buffer.concat(packets);
}

// Binary row: 0x00 header, NULL bitmap (ceil((n + 2) / 8) bytes, all zero),
// then one `values` buffer per column, in order.
function binaryResultSet(startSeq: number, columns: Buffer[], values: Buffer): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(packet(seq++, Buffer.from([columns.length])));
  for (const c of columns) packets.push(packet(seq++, c));
  const nullBitmapLen = Math.ceil((columns.length + 2) / 8);
  packets.push(packet(seq++, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(nullBitmapLen, 0), values])));
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
  return Buffer.concat(packets);
}

function startMockServer(columns: Buffer[], values: Buffer) {
  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let stmtId = 0;
    socket.write(handshakeV10());
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const len = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
        if (buffered.length < 4 + len) break;
        const seq = buffered[3];
        const payload = buffered.subarray(4, 4 + len);
        buffered = buffered.subarray(4 + len);
        if (!authed) {
          authed = true;
          socket.write(okPacket(seq + 1));
          continue;
        }
        const cmd = payload[0];
        if (cmd === 0x16 /* COM_STMT_PREPARE */) {
          socket.write(stmtPrepareOK(seq + 1, ++stmtId, columns));
        } else if (cmd === 0x17 /* COM_STMT_EXECUTE */) {
          socket.write(binaryResultSet(seq + 1, columns, values));
        } else if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(okPacket(seq + 1));
        } else if (cmd === 0x19 /* COM_STMT_CLOSE */) {
          // no response expected
        } else {
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  return server;
}

// Runs `run(sql)` against a mock server that always replies with the given
// columns/values (via the binary prepared-statement path that a tagged-template
// query uses). The actual SQL text is ignored by the mock — what matters is the
// column metadata it returns, which is how the classifier is exercised.
async function withMockedResult<T>(
  columns: Buffer[],
  values: Buffer,
  run: (sql: InstanceType<typeof SQL>) => Promise<T>,
): Promise<T> {
  const server = startMockServer(columns, values);
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    return await run(sql);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

test("a digits-with-interior-underscore column stays a named key", async () => {
  // `2024_01`/`2024_02` must NOT be treated as the indices 202401/202402.
  // Mixing them with a normal named column exercises the object-building slow
  // path (named + "indexed" columns), which asserts `index < count` in debug.
  const columns = [
    columnDef("product", MYSQL_TYPE_VAR_STRING),
    columnDef("2024_01", MYSQL_TYPE_LONG),
    columnDef("2024_02", MYSQL_TYPE_LONG),
  ];
  const values = Buffer.concat([lenencStr("widget"), u32le(10), u32le(20)]);

  const [row] = await withMockedResult(columns, values, sql => sql`SELECT product, \`2024_01\`, \`2024_02\` FROM t`);
  expect(row).toEqual({ product: "widget", "2024_01": 10, "2024_02": 20 });
});

test("a pure-digit column name is still treated as a positional index", async () => {
  // Guard against over-correcting: an all-digit name like `5` has always mapped
  // to the array index 5 (JSC indexed property), and must keep doing so.
  const columns = [columnDef("5", MYSQL_TYPE_LONG)];
  const values = u32le(42);

  const [row] = await withMockedResult(columns, values, sql => sql`SELECT 42 AS \`5\` FROM t`);
  // Index 5 → an object with the numeric key "5" and nothing at 0..4.
  expect(row[5]).toBe(42);
  expect(row["5"]).toBe(42);
});
