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
  pgReadFrontendMessages,
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

// --- PostgreSQL known-answer table ------------------------------------------
// The decoder returns numeric_out(numeric_recv(datum)): the text a PostgreSQL
// server prints for the value it receives from the datum. numeric_recv cuts
// the value to dscale, drops leading zero words, makes a zero unsigned, and
// rejects a datum whose length, dscale, sign or words are out of range.
//
// A PostgreSQL server sends only what numeric_recv leaves unchanged, so a
// scripted server sends the other datums. Each answer below was read from a
// PostgreSQL that got the same bytes as a binary parameter of
// `select $1::text`. REJECT means that PostgreSQL raised an error.

const POS = 0x0000;
const NEG = 0x4000;
const NAN = 0xc000;
const PINF = 0xd000;
const NINF = 0xf000;
const REJECT = Symbol("PostgreSQL rejects the datum");

const fill = (char: string, count: number) => Buffer.alloc(count, char).toString();
const nines = (count: number) => new Array<number>(count).fill(9999);

function row(
  ndigits: number,
  weight: number,
  sign: number,
  dscale: number,
  digits: number[],
  want: string | typeof REJECT,
  extraBytes = "",
) {
  const signs: Record<number, string> = { [POS]: "+", [NEG]: "-", [NAN]: "NaN", [PINF]: "+Inf", [NINF]: "-Inf" };
  const words = digits.length > 8 ? `${digits.length} x ${digits[0]}` : digits.join(",");
  return {
    name: `ndigits=${ndigits} weight=${weight} sign=${signs[sign] ?? "0x" + sign.toString(16)} dscale=${dscale} [${words}]${extraBytes && " +" + extraBytes}`,
    datum: Buffer.concat([numericDatum(ndigits, weight, sign, dscale, digits), Buffer.from(extraBytes, "hex")]),
    want,
  };
}

const table = [
  // Answers recorded from PostgreSQL 17.11 (Debian 17.11-0+deb13u1).

  // Every integer word is zero. The integer part is one "0".
  row(1, 0, POS, 0, [0], "0"), // rust_decimal 1.40.0 and older write a zero like this
  row(1, 0, POS, 2, [0], "0.00"),
  row(2, 1, POS, 0, [0, 0], "0"),
  row(1, 1, POS, 0, [0], "0"),
  row(2, 0, POS, 2, [0, 500], "0.05"), // Materialize writes 0.05 like this
  row(2, 0, NEG, 2, [0, 500], "-0.05"),
  row(2, 0, POS, 4, [0, 5], "0.0005"),
  row(3, 0, POS, 6, [0, 0, 500], "0.000005"),
  row(3, 1, POS, 2, [0, 0, 1200], "0.12"),

  // The value is zero after the cut to dscale. It has no minus sign.
  row(1, 0, NEG, 0, [0], "0"),
  row(1, 0, NEG, 2, [0], "0.00"),
  row(1, -1, NEG, 4, [0], "0.0000"),
  row(0, 0, NEG, 0, [], "0"),
  row(0, 0, NEG, 2, [], "0.00"),
  row(1, -1, NEG, 2, [12], "0.00"),
  row(1, -1, NEG, 0, [5000], "0"),
  row(2, 0, NEG, 0, [0, 9999], "0"),
  row(1, -3, NEG, 4, [5000], "0.0000"),
  row(3, -1, NEG, 9, [0, 0, 9], "0.000000000"),
  row(3, -1, NEG, 9, [0, 0, 1000], "-0.000000001"),

  // The cut goes through the last kept word: one digit more keeps the sign.
  row(2, 0, NEG, 1, [0, 999], "0.0"),
  row(2, 0, NEG, 1, [0, 1000], "-0.1"),
  row(1, -2, NEG, 5, [999], "0.00000"),
  row(1, -2, NEG, 5, [1000], "-0.00001"),
  row(1, -1, NEG, 3, [9], "0.000"),
  row(1, -1, NEG, 3, [10], "-0.001"),
  row(1, -1, NEG, 2, [99], "0.00"),
  row(1, -1, NEG, 2, [100], "-0.01"),
  row(2, -1, NEG, 5, [1234, 5000], "-0.12345"),

  // A leading zero word before a word that is not zero is dropped.
  row(2, 1, POS, 0, [0, 5], "5"),
  row(2, 1, NEG, 0, [0, 5], "-5"),
  row(3, 2, POS, 0, [0, 0, 7], "7"),
  row(3, 2, POS, 0, [0, 12, 34], "120034"),
  row(3, 1, POS, 2, [0, 5, 1200], "5.12"),
  row(2, -1, POS, 8, [0, 5], "0.00000005"),

  // A zero with no word. The weight has no effect.
  row(0, 0, POS, 0, [], "0"),
  row(0, 0, POS, 4, [], "0.0000"),
  row(0, -1, POS, 2, [], "0.00"), // pgjdbc writes a zero with weight -1
  row(0, 1, POS, 0, [], "0"),
  row(1, -1, POS, 4, [0], "0.0000"),
  row(1, -3, POS, 3, [0], "0.000"),

  // Words that dscale hides, and a trailing zero word.
  row(2, 0, POS, 0, [5, 1234], "5"),
  row(2, 0, NEG, 2, [5, 1234], "-5.12"),
  row(2, 0, POS, 0, [5, 0], "5"),
  row(2, 0, POS, 4, [5, 0], "5.0000"),
  row(1, -1, POS, 2, [12], "0.00"),

  // The first integer word prints without leading zeros. Every later word prints four digits.
  row(1, 0, POS, 0, [9], "9"),
  row(1, 0, POS, 0, [10], "10"),
  row(1, 0, POS, 0, [99], "99"),
  row(1, 0, POS, 0, [100], "100"),
  row(1, 0, POS, 0, [999], "999"),
  row(1, 0, POS, 0, [1000], "1000"),
  row(2, 1, POS, 0, [999, 1], "9990001"),
  row(2, 1, NEG, 0, [1000, 1], "-10000001"),
  row(1, 1, POS, 0, [5], "50000"),
  row(1, 2, POS, 2, [9], "900000000.00"),

  // The fraction ends inside a word.
  row(2, 0, POS, 3, [123, 4560], "123.456"),
  row(3, 0, POS, 7, [1, 2, 3456], "1.0002345"),
  row(2, 0, POS, 5, [1, 2], "1.00020"),
  row(1, -3, NEG, 9, [1000], "-0.000000001"),
  row(1, 0, NEG, 2, [42], "-42.00"),

  // NaN and the infinities. A server sends the infinities with dscale 0x20.
  row(0, 0, NAN, 0, [], "NaN"),
  row(0, 0, PINF, 0x20, [], "Infinity"),
  row(0, 0, NINF, 0x20, [], "-Infinity"),
  row(1, 0, NAN, 0, [7], "NaN"),
  row(2, 0, PINF, 0, [1, 9999], "Infinity"),
  row(0, 0, NAN, 0x3fff, [], "NaN"),
  row(0, -1, NINF, 0, [], "-Infinity"),

  // Long values. ndigits is an unsigned 16-bit count.
  row(1, 32767, POS, 0, [5], "5" + fill("0", 131068)),
  row(0, 0, POS, 0x3fff, [], "0." + fill("0", 16383)),
  row(0x8000, 32767, POS, 0, nines(0x8000), fill("9", 131072)),
  row(0x8000, 32766, NEG, 4, nines(0x8000), "-" + fill("9", 131068) + ".9999"),

  // ndigits does not match the bytes of the datum.
  row(0xffff, 0, POS, 0, [], REJECT),
  row(0xffff, 0, NAN, 0, [], REJECT),
  row(2, 0, POS, 4, [5], REJECT),
  row(2, 1, POS, 0, [5], REJECT),
  row(1, -1, POS, 4, [], REJECT),
  row(1, 0, POS, 0, [5], REJECT, "0007"),
  row(1, 0, POS, 0, [5], REJECT, "07"),
  row(0, 0, POS, 0, [], REJECT, "0007"),
  row(0, 0, NAN, 0, [], REJECT, "0007"),

  // dscale is over 0x3FFF.
  row(1, 0, POS, 0x4000, [5], REJECT),
  row(1, 0, POS, 0xffff, [5], REJECT),
  row(0, 0, POS, 0xffff, [], REJECT),
  row(0, 0, PINF, 0x4000, [], REJECT),

  // A word is over 9999, also where it is not printed.
  row(1, 0, NAN, 0, [10000], REJECT),
  row(1, 0, NINF, 0, [0xffff], REJECT),
  row(2, 0, POS, 0, [5, 10000], REJECT),
  row(1, -1, NEG, 0, [10000], REJECT),
  row(3, -4, POS, 10, [5000, 10000, 1253], REJECT),
  row(2, 0, POS, 4, [0, 10000], REJECT),
  row(2, 1, POS, 0, [5, 10000], REJECT),

  // The sign is not one of the five values.
  row(1, 0, 0x8000, 0, [5], REJECT),
  row(0, 0, 0x0001, 0, [], REJECT),
];

test("binary NUMERIC decodes as PostgreSQL prints the datum it receives", async () => {
  // The scripted server answers the simple query `<hex>` with one row: those
  // bytes as a binary NUMERIC column.
  const { port, server } = await listeningServer(socket => {
    let startup = true;
    let buffered: Buffer = Buffer.alloc(0);
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      buffered = pgReadFrontendMessages(Buffer.concat([buffered, data]), (type, body) => {
        if (type !== 0x51 /* 'Q' */) return;
        const datum = Buffer.from(body.subarray(0, -1).toString("latin1"), "hex");
        socket.write(
          Buffer.concat([
            pgRowDescription([{ name: "n", typeOid: NUMERIC_OID, format: 1 }]),
            pgDataRow([datum]),
            pgCommandComplete("SELECT 1"),
            pgReadyForQuery(),
          ]),
        );
      });
    });
    socket.on("error", () => {});
  });

  // A run of one character is written as its length, so that a 131072-digit
  // answer makes a short diff.
  const runs = (answer: unknown) =>
    typeof answer === "string" ? answer.replace(/(.)\1{7,}/g, (run, char) => `${char}{${run.length}}`) : answer;

  const got: Record<string, unknown> = {};
  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, connectionTimeout: 5 });
    // One connection for the table: a datum the decoder rejects fails its own
    // query and no other.
    for (const { name, datum } of table) {
      try {
        const [decoded]: any = await sql.unsafe(datum.toString("hex"));
        got[name] = runs(decoded.n);
      } catch (error: any) {
        got[name] = error?.code === "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT" ? REJECT : error;
      }
    }
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }

  const want = Object.fromEntries(table.map(({ name, want }) => [name, runs(want)]));
  expect(Object.keys(want)).toHaveLength(table.length);
  expect(got).toEqual(want);
});
