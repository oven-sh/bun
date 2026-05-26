// MySQL's binary result-row protocol transmits MYSQL_TYPE_YEAR as a fixed
// 2-byte field, but the column definition reports column_length = 4 (display
// width). The decoder used to fall through to the catch-all arm and consume
// column_length (4) bytes, returning a Buffer and leaving the cursor 2 bytes
// ahead — silently corrupting every column that follows in the row.
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

// MYSQL_TYPE_* values. From src/sql/mysql/MySQLTypes.rs.
const MYSQL_TYPE_SHORT = 0x02;
const MYSQL_TYPE_LONG = 0x03;
const MYSQL_TYPE_YEAR = 0x0d;

const UNSIGNED_FLAG = 1 << 5;

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

function columnDef(name: string, type: number, columnLength: number, flags = 0): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]),
    u16le(33),
    u32le(columnLength),
    Buffer.from([type]),
    u16le(flags),
    Buffer.from([0]),
    Buffer.from([0, 0]),
  ]);
}

// Real MySQL reports column_length = 4 (display width) for YEAR columns.
const columns = [
  columnDef("id", MYSQL_TYPE_LONG, 11),
  columnDef("yr", MYSQL_TYPE_YEAR, 4, UNSIGNED_FLAG),
  columnDef("followup", MYSQL_TYPE_LONG, 11),
  columnDef("control", MYSQL_TYPE_SHORT, 6),
  columnDef("yr_last", MYSQL_TYPE_YEAR, 4, UNSIGNED_FLAG),
];

function stmtPrepareOK(startSeq: number, stmtId: number): Buffer {
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

function binaryResultSet(startSeq: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(packet(seq++, Buffer.from([columns.length])));
  for (const c of columns) packets.push(packet(seq++, c));
  // Binary row: 0x00 header, NULL bitmap ((5+7+2)/8 = 1 byte), then values.
  // YEAR is transmitted as a fixed 2-byte field regardless of column_length.
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]), // row header
        Buffer.from([0x00]), // null bitmap: nothing null
        u32le(1), // id INT
        u16le(2024), // yr YEAR → e8 07
        u32le(12345), // followup INT → 39 30 00 00
        u16le(42), // control SMALLINT
        u16le(2001), // yr_last YEAR → d1 07
      ]),
    ),
  );
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
  return Buffer.concat(packets);
}

// Text-protocol (COM_QUERY) result set for the same row: every value is a
// length-encoded ASCII string.
function textResultSet(startSeq: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(packet(seq++, Buffer.from([columns.length])));
  for (const c of columns) packets.push(packet(seq++, c));
  packets.push(
    packet(
      seq++,
      Buffer.concat([lenencStr("1"), lenencStr("2024"), lenencStr("12345"), lenencStr("42"), lenencStr("2001")]),
    ),
  );
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
  return Buffer.concat(packets);
}

function startMockServer() {
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

test("YEAR before other columns is read as 2 bytes (binary protocol)", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    const [row] = await sql`SELECT id, yr, followup, control, yr_last FROM t`;
    expect(row).toEqual({ id: 1, yr: 2024, followup: 12345, control: 42, yr_last: 2001 });

    const [rawRow] = await sql`SELECT id, yr, followup, control, yr_last FROM t`.raw();
    expect(rawRow).toHaveLength(5);
    expect(rawRow[1]).toEqual(new Uint8Array([0xe8, 0x07])); // 2024
    expect(rawRow[2]).toEqual(new Uint8Array([0x39, 0x30, 0x00, 0x00])); // 12345
    expect(rawRow[4]).toEqual(new Uint8Array([0xd1, 0x07])); // 2001
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("YEAR is returned as a number via the text protocol (.simple())", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    // COM_QUERY uses the text protocol; YEAR must decode to the same JS number
    // as the prepared/binary path instead of falling through to the string arm.
    const [row] = await sql`SELECT id, yr, followup, control, yr_last FROM t`.simple();
    expect(row).toEqual({ id: 1, yr: 2024, followup: 12345, control: 42, yr_last: 2001 });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
