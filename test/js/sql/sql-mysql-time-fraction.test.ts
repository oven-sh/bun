// The binary-protocol TIME decoder parsed the 12-byte wire form's
// microseconds field but never wrote it, so TIME(6) values lost their
// fractional part ("02:03:04.5" decoded as "02:03:04"). The fractional part is
// emitted zero-padded to 6 digits with trailing zeros stripped, matching the
// mysql2 driver; the docker-backed "time with fractional seconds" test in
// sql-mysql.test.ts asserts the same values against a real server.
//
// Uses a minimal mock MySQL server so the test runs without Docker.

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
function lenencStr(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  if (buf.length >= 0xfb) throw new Error("too long for 1-byte lenenc");
  return Buffer.concat([Buffer.from([buf.length]), buf]);
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

const MYSQL_TYPE_TIME = 0x0b;
const BINARY_FLAG = 1 << 7; // ColumnFlags::BINARY
const BINARY_CHARSET = 63; // the "binary" pseudo-charset

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

// TIME(6) column: binary charset + BINARY flag + 6 decimals, the metadata a
// real server attaches.
function timeColumn(): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr("a"),
    lenencStr("a"),
    Buffer.from([0x0c]),
    u16le(BINARY_CHARSET),
    u32le(17),
    Buffer.from([MYSQL_TYPE_TIME]),
    u16le(BINARY_FLAG),
    Buffer.from([6]), // decimals
    Buffer.from([0, 0]),
  ]);
}

// Binary TIME wire value: length byte (8 or 12), then is_negative(1),
// days(4 LE), hours(1), minutes(1), seconds(1), and for the 12-byte form
// microseconds(4 LE).
function binaryTime(t: { negative?: boolean; days?: number; h: number; m: number; s: number; us?: number }): Buffer {
  const head = Buffer.concat([
    Buffer.from([t.us === undefined ? 8 : 12, t.negative ? 1 : 0]),
    u32le(t.days ?? 0),
    Buffer.from([t.h, t.m, t.s]),
  ]);
  return t.us === undefined ? head : Buffer.concat([head, u32le(t.us)]);
}

const binaryRows = [
  binaryTime({ h: 2, m: 3, s: 4 }), // 8-byte form, no microseconds field
  binaryTime({ h: 2, m: 3, s: 4, us: 500000 }),
  binaryTime({ h: 2, m: 3, s: 4, us: 123456 }),
  binaryTime({ negative: true, h: 2, m: 3, s: 4, us: 123456 }),
  binaryTime({ days: 34, h: 22, m: 59, s: 58, us: 999999 }), // 838:59:58.999999
  binaryTime({ h: 2, m: 3, s: 4, us: 500 }), // sub-millisecond
  binaryTime({ h: 2, m: 3, s: 4, us: 0 }), // 12-byte form, zero microseconds
];

// Text-protocol rows: the server sends the column at its declared precision,
// passed through as-is.
const textRows = [
  "02:03:04.000000",
  "02:03:04.500000",
  "02:03:04.123456",
  "-02:03:04.123456",
  "838:59:58.999999",
  "02:03:04.000500",
  "02:03:04.000000",
];

function stmtPrepareOK(startSeq: number, stmtId: number): Buffer {
  let seq = startSeq;
  return Buffer.concat([
    packet(
      seq++,
      Buffer.concat([Buffer.from([0x00]), u32le(stmtId), u16le(1), u16le(0), Buffer.from([0x00]), u16le(0)]),
    ),
    packet(seq++, timeColumn()),
  ]);
}

function binaryResultSet(startSeq: number): Buffer {
  let seq = startSeq;
  const packets = [packet(seq++, Buffer.from([1])), packet(seq++, timeColumn())];
  for (const value of binaryRows) {
    // 0x00 row header, 1-byte NULL bitmap (nothing null), then the value.
    packets.push(packet(seq++, Buffer.concat([Buffer.from([0x00, 0x00]), value])));
  }
  packets.push(okPacket(seq++, 0xfe));
  return Buffer.concat(packets);
}

function textResultSet(startSeq: number): Buffer {
  let seq = startSeq;
  const packets = [packet(seq++, Buffer.from([1])), packet(seq++, timeColumn())];
  for (const value of textRows) {
    packets.push(packet(seq++, lenencStr(value)));
  }
  packets.push(okPacket(seq++, 0xfe));
  return Buffer.concat(packets);
}

function startMockServer(): net.Server {
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
          socket.write(stmtPrepareOK(seq + 1, ++stmtId));
        } else if (cmd === 0x17 /* COM_STMT_EXECUTE */) {
          socket.write(binaryResultSet(seq + 1));
        } else if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(textResultSet(seq + 1));
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

test("binary TIME keeps fractional seconds", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // Binary protocol (prepared statement): fractional part zero-padded to 6
    // digits with trailing zeros stripped, omitted entirely when zero.
    expect(await sql`SELECT a FROM times`).toEqual([
      { a: "02:03:04" },
      { a: "02:03:04.5" },
      { a: "02:03:04.123456" },
      { a: "-02:03:04.123456" },
      { a: "838:59:58.999999" },
      { a: "02:03:04.0005" },
      { a: "02:03:04" },
    ]);

    // Text protocol (`.simple()`) passes the server's string through verbatim.
    expect(await sql`SELECT a FROM times`.simple()).toEqual(textRows.map(a => ({ a })));
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
