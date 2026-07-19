// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Regression: the binary TIME decoder read the 4-byte `days` field as a raw u32
// with no range check and computed total_hours = hours + days*24 in u32. MySQL
// TIME is bounded to +/-838:59:59 (days <= 34), so a hostile or buggy server
// sending days=178956971 made days*24 wrap past 2^32 to 8 and Bun returned the
// string "08:05:06" with no error. With the fix the decoder rejects any TIME
// field outside its documented range with ERR_MYSQL_INVALID_BINARY_VALUE.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlLenencInt,
  mysqlOkPacket,
  mysqlRawPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const COM_STMT_CLOSE = 0x19;
const COM_QUIT = 0x01;
const MYSQL_TYPE_TIME = 0x0b;

// MySQL binary-protocol TIME cell (page_protocol_binary_resultset.html):
//   Int<1>(length = 8 | 12) Int<1>(is_negative) Int<4>(days) Int<1>(hours)
//   Int<1>(minutes) Int<1>(seconds) [Int<4>(microseconds)]
// mysqlRawPacket is the low-level escape hatch because this is the malformed
// payload under test; every other frame goes through a typed helper.
function binaryTimeRow(seq: number, t: { days: number; hours: number; minutes: number; seconds: number }): Buffer {
  const cell = Buffer.alloc(9);
  cell[0] = 8;
  cell[1] = 0; // is_negative
  cell.writeUInt32LE(t.days >>> 0, 2);
  cell[6] = t.hours;
  cell[7] = t.minutes;
  cell[8] = t.seconds;
  // Binary Resultset Row: Int<1>(0x00 header) null_bitmap[(cols+7+2)/8] values
  return mysqlRawPacket(seq, Buffer.concat([Buffer.from([0x00, 0x00]), cell]));
}

async function serveOneBinaryTime(t: { days: number; hours: number; minutes: number; seconds: number }) {
  let sawExecute = false;
  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        const cmd = payload[0];
        if (cmd === COM_STMT_PREPARE) {
          socket.write(
            Buffer.concat([
              mysqlStmtPrepareOk(1, 1, 1, 1),
              mysqlColumnDefinition(2, { name: "p", type: MYSQL_TYPE_TIME }),
              mysqlColumnDefinition(3, { name: "t", type: MYSQL_TYPE_TIME }),
            ]),
          );
        } else if (cmd === COM_STMT_EXECUTE) {
          sawExecute = true;
          socket.write(
            Buffer.concat([
              mysqlRawPacket(1, mysqlLenencInt(1)),
              mysqlColumnDefinition(2, { name: "t", type: MYSQL_TYPE_TIME }),
              binaryTimeRow(3, t),
              mysqlOkPacket(4, 0xfe),
            ]),
          );
        } else if (cmd !== COM_STMT_CLOSE && cmd !== COM_QUIT) {
          socket.write(mysqlOkPacket(1));
        }
      });
    });
    socket.on("error", () => {});
  });
  return { server, port, sawExecute: () => sawExecute };
}

test.each([
  // 178956971 * 24 = 2^32 + 8: pre-fix this wrapped to total_hours=8 -> "08:05:06".
  ["days wraps u32*24", { days: 178956971, hours: 0, minutes: 5, seconds: 6 }],
  ["days = u32::MAX", { days: 0xffff_ffff, hours: 0, minutes: 5, seconds: 6 }],
  ["days just over the 34-day bound", { days: 35, hours: 0, minutes: 0, seconds: 0 }],
  ["hours > 23", { days: 0, hours: 24, minutes: 0, seconds: 0 }],
  ["minutes > 59", { days: 0, hours: 0, minutes: 60, seconds: 0 }],
  ["seconds > 59", { days: 0, hours: 0, minutes: 0, seconds: 60 }],
] as const)("MySQL: binary TIME with %s is rejected, not silently wrapped", async (_label, t) => {
  const { server, port, sawExecute } = await serveOneBinaryTime(t);
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const outcome = await sql`select ${1} as t`.values().then(
      rows => ({ ok: true as const, rows }),
      e => ({ ok: false as const, code: e?.code ?? String(e) }),
    );

    // Pre-fix: outcome is { ok: true, rows: [["08:05:06"]] } (or similar garbage).
    expect({ outcome, sawExecute: sawExecute() }).toEqual({
      outcome: { ok: false, code: "ERR_MYSQL_INVALID_BINARY_VALUE" },
      sawExecute: true,
    });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});

test("MySQL: binary TIME at the documented maximum (838:59:59) still decodes", async () => {
  const { server, port, sawExecute } = await serveOneBinaryTime({ days: 34, hours: 22, minutes: 59, seconds: 59 });
  try {
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    const rows = await sql`select ${1} as t`.values();
    expect({ rows, sawExecute: sawExecute() }).toEqual({ rows: [["838:59:59"]], sawExecute: true });
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
});
