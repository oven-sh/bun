// Postgres binary NUMERIC encodes the mantissa as base-10000 digit words
// (Int16, valid range 0..=9999). numeric_recv in Postgres rejects anything
// outside that range with `invalid digit in external "numeric" value`. Bun's
// decoder fed the raw u16 straight into a 4-wide zero-padded formatter, so a
// hostile server sending digit=10000 panicked debug_assert builds and silently
// dropped high digits on release (10000 -> "", 10001 -> "1").

import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgMockServer,
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

test("binary NUMERIC rejects a word count that the datum does not hold", async () => {
  // ndigits=0xFFFF weight=0 sign=+ dscale=0 and no digit word. numeric_recv
  // reads ndigits as uint16 and stops with "insufficient data left in message".
  const { value, error } = await selectNumeric(numericDatum(0xffff, 0, 0x0000, 0, []));
  expect(value).toBeUndefined();
  expect({ code: error?.code, name: error?.name }).toEqual({
    code: "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT",
    name: "PostgresError",
  });
});

// --- Datums that a PostgreSQL server does not send ----------------------------
// The decoder returns numeric_out(numeric_recv(datum)): the text PostgreSQL
// prints for the value it receives from the datum. numeric_recv cuts the value
// to dscale, drops leading zero words and makes a zero unsigned. A PostgreSQL
// server sends only datums that numeric_recv leaves as they are, so a scripted
// server sends the ones below. postgres-binary-numeric.test.ts holds the values
// that a real server sends.

const POS = 0x0000;
const NEG = 0x4000;
const NAN = 0xc000;
const PINF = 0xd000;
const NINF = 0xf000;
const REJECT = Symbol("rejected");

const fill = (char: string, count: number) => Buffer.alloc(count, char).toString();

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
  return {
    name: `ndigits=${ndigits} weight=${weight} sign=${signs[sign] ?? "0x" + sign.toString(16)} dscale=${dscale} [${digits}]${extraBytes && " +" + extraBytes}`,
    datum: Buffer.concat([numericDatum(ndigits, weight, sign, dscale, digits), Buffer.from(extraBytes, "hex")]),
    want,
  };
}

// Each answer was read from a PostgreSQL that got the same bytes as a binary
// parameter of `select $1::text`. REJECT means that PostgreSQL raised an error.
const postgresAnswers = [
  // Answers read from PostgreSQL 17.11 (Debian 17.11-0+deb13u1).

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
  row(1, -1, NEG, 3, [9], "0.000"),
  row(1, -1, NEG, 2, [99], "0.00"),

  // A leading zero word before a word that is not zero is dropped.
  row(2, 1, POS, 0, [0, 5], "5"),
  row(2, 1, NEG, 0, [0, 5], "-5"),
  row(3, 2, POS, 0, [0, 0, 7], "7"),
  row(3, 2, POS, 0, [0, 12, 34], "120034"),
  row(3, 1, POS, 2, [0, 5, 1200], "5.12"),
  row(2, -1, POS, 8, [0, 5], "0.00000005"),

  // A zero with no word. The weight has no effect.
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
  row(3, 0, POS, 7, [1, 2, 3456], "1.0002345"),

  // NaN and the infinities. A server sends the infinities with dscale 0x20.
  row(1, 0, NAN, 0, [7], "NaN"),
  row(2, 0, PINF, 0, [1, 9999], "Infinity"),
  row(0, 0, NAN, 0x3fff, [], "NaN"),
  row(0, -1, NINF, 0, [], "-Infinity"),

  // The datum holds fewer words than ndigits.
  row(0xffff, 0, POS, 0, [], REJECT),
  row(0xffff, 0, NAN, 0, [], REJECT),
  row(2, 0, POS, 4, [5], REJECT),
  row(2, 1, POS, 0, [5], REJECT),
  row(1, -1, POS, 4, [], REJECT),

  // A printed word is over 9999.
  row(2, 0, POS, 4, [0, 10000], REJECT),
  row(2, 1, POS, 0, [5, 10000], REJECT),
  row(2, 1, POS, 0, [5, 10001], REJECT),
  row(2, 0, POS, 2, [5, 10000], REJECT),
  row(1, -1, POS, 2, [10000], REJECT),

  // The sign is not one of the five values.
  row(1, 0, 0x8000, 0, [5], REJECT),
  row(0, 0, 0x0001, 0, [], REJECT),
];

// PostgreSQL rejects these datums, and the decoder reads them as it always did.
// It ignores bytes after the words, it reads dscale as a signed field where a
// negative value is 0, and it does not check a word that it does not print.
// Each answer is what PostgreSQL prints for the datum without those parts. For
// the CrateDB datums that is also BigDecimal.toPlainString() of the value.
const readsWhatPostgresRejects = [
  // Bytes after the words.
  row(1, 0, POS, 0, [5], "5", "0007"),
  row(1, 0, POS, 0, [5], "5", "07"),
  row(0, 0, POS, 0, [], "0", "0007"),
  row(0, 0, NAN, 0, [], "NaN", "0007"),

  // dscale is over 0x3FFF. It is a signed field here, and a negative one is 0.
  row(1, 0, POS, 0xfffd, [1000], "1000"), // CrateDB before 6.3.4: BigDecimal 1E+3
  row(1, 1, POS, 0xfffa, [2000], "20000000"), // CrateDB before 6.3.4: BigDecimal 20E+6
  row(1, 2, NEG, 0xfff8, [25], "-2500000000"), // CrateDB before 6.3.4: BigDecimal -25E+8
  row(0, 0, POS, 0xffff, [], "0"), // CrateDB before 6.3.4: BigDecimal 0E+1
  row(1, 0, POS, 0xffff, [5], "5"),
  row(1, 0, POS, 0x4000, [5], "5." + fill("0", 16384)),
  row(0, 0, PINF, 0x4000, [], "Infinity"),

  // A word over 9999 that is not printed.
  row(1, 0, NAN, 0, [10000], "NaN"),
  row(1, 0, NINF, 0, [0xffff], "-Infinity"),
  row(2, 0, POS, 0, [5, 10000], "5"),
  row(1, -1, NEG, 0, [10000], "0"),
  row(3, -4, POS, 10, [5000, 10000, 1253], "0.0000000000"),
];

describe("binary NUMERIC from a server that is not PostgreSQL", () => {
  // The scripted server answers the simple query `<hex>` with one row: those
  // bytes as a binary NUMERIC column.
  let mock: Awaited<ReturnType<typeof pgMockServer>>;
  let sql: SQL;
  beforeAll(async () => {
    mock = await pgMockServer((type, body) => {
      if (type !== "Q") return;
      return [
        pgRowDescription([{ name: "n", typeOid: NUMERIC_OID, format: 1 }]),
        pgDataRow([Buffer.from(body.subarray(0, -1).toString("latin1"), "hex")]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ];
    });
    sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, connectionTimeout: 5 });
  });
  afterAll(async () => {
    await sql.close();
    await new Promise<void>(r => mock.server.close(() => r()));
  });

  // One connection for every datum: a datum the decoder rejects fails its own
  // query and no other.
  async function decode(datum: Buffer): Promise<unknown> {
    try {
      const [decoded]: any = await sql.unsafe(datum.toString("hex"));
      return decoded.n;
    } catch (error: any) {
      if (error?.code === "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT") return REJECT;
      throw error;
    }
  }

  test.each(postgresAnswers)("$name decodes as PostgreSQL receives it", async ({ datum, want }) => {
    expect(await decode(datum)).toBe(want);
  });

  test.each(readsWhatPostgresRejects)("$name decodes though PostgreSQL rejects it", async ({ datum, want }) => {
    expect(await decode(datum)).toBe(want);
  });
});
