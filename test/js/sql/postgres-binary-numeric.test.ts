// Postgres' binary NUMERIC wire format is {ndigits, weight, sign, dscale,
// digits[]} where each digit is a base-10000 group. get_str_from_var in
// numeric.c prints the fractional part with two independent counters: a
// base-10000 digit index `d` (++ per group) and a decimal-position counter `i`
// (+= DEC_DIGITS per group). A decoder that collapses both into one index
// walks the leading-zero region 4x too fast and, for weight <= -3, drops
// leading "0000" groups — returning e.g. "0.000010000" for 1e-9.
//
// Runs against a real Postgres server. The default tagged-template path uses
// the extended protocol and requests binary result format for NUMERIC (OID
// 1700, see is_binary_format_supported in src/sql/postgres/types/Tag.rs), so
// Bun's binary NUMERIC decoder is exercised.

import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Each literal is round-tripped through `'<literal>'::numeric`. The server
// parses the text, encodes it as binary NUMERIC on the wire, and Bun's decoder
// must reproduce the exact same string.
const cases: string[] = [
  // --- weight <= -3: previously corrupted --------------------------------
  "0.000000001",
  "0.000000000001",
  "0.00000000123",
  "0.0000000000001",
  "-0.000000001",
  "0.00000000000000012345",
  // --- boundary & previously-correct paths: must remain unchanged --------
  "0.00000001",
  "0.0001",
  "123.456",
  "1000000",
  "0",
  "0.123456789012345",
  "12345678.000000009",
];

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test.each(cases)("binary NUMERIC decodes %s", async literal => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    const [row] = await sql`SELECT ${literal}::numeric AS n`;
    expect(row.n).toBe(literal);
  });
});

// --- Wire-valid but non-normalised encodings -------------------------------
// Postgres' numeric_recv accepts any digit word in [0, 10000), so a proxy or
// hand-rolled encoder may legally send a NUMERIC whose only digit group is 0.
// Postgres' get_str_from_var always emits the ones digit of the first group
// (the final `*cp++ = dig + '0'` has no putit guard), so these decode to "0",
// "0.00", "-0". A real server never emits them (it normalises to ndigits=0),
// so a mock server is required. See test/js/sql/wire-frames.ts.

const NUMERIC_OID = 1700;

function numericCell(ndigits: number, weight: number, sign: number, dscale: number, digits: number[]): Buffer {
  const b = Buffer.alloc(8 + 2 * digits.length);
  b.writeInt16BE(ndigits, 0);
  b.writeInt16BE(weight, 2);
  b.writeUInt16BE(sign, 4);
  b.writeInt16BE(dscale, 6);
  for (let i = 0; i < digits.length; i++) b.writeUInt16BE(digits[i], 8 + 2 * i);
  return b;
}

async function decodeNumeric(col: Buffer): Promise<unknown> {
  const { port, server } = await listeningServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' */) return;
      socket.write(
        Buffer.concat([
          pgRowDescription([{ name: "n", typeOid: NUMERIC_OID, format: 1 }]),
          pgDataRow([col]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ]),
      );
    });
    socket.on("error", () => {});
  });
  try {
    await using sql = new SQL({
      url: `postgres://u@127.0.0.1:${port}/db`,
      max: 1,
      idleTimeout: 5,
      connectionTimeout: 5,
    });
    const [row]: any = await sql`select n`.simple();
    return row.n;
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

// Expected values are what Postgres' own get_str_from_var prints for the same
// wire bytes (numeric.c), which is what every other binary-protocol client
// produces.
const zeroGroup: { name: string; col: Buffer; want: string }[] = [
  { name: "ndigits=1 digits=[0]", col: numericCell(1, 0, 0x0000, 0, [0]), want: "0" },
  { name: "ndigits=1 digits=[0] dscale=2", col: numericCell(1, 0, 0x0000, 2, [0]), want: "0.00" },
  { name: "ndigits=1 digits=[0] negative", col: numericCell(1, 0, 0x4000, 0, [0]), want: "-0" },
  { name: "ndigits=2 digits=[0,5] weight=1", col: numericCell(2, 1, 0x0000, 0, [0, 5]), want: "00005" },
];

describe("binary NUMERIC with a zero first digit group (non-normalised, wire-valid)", () => {
  test.each(zeroGroup)("$name decodes to $want", async ({ col, want }) => {
    expect(await decodeNumeric(col)).toBe(want);
  });

  // Postgres numeric_recv reads ndigits as uint16 and always reads that many
  // digit words, so 0xFFFF fails the buffer read regardless of sign.
  test.each([
    { sign: 0x0000, label: "positive" },
    { sign: 0xc000, label: "NaN" },
  ])("negative ndigits is rejected (sign=$label)", async ({ sign }) => {
    let err: any;
    try {
      await decodeNumeric(numericCell(-1, 0, sign, 0, []));
    } catch (e) {
      err = e;
    }
    expect({ code: err?.code, name: err?.name }).toEqual({
      code: "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT",
      name: "PostgresError",
    });
  });

  test("well-formed NaN (ndigits=0, sign=0xC000) still decodes", async () => {
    expect(await decodeNumeric(numericCell(0, 0, 0xc000, 0, []))).toBe("NaN");
  });
});
