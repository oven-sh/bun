// Binding a pre-1970 `Date` as a MySQL prepared-statement parameter used to
// abort the process: `gregorian_date()` only handled non-negative day counts,
// so a negative days-since-epoch skipped both year/month loops and hit a
// `u8::try_from(negative).expect()` panic while encoding the parameter.
//
// This test stands up a minimal mock MySQL server so it runs without Docker.
// The server echoes the bound DATETIME parameter back as a result column so
// both the encode path (the bug) and the decode path are exercised.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { once } from "events";
import net from "net";

// --- MySQL wire helpers ----------------------------------------------------

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
  throw new Error("lenenc out of range for this test");
}
function lenencStr(s: string): Buffer {
  const buf = Buffer.from(s, "utf-8");
  return Buffer.concat([lenenc(buf.length), buf]);
}

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

const MYSQL_TYPE_DATETIME = 0x0c;

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

function okPacket(seq: number): Buffer {
  return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function columnDef(name: string, type: number): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]),
    u16le(33),
    u32le(64),
    Buffer.from([type]),
    u16le(0),
    Buffer.from([0]),
    Buffer.from([0, 0]),
  ]);
}

// Prepare-OK advertising one DATETIME param and one DATETIME result column.
function stmtPrepareOK(startSeq: number, stmtId: number): Buffer {
  const col = columnDef("d", MYSQL_TYPE_DATETIME);
  let seq = startSeq;
  const packets: Buffer[] = [];
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]),
        u32le(stmtId),
        u16le(1), // num_columns
        u16le(1), // num_params
        Buffer.from([0x00]),
        u16le(0),
      ]),
    ),
  );
  packets.push(packet(seq++, col)); // param definition
  packets.push(packet(seq++, col)); // column definition
  return Buffer.concat(packets);
}

// Parse the bound DATETIME parameter out of a COM_STMT_EXECUTE payload and
// echo it back as a single-column binary result row.
function echoResultSet(startSeq: number, execPayload: Buffer): Buffer {
  // COM_STMT_EXECUTE layout for one parameter:
  //   [0]       0x17
  //   [1..5]    stmt_id
  //   [5]       flags
  //   [6..10]   iteration_count
  //   [10]      null_bitmap (1 byte for 1 param)
  //   [11]      new_params_bound_flag
  //   [12..14]  param type + unsigned flag   (when new_params_bound_flag == 1)
  //   [14..]    param value: [len, year lo, year hi, month, day, hour, min, sec, (µs×4)]
  let off = 11;
  if (execPayload[off] === 1)
    off += 1 + 2; // skip flag + one (type,unsigned) pair
  else off += 1;
  const len = execPayload[off];
  const dt = execPayload.subarray(off, off + 1 + len);

  const col = columnDef("d", MYSQL_TYPE_DATETIME);
  let seq = startSeq;
  const packets: Buffer[] = [];
  packets.push(packet(seq++, Buffer.from([1]))); // column count
  packets.push(packet(seq++, col));
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]), // row header
        Buffer.from([0x00]), // null bitmap ((1+7+2)/8 = 1 byte, offset 2)
        dt,
      ]),
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
          socket.write(echoResultSet(seq + 1, payload));
        } else if (cmd === 0x03 /* COM_QUERY */) {
          socket.write(okPacket(seq + 1));
        } else if (cmd === 0x19 /* COM_STMT_CLOSE */) {
          // no response
        } else {
          socket.end();
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  return server;
}

test("pre-1970 Date parameters encode correctly and round-trip", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    const cases = [
      new Date("1969-12-31T00:00:00.000Z"),
      new Date("1969-07-20T20:17:40.000Z"),
      new Date("1900-01-01T00:00:00.000Z"),
      new Date("1970-01-01T00:00:00.000Z"),
      new Date("2024-02-29T12:34:56.000Z"),
    ];

    for (const input of cases) {
      const [row] = await sql`SELECT ${input} AS d`;
      expect(row.d).toBeInstanceOf(Date);
      expect((row.d as Date).toISOString()).toBe(input.toISOString());
    }
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
