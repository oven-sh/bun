// Covers the binary numeric decoder (parse_binary_numeric in DataCell.rs): a
// mock server feeds hand-encoded payloads so decoding runs without docker / a
// live postgres. See https://github.com/oven-sh/bun/issues/29772.
// All wire-protocol bytes come from ./wire-frames; do not inline frame bytes.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

/**
 * Build a postgres binary-numeric column payload (the value bytes carried by a
 * DataRow, not a wire frame): i16 ndigits, i16 weight, u16 sign, i16 dscale,
 * then i16 digits × ndigits.
 */
function numericBinary(ndigits: number, weight: number, sign: number, dscale: number, digits: number[]): Buffer {
  // Guard against hand-encoding mistakes that would mask test intent.
  if (digits.length !== ndigits) {
    throw new Error(`numericBinary: ndigits (${ndigits}) must equal digits.length (${digits.length})`);
  }
  for (const digit of digits) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9999) {
      throw new Error(`numericBinary: base-10000 digit out of range [0, 9999]: ${digit}`);
    }
  }
  const buf = Buffer.alloc(8 + 2 * digits.length);
  buf.writeInt16BE(ndigits, 0);
  buf.writeInt16BE(weight, 2);
  buf.writeUInt16BE(sign, 4);
  buf.writeInt16BE(dscale, 6);
  for (let i = 0; i < digits.length; i++) {
    buf.writeUInt16BE(digits[i]!, 8 + i * 2);
  }
  return buf;
}

/**
 * Decode `rows` (each a binary numeric column payload) through the real client.
 * The mock advertises binary format (oid 1700) in its RowDescription, so the
 * bytes flow through parse_binary_numeric exactly as on the prepared path.
 */
async function runQuery(rows: Buffer[]): Promise<string[]> {
  const { port, server } = await listeningServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' (simple query) */) return;
      socket.write(
        Buffer.concat([
          pgRowDescription([{ name: "v", typeOid: 1700, format: 1 }]),
          ...rows.map(r => pgDataRow([r])),
          pgCommandComplete(`SELECT ${rows.length}`),
          pgReadyForQuery(),
        ]),
      );
    });
    socket.on("error", () => {});
  });

  const sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  try {
    const result = await sql`select v`.simple();
    return result.map((r: any) => r.v as string);
  } finally {
    await sql.close().catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

// --- tests ---

test("numeric zero with dscale > 0 preserves scale on binary path (#29772)", async () => {
  // numeric(10, 4) zero: ndigits=0, weight=0, sign=0, dscale=4
  const zeros4 = numericBinary(0, 0, 0x0000, 4, []);
  expect(await runQuery([zeros4])).toEqual(["0.0000"]);
});

test("numeric zero with dscale = 0 renders as bare '0' on binary path", async () => {
  // numeric (no typmod) zero: ndigits=0, weight=0, sign=0, dscale=0
  const zeros0 = numericBinary(0, 0, 0x0000, 0, []);
  expect(await runQuery([zeros0])).toEqual(["0"]);
});

test("numeric zero with dscale > 0 preserves scale alongside non-zero rows", async () => {
  // numeric(10, 4) with values 0, 1, 1.5, 10 (ndigits, weight, sign, dscale, digits).
  const rows = [
    numericBinary(0, 0, 0x0000, 4, []), // 0
    numericBinary(1, 0, 0x0000, 4, [1]), // 1.0000
    numericBinary(2, 0, 0x0000, 4, [1, 5000]), // 1.5000
    numericBinary(1, 0, 0x0000, 4, [10]), // 10.0000
  ];
  expect(await runQuery(rows)).toEqual(["0.0000", "1.0000", "1.5000", "10.0000"]);
});

test("numeric with dscale but ndigits = 0 handles dscale > 4", async () => {
  // numeric(30, 20) zero: ndigits=0, dscale=20 → "0." + 20 zeros.
  const zeros20 = numericBinary(0, 0, 0x0000, 20, []);
  expect(await runQuery([zeros20])).toEqual(["0.00000000000000000000"]);
});

test("numeric small fractional values render correctly (weight <= -3)", async () => {
  // 0.000000001234 : ndigits=1, weight=-3, dscale=12, digits=[1234]
  const tiny = numericBinary(1, -3, 0x0000, 12, [1234]);
  expect(await runQuery([tiny])).toEqual(["0.000000001234"]);
});

test("numeric very small fractional values render correctly (weight = -5)", async () => {
  // 0.00000000000000001234 : ndigits=1, weight=-5, dscale=20, digits=[1234]
  const tinier = numericBinary(1, -5, 0x0000, 20, [1234]);
  expect(await runQuery([tinier])).toEqual(["0.00000000000000001234"]);
});

test("numeric weight = -2 renders correctly", async () => {
  // 0.00005678 : ndigits=1, weight=-2, dscale=8, digits=[5678].
  const v = numericBinary(1, -2, 0x0000, 8, [5678]);
  expect(await runQuery([v])).toEqual(["0.00005678"]);
});

test("numeric weight = -1 with two digit groups renders correctly (e.g. 0.05678)", async () => {
  // 0.05678 : ndigits=2, weight=-1, dscale=5, digits=[567, 8000]
  const v = numericBinary(2, -1, 0x0000, 5, [567, 8000]);
  expect(await runQuery([v])).toEqual(["0.05678"]);
});

test("numeric negative value with small fractional magnitude renders correctly", async () => {
  // -0.00001234 : ndigits=1, weight=-2, dscale=11, digits=[1234], sign=0x4000
  // (1234 × 10000^-2 = 1.234e-5; dscale=11 pads to "-0.00001234000").
  const v = numericBinary(1, -2, 0x4000, 11, [1234]);
  expect(await runQuery([v])).toEqual(["-0.00001234000"]);
});
