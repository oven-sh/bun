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

// --- Test ------------------------------------------------------------------

test(".raw() strips length-prefix bytes from length-encoded columns (#30039)", async () => {
  // 866-byte JSON payload — encodes with the 3-byte length prefix
  // (0xfc NN NN). The 8-byte VARCHAR exercises the 1-byte form. Both were
  // observed as corrupted in the original issue report.
  const jsonPayload = {
    type: "doc",
    content: Array.from({ length: 20 }, () => ({ type: "paragraph", text: "hello world" })),
  };
  const jsonText = JSON.stringify(jsonPayload);
  const shortText = "testname";

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
        } else {
          // COM_QUIT / anything else — close.
          socket.end();
        }
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;

  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // `.simple().raw()` uses the text protocol — exercises the
    // ResultSet.decodeText raw branch that used to call rawEncodeLenData
    // and now calls encodeLenString.
    const rows = (await sql`SELECT name, post FROM t`.simple().raw()) as unknown as [Uint8Array, Uint8Array][];
    expect(rows).toHaveLength(1);
    const [name, post] = rows[0];

    // Defining assertion: first byte is the payload's first byte
    // ('t' = 0x74 for the VARCHAR, '{' = 0x7b for the JSON), NOT the MySQL
    // length-encoded-integer prefix (0x08 / 0xfc respectively).
    expect(name).toBeInstanceOf(Uint8Array);
    expect(post).toBeInstanceOf(Uint8Array);
    expect(name[0]).toBe(0x74); // 't'
    expect(post[0]).toBe(0x7b); // '{'
    expect(Buffer.from(name).toString("utf-8")).toBe(shortText);
    expect(Buffer.from(post).toString("utf-8")).toBe(jsonText);
    expect(name.length).toBe(shortText.length);
    expect(post.length).toBe(jsonText.length);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
