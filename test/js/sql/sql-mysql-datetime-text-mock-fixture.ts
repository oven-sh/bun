// Fixture: decode MySQL text-protocol DATE/DATETIME values through a minimal
// mock MySQL server (no Docker / live server needed) and print the resulting
// epoch-ms values as JSON.
//
// The text protocol sends dates as wall-clock strings with no timezone
// (`2024-06-15 12:34:56`). The decoder must treat those components as UTC —
// the same convention the binary protocol and the encode path use — so the
// printed values must be identical regardless of this process's TZ.
//
// Spawned by sql-mysql-datetime-roundtrip.test.ts under several TZ values.

import { SQL } from "bun";
import { once } from "events";
import net from "net";

// --- MySQL wire format helpers (mirrors sql-mysql-raw-length-prefix.test.ts) ---

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
  throw new Error("lenenc: only the 1-byte form is needed for this fixture");
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

const MYSQL_TYPE_DATE = 0x0a;
const MYSQL_TYPE_DATETIME = 0x0c;

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

function okPacket(seq: number): Buffer {
  return packet(seq, Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

function columnDefinition(name: string, type: number): Buffer {
  return Buffer.concat([
    lenencStr("def"),
    lenencStr(""),
    lenencStr("t"),
    lenencStr("t"),
    lenencStr(name),
    lenencStr(name),
    Buffer.from([0x0c]), // fixed-length-fields length = 12
    u16le(33), // utf8_general_ci
    u32le(32), // column_length (display width)
    Buffer.from([type]),
    u16le(0), // flags
    Buffer.from([0]), // decimals
    Buffer.from([0, 0]), // reserved
  ]);
}

// The columns this fixture serves, with the wall-clock text the mock server
// sends and the UTC instant (or NaN) the decoder must produce for it.
export const COLUMNS: { name: string; type: number; text: string; expected: number }[] = [
  {
    name: "dt",
    type: MYSQL_TYPE_DATETIME,
    text: "2024-06-15 12:34:56",
    expected: Date.UTC(2024, 5, 15, 12, 34, 56),
  },
  {
    name: "dt_frac",
    type: MYSQL_TYPE_DATETIME,
    text: "2024-06-15 12:34:56.123456",
    expected: Date.UTC(2024, 5, 15, 12, 34, 56, 123),
  },
  {
    name: "d",
    type: MYSQL_TYPE_DATE,
    text: "2024-06-15",
    expected: Date.UTC(2024, 5, 15),
  },
  {
    name: "zero_date",
    type: MYSQL_TYPE_DATETIME,
    text: "0000-00-00 00:00:00",
    expected: NaN,
  },
  {
    name: "impossible_date",
    type: MYSQL_TYPE_DATETIME,
    text: "2024-02-31 00:00:00",
    expected: NaN,
  },
];

// Text-protocol result set: one row whose cells are the COLUMNS texts.
function textResultSet(startSeq: number): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(packet(seq++, Buffer.from([COLUMNS.length])));
  for (const col of COLUMNS) {
    packets.push(packet(seq++, columnDefinition(col.name, col.type)));
  }
  packets.push(packet(seq++, Buffer.concat(COLUMNS.map(col => lenencStr(col.text)))));
  // OK packet closing the result set (CLIENT_DEPRECATE_EOF, header 0xfe).
  packets.push(packet(seq++, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00])));
  return Buffer.concat(packets);
}

if (import.meta.main) {
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
          socket.write(textResultSet(seq + 1));
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
    // `.simple()` forces the text protocol → ResultSet text decode → DateTime::from_text.
    const rows = (await sql`SELECT * FROM t`.simple()) as Record<string, Date>[];
    console.log(
      JSON.stringify({
        tz: process.env.TZ,
        offsetMin: new Date(Date.UTC(2024, 5, 15, 12, 34, 56)).getTimezoneOffset(),
        // NaN is not representable in JSON; stringify getTime() instead.
        values: Object.fromEntries(COLUMNS.map(col => [col.name, String(rows[0][col.name]?.getTime())])),
      }),
    );
  } finally {
    server.close();
  }
}
