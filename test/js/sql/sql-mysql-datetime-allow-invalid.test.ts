// With ALLOW_INVALID_DATES, MySQL stores day-of-month 1..31 regardless of the
// actual month length (Feb 30, Apr 31) and returns those components as-is over
// the binary prepared-statement protocol. GregorianDateTime normalizes them the
// same way Date.UTC does (Feb 30 → Mar 1), so the decoder must yield a valid
// Date — not Invalid Date. Zero month/day (NO_ZERO_IN_DATE off) must still
// decode to Invalid Date.
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
  throw new Error("lenenc: only the 1-byte form is needed for this test");
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

const MYSQL_TYPE_LONG = 0x03;
const MYSQL_TYPE_DATE = 0x0a;
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
    u32le(32),
    Buffer.from([type]),
    u16le(0),
    Buffer.from([0]),
    Buffer.from([0, 0]),
  ]);
}

// Binary DATETIME field: [len=7][year:u16le][month][day][hour][minute][second]
function binDateTime(y: number, m: number, d: number, hh: number, mm: number, ss: number): Buffer {
  return Buffer.concat([Buffer.from([7]), u16le(y), Buffer.from([m, d, hh, mm, ss])]);
}
// Binary DATE field: [len=4][year:u16le][month][day]
function binDate(y: number, m: number, d: number): Buffer {
  return Buffer.concat([Buffer.from([4]), u16le(y), Buffer.from([m, d])]);
}

const columns = [
  columnDef("feb30", MYSQL_TYPE_DATETIME),
  columnDef("apr31", MYSQL_TYPE_DATETIME),
  columnDef("feb29_nonleap", MYSQL_TYPE_DATE),
  columnDef("zero_month", MYSQL_TYPE_DATETIME),
  columnDef("zero_day", MYSQL_TYPE_DATETIME),
  columnDef("tail", MYSQL_TYPE_LONG),
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
  // Binary row: 0x00 header, NULL bitmap ((6+7+2)/8 = 1 byte), then values.
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]), // row header
        Buffer.from([0x00]), // null bitmap: nothing null
        binDateTime(2024, 2, 30, 12, 0, 0), // ALLOW_INVALID_DATES: Feb 30 (leap year)
        binDateTime(2024, 4, 31, 12, 0, 0), // ALLOW_INVALID_DATES: Apr 31
        binDate(2023, 2, 29), // ALLOW_INVALID_DATES: Feb 29 in a non-leap year
        binDateTime(2024, 0, 15, 12, 0, 0), // NO_ZERO_IN_DATE off: month = 0
        binDateTime(2024, 6, 0, 12, 0, 0), // NO_ZERO_IN_DATE off: day = 0
        u32le(42), // sentinel: proves the cursor stayed in sync past the DATETIMEs
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
          socket.write(binaryResultSet(seq + 1));
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

test("binary DATETIME with ALLOW_INVALID_DATES day-of-month normalizes, zero month/day stays Invalid Date", async () => {
  const server = startMockServer();
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });

    const [row] = await sql`SELECT * FROM t`;

    expect({
      feb30: (row.feb30 as Date).getTime(),
      apr31: (row.apr31 as Date).getTime(),
      feb29_nonleap: (row.feb29_nonleap as Date).getTime(),
      zero_month: (row.zero_month as Date).getTime(),
      zero_day: (row.zero_day as Date).getTime(),
      tail: row.tail,
    }).toEqual({
      // Over-range day → GregorianDateTime normalizes exactly like Date.UTC.
      feb30: Date.UTC(2024, 1, 30, 12, 0, 0),
      apr31: Date.UTC(2024, 3, 31, 12, 0, 0),
      feb29_nonleap: Date.UTC(2023, 1, 29),
      // Zero month / zero day are MySQL sentinels, not overflow → Invalid Date.
      zero_month: NaN,
      zero_day: NaN,
      tail: 42,
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
