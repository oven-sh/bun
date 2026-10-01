// Postgres binary NUMERIC encodes the mantissa as base-10000 digit words
// (Int16, valid range 0..=9999). numeric_recv in Postgres rejects anything
// outside that range with `invalid digit in external "numeric" value`. Bun's
// decoder fed the raw u16 straight into a 4-wide zero-padded formatter, so a
// hostile server sending digit=10000 panicked debug_assert builds and silently
// dropped high digits on release (10000 -> "", 10001 -> "1").

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

const NUMERIC_OID = 1700;

function be16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}

// Postgres numeric_send(): Int16 ndigits, Int16 weight, uint16 sign, uint16 dscale, then ndigits Int16 digits.
function numericDatum(ndigits: number, weight: number, sign: number, dscale: number, digits: number[]): Buffer {
  return Buffer.concat([be16(ndigits), be16(weight), be16(sign), be16(dscale), ...digits.map(be16)]);
}

async function selectNumeric(datum: Buffer): Promise<{ value?: unknown; error?: any }> {
  const { port, server } = await listeningServer(socket => {
    let startup = true;
    socket.on("data", () => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      socket.write(
        Buffer.concat([
          pgRowDescription([{ name: "n", typeOid: NUMERIC_OID, format: 1 }]),
          pgDataRow([datum]),
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
    try {
      const [row]: any = await sql`select x`.simple();
      return { value: row.n };
    } catch (error) {
      return { error };
    }
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
}

// Out-of-range digit words a hostile server/proxy can author. 10000 is the
// smallest invalid value (NBASE itself); 65535 is the u16 maximum.
const badIntegerDigits = [10000, 10001, 32768, 65535];

test.each(badIntegerDigits)("binary NUMERIC rejects out-of-range digit word %p in the integer part", async d => {
  // ndigits=1 weight=0 sign=+ dscale=0 digit=d : the integer-part decode loop.
  const { value, error } = await selectNumeric(numericDatum(1, 0, 0x0000, 0, [d]));
  expect(value).toBeUndefined();
  expect({ code: error?.code, name: error?.name }).toEqual({
    code: "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT",
    name: "PostgresError",
  });
});

test("binary NUMERIC rejects out-of-range digit word in the fractional part", async () => {
  // ndigits=1 weight=-1 sign=+ dscale=4 digit=10000 : the dscale decode loop.
  const { value, error } = await selectNumeric(numericDatum(1, -1, 0x0000, 4, [10000]));
  expect(value).toBeUndefined();
  expect({ code: error?.code, name: error?.name }).toEqual({
    code: "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT",
    name: "PostgresError",
  });
});

test("binary NUMERIC still decodes in-range digit words", async () => {
  // digit=9999 is the maximum valid digit.
  expect(await selectNumeric(numericDatum(1, 0, 0x0000, 0, [9999]))).toEqual({ value: "9999" });
  // ndigits=2 weight=1 digits=[1,2345] -> "1" + "2345" -> "12345"
  expect(await selectNumeric(numericDatum(2, 1, 0x0000, 0, [1, 2345]))).toEqual({ value: "12345" });
});
