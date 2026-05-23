// Regression for https://github.com/oven-sh/bun/issues/30039
//
// `.raw()` on any length-encoded MySQL column (json / varchar / text /
// blob / enum / geometry / ...) used to return the length-encoded-integer
// prefix bytes concatenated with the payload. The reporter saw a leading
// `0xFFFD` when decoding a JSON column as UTF-8 — that's the 0xa7 length
// prefix (a lone UTF-8 continuation byte) showing up in front of the JSON.
//
// Uses a minimal mock MySQL server so the test runs without Docker or a
// live MySQL installation.

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

// MySQL length-encoded integer: < 0xfb → 1 byte; < 0xffff → 0xfc + 2 bytes;
// < 0xffffff → 0xfd + 3 bytes; else 0xfe + 8 bytes.
function lenenc(n: number): Buffer {
  if (n < 0xfb) return Buffer.from([n]);
  if (n < 0xffff) return Buffer.concat([Buffer.from([0xfc]), u16le(n)]);
  if (n < 0xffffff) return Buffer.concat([Buffer.from([0xfd]), u24le(n)]);
  throw new Error("lenenc: 8-byte form not needed for this test");
}
function lenencStr(s: string | Buffer): Buffer {
  const buf = typeof s === "string" ? Buffer.from(s, "utf-8") : s;
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

// MYSQL_TYPE_* values used below. From src/sql/mysql/MySQLTypes.zig.
const MYSQL_TYPE_VAR_STRING = 0xfd;
const MYSQL_TYPE_JSON = 0xf5;

// --- Packet builders -------------------------------------------------------

function handshakeV10(): Buffer {
  const authData1 = Buffer.alloc(8, 0x61);
  const authData2 = Buffer.alloc(13, 0x62);
  authData2[12] = 0;
  const payload = Buffer.concat([
    Buffer.from([10]), // protocol version
    Buffer.from("mock-5.7.0\0"),
    u32le(1), // connection id
    authData1,
    Buffer.from([0]), // filler
    u16le(SERVER_CAPS & 0xffff),
    Buffer.from([0x2d]), // utf8mb4_general_ci
    u16le(0x0002), // SERVER_STATUS_AUTOCOMMIT
    u16le((SERVER_CAPS >>> 16) & 0xffff),
    Buffer.from([21]), // length of auth-plugin-data
    Buffer.alloc(10, 0), // reserved
    authData2,
    Buffer.from("mysql_native_password\0"),
  ]);
  return packet(0, payload);
}

function okPacket(seq: number, header = 0x00): Buffer {
  return packet(seq, Buffer.from([header, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function columnDefinition(name: string, type: number): Buffer {
  // ColumnDefinition41: catalog, schema, table, org_table, name, org_name (all
  // lenenc strings), fixed-length-field-length (lenenc = 0x0c), character_set
  // (u16), column_length (u32), column_type (u8), flags (u16), decimals (u8),
  // plus 2 reserved bytes.
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]), // fixed-length-fields length = 12
    u16le(33), // utf8_general_ci
    u32le(1024 * 1024), // column_length (display width)
    Buffer.from([type]),
    u16le(0), // flags
    Buffer.from([0]), // decimals
    Buffer.from([0, 0]), // reserved
  ]);
}

// Build a text-protocol result-set response for a single row with two columns.
// Column 1: VARCHAR name  |  Column 2: JSON post.
function textResultSet(startSeq: number, nameValue: string, jsonValue: string): Buffer {
  // Order: column count, column defs, row, OK/EOF.
  const packets: Buffer[] = [];
  let seq = startSeq;

  // Column count
  packets.push(packet(seq++, Buffer.from([0x02])));
  // Two column definitions
  packets.push(packet(seq++, columnDefinition("name", MYSQL_TYPE_VAR_STRING)));
  packets.push(packet(seq++, columnDefinition("post", MYSQL_TYPE_JSON)));
  // Row: each column is a lenenc string. The bug is exactly here — the
  // decoder needs to read the lenenc prefix and return only the payload.
  packets.push(packet(seq++, Buffer.concat([lenencStr(nameValue), lenencStr(jsonValue)])));
  // OK packet to close the result set (with CLIENT_DEPRECATE_EOF, header 0xfe).
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));

  return Buffer.concat(packets);
}

// COM_STMT_PREPARE response: OK header + 0 params + 2 result columns.
function stmtPrepareOK(startSeq: number, statementId: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  // StmtPrepareOK: 0x00, stmt_id u32, num_columns u16, num_params u16,
  // reserved u8 = 0x00, warning_count u16.
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]),
        u32le(statementId),
        u16le(2), // num_columns
        u16le(0), // num_params
        Buffer.from([0x00]), // reserved
        u16le(0), // warning_count
      ]),
    ),
  );
  // With num_params = 0, no param definitions + EOF follow. Just the column
  // definitions + (with CLIENT_DEPRECATE_EOF) no trailing EOF.
  packets.push(packet(seq++, columnDefinition("name", MYSQL_TYPE_VAR_STRING)));
  packets.push(packet(seq++, columnDefinition("post", MYSQL_TYPE_JSON)));
  return Buffer.concat(packets);
}

// Binary-protocol result-set for a single row with two non-null columns.
function binaryResultSet(startSeq: number, nameValue: string, jsonValue: string): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;

  // Column count
  packets.push(packet(seq++, Buffer.from([0x02])));
  packets.push(packet(seq++, columnDefinition("name", MYSQL_TYPE_VAR_STRING)));
  packets.push(packet(seq++, columnDefinition("post", MYSQL_TYPE_JSON)));
  // Binary row: header 0x00, NULL bitmap, then each non-null value.
  // Bitmap is ceil((n + 7 + 2) / 8) bytes with the first 2 bits reserved;
  // 2 non-null columns → single 0x00 byte.
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]), // packet header
        Buffer.from([0x00]), // null bitmap: nothing null
        lenencStr(nameValue),
        lenencStr(jsonValue),
      ]),
    ),
  );
  // OK packet closing (CLIENT_DEPRECATE_EOF, header 0xfe).
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
  return Buffer.concat(packets);
}

// --- Test ------------------------------------------------------------------

// 866-byte JSON payload — encodes with the 3-byte length prefix (0xfc NN NN).
// The 8-byte VARCHAR exercises the 1-byte form. Both shapes appeared in the
// original issue report.
const jsonPayload = {
  type: "doc",
  content: Array.from({ length: 20 }, () => ({ type: "paragraph", text: "hello world" })),
};
const jsonText = JSON.stringify(jsonPayload);
const shortText = "testname";

function startMockServer() {
  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;

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
        if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(textResultSet(seq + 1, shortText, jsonText));
        } else if (cmd === 0x16 /* COM_STMT_PREPARE */) {
          socket.write(stmtPrepareOK(seq + 1, 1));
        } else if (cmd === 0x17 /* COM_STMT_EXECUTE */) {
          socket.write(binaryResultSet(seq + 1, shortText, jsonText));
        } else {
          // COM_QUIT / anything else — close.
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  return server;
}

function assertRawRow(name: unknown, post: unknown) {
  expect(name).toBeInstanceOf(Uint8Array);
  expect(post).toBeInstanceOf(Uint8Array);
  // Defining assertion: first byte is the payload's first byte
  // ('t' = 0x74 for the VARCHAR, '{' = 0x7b for the JSON), NOT the MySQL
  // length-encoded-integer prefix (0x08 / 0xfc respectively).
  expect((name as Uint8Array)[0]).toBe(0x74); // 't'
  expect((post as Uint8Array)[0]).toBe(0x7b); // '{'
  expect(Buffer.from(name as Uint8Array).toString("utf-8")).toBe(shortText);
  expect(Buffer.from(post as Uint8Array).toString("utf-8")).toBe(jsonText);
  expect((name as Uint8Array).length).toBe(shortText.length);
  expect((post as Uint8Array).length).toBe(jsonText.length);
}

test(".raw() strips length-prefix bytes (#30039) — text protocol", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    // `.simple().raw()` exercises the ResultSet.decodeText raw branch
    // (ResultSet.zig:177) that used to call rawEncodeLenData.
    const rows = (await sql`SELECT name, post FROM t`.simple().raw()) as unknown as [Uint8Array, Uint8Array][];
    expect(rows).toHaveLength(1);
    const [name, post] = rows[0];
    assertRawRow(name, post);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test(".raw() strips length-prefix bytes (#30039) — binary protocol", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    // Without `.simple()`, the client uses a prepared statement and the
    // binary-protocol row decoder — exercising the DecodeBinaryValue raw
    // branches (DecodeBinaryValue.zig:153, :172) that used to call
    // rawEncodeLenData for VAR_STRING and JSON.
    const rows = (await sql`SELECT name, post FROM t`.raw()) as unknown as [Uint8Array, Uint8Array][];
    expect(rows).toHaveLength(1);
    const [name, post] = rows[0];
    assertRawRow(name, post);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

// A COM_QUERY whose payload exceeds the 24-bit packet length limit cannot be
// framed as a single MySQL packet. It must be rejected client-side AND rolled
// back out of the connection's write buffer: leaving the partially-serialized
// packet behind desynchronizes the protocol stream, and the next query gets
// appended after the garbage and reparsed by the server as bogus packets.
test("oversized COM_QUERY is rejected and rolled back out of the write buffer", async () => {
  const queries: string[] = [];
  let desynced = false;

  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
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
        if (payload[0] === 0x03 /* COM_QUERY */) {
          queries.push(payload.subarray(1).toString("utf-8"));
          socket.write(textResultSet(seq + 1, shortText, jsonText));
        } else if (payload[0] === 0x01 /* COM_QUIT */) {
          socket.end();
        } else {
          // A zero-length packet or one that does not start with a known
          // command byte means the client's outgoing stream is no longer
          // aligned on packet boundaries. Destroy the socket so the test
          // fails fast instead of hanging.
          desynced = true;
          socket.destroy();
        }
      }
    });
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // 1 command byte + 0xffffff bytes of query text = 0x1000000 — one past
    // the largest payload a single MySQL packet can frame.
    const oversized = Buffer.alloc(0xffffff, "-").toString();
    const first = await sql.unsafe(oversized).then(
      () => "resolved",
      e => e?.code ?? String(e),
    );

    // The same connection must still be usable: the rejected packet must not
    // leave any bytes behind in the write buffer.
    const second = await sql.unsafe("select 1").then(
      () => "resolved",
      e => e?.code ?? String(e),
    );

    expect({ first, second, queries, desynced }).toEqual({
      first: "ERR_MYSQL_OVERFLOW",
      second: "resolved",
      queries: ["select 1"],
      desynced: false,
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

// --- 251-byte length-encoded values vs. the NULL marker ---------------------
//
// The text-protocol NULL marker is the single literal byte 0xfb. A column
// value that is exactly 251 bytes long is length-encoded as `0xfc 0xfb 0x00`
// followed by 251 payload bytes — and the decoded *length* is also 251
// (0xfb). The decoder must distinguish the two by encoding width: if it only
// compares the decoded value, the column is misread as NULL, only the 3
// length bytes are consumed, and the 251 payload bytes are re-parsed as the
// lengths/contents of the following columns. Whoever controls the first
// column then controls what the application sees in the rest of the row.

// The first bytes of the 251-byte payload deliberately form a valid
// length-encoded string ("admin") so a desynchronized decoder would surface
// it as the *next* column's value instead of "user".
const bio251 = "\x05admin" + Buffer.alloc(251 - 6, "x").toString();
const realRole = "user";

function textResultSet251(startSeq: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;

  // Column count
  packets.push(packet(seq++, Buffer.from([0x02])));
  packets.push(packet(seq++, columnDefinition("bio", MYSQL_TYPE_VAR_STRING)));
  packets.push(packet(seq++, columnDefinition("role", MYSQL_TYPE_VAR_STRING)));
  // Row 1: exactly-251-byte bio (3-byte lenenc prefix 0xfc 0xfb 0x00), then
  // role = "user".
  packets.push(packet(seq++, Buffer.concat([lenencStr(bio251), lenencStr(realRole)])));
  // Row 2: a genuine NULL bio (the single marker byte 0xfb), then
  // role = "editor" — the legitimate NULL case must keep working.
  packets.push(packet(seq++, Buffer.concat([Buffer.from([0xfb]), lenencStr("editor")])));
  // OK packet to close the result set (with CLIENT_DEPRECATE_EOF, header 0xfe).
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));

  return Buffer.concat(packets);
}

function startMock251Server() {
  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;

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
        if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(textResultSet251(seq + 1));
        } else {
          // COM_QUIT / anything else — close.
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  return server;
}

test("text protocol decodes a 251-byte column value as data, not as NULL", async () => {
  // Sanity: the payload is exactly 251 bytes and 251 really is the 3-byte
  // lenenc form whose decoded value collides with the NULL marker byte.
  expect(Buffer.byteLength(bio251, "utf-8")).toBe(251);
  expect(Array.from(lenenc(251))).toEqual([0xfc, 0xfb, 0x00]);

  const server = startMock251Server();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    // `.simple()` forces the text protocol → ResultSet decode_text, where the
    // NULL-marker check lives.
    const rows = (await sql`SELECT bio, role FROM users`.simple()) as unknown as {
      bio: string | null;
      role: string;
    }[];
    expect(rows).toHaveLength(2);
    // The 251-byte value must come back intact — not as NULL with the
    // following column re-read out of the 251 payload bytes (which would
    // make role === "admin").
    expect(rows[0].role).toBe(realRole);
    expect(rows[0].bio).toBe(bio251);
    // A genuine NULL marker (single 0xfb byte) still decodes as NULL and the
    // row stays aligned.
    expect(rows[1].bio).toBeNull();
    expect(rows[1].role).toBe("editor");
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
