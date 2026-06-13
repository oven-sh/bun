// Postgres' binary NUMERIC wire format is {ndigits, weight, sign, dscale,
// digits[]} where each digit is a base-10000 group. get_str_from_var in
// numeric.c prints the fractional part with two independent counters: a
// base-10000 digit index `d` (++ per group) and a decimal-position counter `i`
// (+= DEC_DIGITS per group). A decoder that collapses both into one index
// walks the leading-zero region 4x too fast and, for weight <= -3, drops
// leading "0000" groups — returning e.g. "0.000010000" for 1e-9.
//
// Uses a minimal mock Postgres server so the test runs without Docker. The
// server replies to the simple 'Q' protocol but marks the result column as
// binary (format=1) so Bun's binary NUMERIC decoder is exercised.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

function pkt(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}
function i16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}
function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}
function i32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}
function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s), Buffer.from([0])]);
}

const NUMERIC_OID = 1700;

function rowDescription(name: string): Buffer {
  return pkt(
    "T",
    Buffer.concat([
      i16(1), // 1 column
      cstr(name),
      i32(0), // table oid
      i16(0), // column attr number
      i32(NUMERIC_OID),
      i16(-1), // type size
      i32(-1), // type modifier
      i16(1), // format: 1 = binary
    ]),
  );
}

function dataRow(col: Buffer): Buffer {
  return pkt("D", Buffer.concat([i16(1), i32(col.length), col]));
}

// Encode a Postgres binary NUMERIC field.
function numeric(ndigits: number, weight: number, sign: number, dscale: number, digits: number[]): Buffer {
  return Buffer.concat([i16(ndigits), i16(weight), u16(sign), i16(dscale), ...digits.map(u16)]);
}

const authenticationOk = pkt("R", i32(0));
const readyForQuery = pkt("Z", Buffer.from("I"));
const commandComplete = pkt("C", cstr("SELECT 1"));

async function decodeNumeric(bytes: Buffer): Promise<unknown> {
  const server = net.createServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([authenticationOk, readyForQuery]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' */) return;
      socket.write(Buffer.concat([rowDescription("n"), dataRow(bytes), commandComplete, readyForQuery]));
    });
    socket.on("error", () => {});
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const [row]: any = await sql`select n`.simple();
    return row.n;
  } finally {
    await sql.close().catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

// Wire-format encodings for each test value. weight/dscale/digits match what a
// real Postgres server sends (verified against psql).
const cases: { literal: string; bytes: Buffer }[] = [
  // --- weight <= -3: previously corrupted --------------------------------
  { literal: "0.000000001", bytes: numeric(1, -3, 0x0000, 9, [1000]) },
  { literal: "0.000000000001", bytes: numeric(1, -3, 0x0000, 12, [1]) },
  { literal: "0.00000000123", bytes: numeric(1, -3, 0x0000, 11, [1230]) },
  { literal: "0.0000000000001", bytes: numeric(1, -4, 0x0000, 13, [1000]) },
  { literal: "-0.000000001", bytes: numeric(1, -3, 0x4000, 9, [1000]) },
  { literal: "0.00000000000000012345", bytes: numeric(2, -4, 0x0000, 20, [1, 2345]) },
  // --- boundary & previously-correct paths: must remain unchanged --------
  { literal: "0.00000001", bytes: numeric(1, -2, 0x0000, 8, [1]) },
  { literal: "0.0001", bytes: numeric(1, -1, 0x0000, 4, [1]) },
  { literal: "123.456", bytes: numeric(2, 0, 0x0000, 3, [123, 4560]) },
  { literal: "1000000", bytes: numeric(1, 1, 0x0000, 0, [100]) },
  { literal: "0", bytes: numeric(0, 0, 0x0000, 0, []) },
  { literal: "0.123456789012345", bytes: numeric(4, -1, 0x0000, 15, [1234, 5678, 9012, 3450]) },
  { literal: "12345678.000000009", bytes: numeric(5, 1, 0x0000, 9, [1234, 5678, 0, 0, 9000]) },
];

test.each(cases)("binary NUMERIC decodes $literal", async ({ literal, bytes }) => {
  expect(await decodeNumeric(bytes)).toBe(literal);
});
