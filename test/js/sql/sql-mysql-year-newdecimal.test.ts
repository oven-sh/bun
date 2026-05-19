// Regression for https://github.com/oven-sh/bun/issues/30854
//
// MYSQL_TYPE_YEAR (0x0d) in the binary result-set protocol is a bare 2-byte
// little-endian u16 — the same wire shape as MYSQL_TYPE_SHORT, with NO
// length prefix. The MySQL client's binary-row decoder had no explicit
// branch for YEAR, so it fell through to the default arm which read
// `column_length` bytes (the ColumnDefinition41 *display width*, typically
// 4 for `YEAR(4)`) instead. The cursor over-read by 2 bytes and misaligned
// every subsequent column.
//
// When the next column is length-prefixed (NEWDECIMAL, VARCHAR, JSON, ...)
// the stray bytes re-enter the length decoder as a length prefix, driving
// the row parser into an unbounded wait — the query promise never resolves,
// even though the event loop stays alive (#30854).
//
// Uses a minimal mock MySQL server so the test runs without Docker or a
// live MySQL installation. We send a crafted binary-protocol row where
// YEAR is immediately followed by NEWDECIMAL. Before the fix the
// assertion below times out; after the fix the row decodes correctly.

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

// MYSQL_TYPE_* values. From src/sql/mysql/MySQLTypes.rs.
const MYSQL_TYPE_YEAR = 0x0d;
const MYSQL_TYPE_NEWDECIMAL = 0xf6;
const MYSQL_TYPE_DATETIME = 0x0c;
const MYSQL_TYPE_VAR_STRING = 0xfd;
const MYSQL_TYPE_INT24 = 0x09;

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

function columnDefinition(name: string, type: number, columnLength: number): Buffer {
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
    u32le(columnLength), // column_length (display width)
    Buffer.from([type]),
    u16le(0), // flags
    Buffer.from([0]), // decimals
    Buffer.from([0, 0]), // reserved
  ]);
}

// COM_STMT_PREPARE response: OK header + num_params param defs + num_columns column defs.
// CLIENT_DEPRECATE_EOF was negotiated in the handshake, so no trailing EOF packets.
function stmtPrepareOK(startSeq: number, statementId: number, params: Buffer[], columns: Buffer[]): Buffer {
  const packets: Buffer[] = [];
  let seq = startSeq;
  packets.push(
    packet(
      seq++,
      Buffer.concat([
        Buffer.from([0x00]),
        u32le(statementId),
        u16le(columns.length), // num_columns
        u16le(params.length), // num_params
        Buffer.from([0x00]), // reserved
        u16le(0), // warning_count
      ]),
    ),
  );
  for (const p of params) packets.push(packet(seq++, p));
  for (const col of columns) packets.push(packet(seq++, col));
  return Buffer.concat(packets);
}

// Binary row: 0x00 header, then NULL bitmap of (num_columns + 7 + 2) / 8
// bytes (integer division per the MySQL spec — two reserved bits up front),
// then each non-null column's binary encoding.
function binaryRow(seq: number, numColumns: number, columnBytes: Buffer[]): Buffer {
  const bitmapLen = Math.floor((numColumns + 7 + 2) / 8);
  return packet(
    seq,
    Buffer.concat([
      Buffer.from([0x00]), // packet header
      Buffer.alloc(bitmapLen, 0), // NULL bitmap — no NULLs
      ...columnBytes,
    ]),
  );
}

function deprecateEofOk(seq: number): Buffer {
  return packet(seq, Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
}

// --- The payloads exercising the bug ---------------------------------------

// MYSQL_TYPE_YEAR is a bare 2-byte little-endian u16 on the wire. 2022 → 0xe6 0x07.
function encodeYear(year: number): Buffer {
  return u16le(year);
}

// MYSQL_TYPE_NEWDECIMAL is length-prefixed ASCII. "123" → 0x03 0x31 0x32 0x33.
function encodeNewdecimal(text: string): Buffer {
  return lenencStr(text);
}

// MYSQL_TYPE_DATETIME (binary): 1 length byte + 4/7/11 bytes. Use the 7-byte
// form: length=7, year(u16), month, day, hour, minute, second.
function encodeDatetime7(year: number, month: number, day: number, h: number, m: number, s: number): Buffer {
  return Buffer.concat([Buffer.from([7]), u16le(year), Buffer.from([month, day, h, m, s])]);
}

// MYSQL_TYPE_INT24 (MEDIUMINT) is sent as a 4-byte little-endian integer on
// the wire — the server zero-extends the high byte. Reading only 3 bytes
// misaligns the cursor the same way YEAR did pre-fix.
function encodeInt24(value: number): Buffer {
  return u32le(value);
}

// --- Test ------------------------------------------------------------------

interface MockOptions {
  // How to lay out the columns of the binary result row.
  layout:
    | "year-then-newdecimal"
    | "newdecimal-then-year"
    | "year-alone"
    | "year-then-datetime"
    | "int24-then-newdecimal";
  // Number of `?` placeholders in the prepared statement.
  numParams: number;
}

function startMockServer(opts: MockOptions) {
  const server = net.createServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let preparedColumns: { name: string; type: number; columnLength: number }[] = [];

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
          // Pick the column set for this layout.
          switch (opts.layout) {
            case "year-then-newdecimal":
              preparedColumns = [
                { name: "fullYear", type: MYSQL_TYPE_YEAR, columnLength: 4 },
                { name: "milliseconds", type: MYSQL_TYPE_NEWDECIMAL, columnLength: 10 },
              ];
              break;
            case "newdecimal-then-year":
              preparedColumns = [
                { name: "milliseconds", type: MYSQL_TYPE_NEWDECIMAL, columnLength: 10 },
                { name: "fullYear", type: MYSQL_TYPE_YEAR, columnLength: 4 },
              ];
              break;
            case "year-alone":
              preparedColumns = [{ name: "value", type: MYSQL_TYPE_YEAR, columnLength: 4 }];
              break;
            case "year-then-datetime":
              preparedColumns = [
                { name: "y", type: MYSQL_TYPE_YEAR, columnLength: 4 },
                { name: "ts", type: MYSQL_TYPE_DATETIME, columnLength: 19 },
              ];
              break;
            case "int24-then-newdecimal":
              preparedColumns = [
                { name: "mi", type: MYSQL_TYPE_INT24, columnLength: 8 },
                { name: "dec", type: MYSQL_TYPE_NEWDECIMAL, columnLength: 10 },
              ];
              break;
          }
          const paramDefs = Array.from({ length: opts.numParams }, (_, i) =>
            columnDefinition(`p${i}`, MYSQL_TYPE_VAR_STRING, 255),
          );
          const colDefs = preparedColumns.map(c => columnDefinition(c.name, c.type, c.columnLength));
          socket.write(stmtPrepareOK(seq + 1, 1, paramDefs, colDefs));
        } else if (cmd === 0x17 /* COM_STMT_EXECUTE */) {
          // Build the result set for this layout.
          const colDefs = preparedColumns.map(c => columnDefinition(c.name, c.type, c.columnLength));
          let rowColumns: Buffer[];
          switch (opts.layout) {
            case "year-then-newdecimal":
              rowColumns = [encodeYear(2022), encodeNewdecimal("123")];
              break;
            case "newdecimal-then-year":
              rowColumns = [encodeNewdecimal("123"), encodeYear(2022)];
              break;
            case "year-alone":
              rowColumns = [encodeYear(2022)];
              break;
            case "year-then-datetime":
              rowColumns = [encodeYear(2013), encodeDatetime7(2024, 5, 1, 12, 0, 0)];
              break;
            case "int24-then-newdecimal":
              rowColumns = [encodeInt24(1_234_567), encodeNewdecimal("42.0")];
              break;
          }
          const packets: Buffer[] = [];
          let s = seq + 1;
          packets.push(packet(s++, Buffer.from([colDefs.length]))); // column count
          for (const cd of colDefs) packets.push(packet(s++, cd));
          packets.push(binaryRow(s++, preparedColumns.length, rowColumns));
          packets.push(deprecateEofOk(s++));
          socket.write(Buffer.concat(packets));
        } else {
          socket.end();
        }
      }
    });
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  return server;
}

async function runQuery(layout: MockOptions["layout"], query: string, params: unknown[]) {
  const server = startMockServer({ layout, numParams: params.length });
  try {
    await once(server, "listening");
    const { port } = server.address() as net.AddressInfo;
    await using sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    // .unsafe() with a non-empty params array uses the binary/prepared
    // protocol (COM_STMT_PREPARE + COM_STMT_EXECUTE), which routes the
    // result row through decode_binary_value — where the bug lives.
    return await sql.unsafe(query, params);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

test("MYSQL_TYPE_YEAR decodes as a number (#30854, #29471)", async () => {
  const rows = await runQuery("year-alone", "select year(?) as value", ["2022-11-21 19:33:56.123"]);
  // Before the fix: value was a 4-byte Buffer (e.g. <Buffer e6 07 07 00>).
  // After the fix: value is the number 2022 (decoded from the 2-byte u16).
  expect(rows[0].value).toBe(2022);
});

test("NEWDECIMAL followed by YEAR — YEAR decodes correctly (#30854)", async () => {
  const rows = await runQuery(
    "newdecimal-then-year",
    "select round(microsecond(?) / 1000) as milliseconds, year(?) as fullYear",
    ["2022-11-21 19:33:56.123", "2022-11-21 19:33:56.123"],
  );
  // Before the fix this arrangement already resolved, but the YEAR value
  // was a Buffer. Guard both columns.
  expect(rows[0].milliseconds).toBe("123");
  expect(rows[0].fullYear).toBe(2022);
});

test("YEAR followed by NEWDECIMAL does not hang the query promise (#30854)", async () => {
  // This is the defining case from the issue. Pre-fix the decoder
  // over-read YEAR by 2 bytes, mis-consumed the NEWDECIMAL length prefix,
  // then waited forever for bytes that never arrive.
  const rows = await runQuery(
    "year-then-newdecimal",
    "select year(?) as fullYear, round(microsecond(?) / 1000) as milliseconds",
    ["2022-11-21 19:33:56.123", "2022-11-21 19:33:56.123"],
  );
  expect(rows[0].fullYear).toBe(2022);
  expect(rows[0].milliseconds).toBe("123");
});

test("YEAR followed by DATETIME — DATETIME is not corrupted by a YEAR over-read (#29471)", async () => {
  // A 2-byte YEAR over-read used to eat the DATETIME's length byte + a
  // pair of date bytes, driving the datetime decoder at absurd dates
  // (3588-06-02, 7435-05-31 in the reports) or an InvalidBinaryValue.
  //
  // MySQL's DATETIME wire format has no timezone: the decoder feeds the
  // wall-clock components through `gregorianDateTimeToMS(..., localTime=
  // true)`, so compare against a local-time Date constructor rather than
  // `Date.UTC(...)` — test/preload.ts deliberately preserves the host's
  // TZ in-process, so hard-coding a UTC offset would be flaky off-CI.
  const rows = await runQuery("year-then-datetime", "select y, ts from t where y = ?", [2013]);
  expect(rows[0].y).toBe(2013);
  expect(rows[0].ts).toEqual(new Date(2024, 4, 1, 12, 0, 0));
});

test("INT24/MEDIUMINT consumes 4 wire bytes, not 3", async () => {
  // MYSQL_TYPE_INT24 is encoded on the binary wire as a 4-byte little-endian
  // integer (server sign/zero-extends the high byte — mysql2 reads this with
  // readInt32). The port originally advanced the cursor by only 3 bytes,
  // leaving the extension byte in the stream. With NEWDECIMAL following,
  // that orphaned byte becomes the next column's length prefix → garbage
  // decimal or hang, identical failure mode to #30854 for YEAR. Single-
  // column tests masked this because the extra byte ended the row cleanly.
  const rows = await runQuery("int24-then-newdecimal", "select mi, dec from t where mi = ?", [1_234_567]);
  expect(rows[0].mi).toBe(1_234_567);
  expect(rows[0].dec).toBe("42.0");
});
