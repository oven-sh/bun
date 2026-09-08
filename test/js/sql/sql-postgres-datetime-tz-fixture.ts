// A Postgres `timestamp` (WITHOUT TIME ZONE) stores a naive wall-clock with no
// offset. Bun decodes the binary form as UTC (µs since 2000-01-01), so the
// simple/text path must decode the same wall-clock as UTC too — otherwise it
// goes through JS Date.parse and is read as local time, making the two
// protocols disagree on non-UTC hosts. `timestamptz` (explicit offset) and
// `date` (UTC midnight) must keep decoding correctly, including the
// `±HH:MM:SS` offsets the server prints for historical (local mean time)
// instants and the `timestamptz[]` / `timestamp[]` arrays that are sent as
// text on both protocols.
//
// The driving test spawns this fixture under several TZ values against a real
// Postgres server and asserts binary and text decode to the same instant.
//
// It also checks in-band that the "binary" query really received binary
// results (the `0.1::real` sentinel), and sweeps sub-millisecond instants from
// 4714 BC to the JS Date limit against the server's own
// floor(extract(epoch) * 1000), which covers the ranges where the text path
// cannot serve as the oracle.

import { SQL, randomUUIDv7 } from "bun";

const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
await using sql = new SQL({
  url: process.env.DATABASE_URL,
  tls,
  max: 1,
});

// Pin the server session to UTC so the stored/echoed text is unambiguous
// regardless of the client process TZ; the bug under test is purely client-side
// decode of the naive wall-clock.
await sql.unsafe("SET TIME ZONE 'UTC'");

const t = "dt_tz_" + randomUUIDv7("hex").replaceAll("-", "");
await sql`CREATE TEMPORARY TABLE ${sql(t)} (id INT PRIMARY KEY, ts TIMESTAMP, tstz TIMESTAMPTZ, d DATE)`;
// Signal a live connection so the driving test can tell "no Postgres here"
// (soft-skip in local/sandboxed runs) apart from an actual decode failure.
console.log("CONNECTED");

// Fixed wall-clock strings so the stored values don't depend on the session TZ.
const rowsIn = [
  { id: 0, ts: "2024-06-15 12:00:00", tstz: "2024-06-15 12:00:00+00", d: "2024-06-15" },
  { id: 1, ts: "2024-01-15 00:30:00", tstz: "2024-01-15 00:30:00+00", d: "2024-01-15" },
  { id: 2, ts: "2024-12-31 23:45:00", tstz: "2024-12-31 23:45:00+00", d: "2024-12-31" },
  // Sub-millisecond instants. Both protocols must drop the extra digits; the
  // binary decoder used to round the pre-1970 ones 1 ms later instead (id 3
  // came back as 1970-01-01T00:00:00.000Z). id 5 is before the Postgres
  // epoch (2000) but after 1970, which was already correct and must stay so.
  { id: 3, ts: "1969-12-31 23:59:59.9996", tstz: "1969-12-31 23:59:59.9996+00", d: "1969-12-31" },
  { id: 4, ts: "1883-11-18 12:00:00.123456", tstz: "1883-11-18 12:00:00.123456+00", d: "1883-11-18" },
  { id: 5, ts: "1999-12-31 23:59:59.9996", tstz: "1999-12-31 23:59:59.9996+00", d: "1999-12-31" },
];
for (const r of rowsIn) {
  await sql.unsafe(`INSERT INTO ${t} (id, ts, tstz, d) VALUES (${r.id}, '${r.ts}', '${r.tstz}', '${r.d}')`);
}

// What each column should decode to, as a UTC instant (identical on both paths).
const expected = [
  { ts: "2024-06-15T12:00:00.000Z", tstz: "2024-06-15T12:00:00.000Z", d: "2024-06-15T00:00:00.000Z" },
  { ts: "2024-01-15T00:30:00.000Z", tstz: "2024-01-15T00:30:00.000Z", d: "2024-01-15T00:00:00.000Z" },
  { ts: "2024-12-31T23:45:00.000Z", tstz: "2024-12-31T23:45:00.000Z", d: "2024-12-31T00:00:00.000Z" },
  { ts: "1969-12-31T23:59:59.999Z", tstz: "1969-12-31T23:59:59.999Z", d: "1969-12-31T00:00:00.000Z" },
  { ts: "1883-11-18T12:00:00.123Z", tstz: "1883-11-18T12:00:00.123Z", d: "1883-11-18T00:00:00.000Z" },
  { ts: "1999-12-31T23:59:59.999Z", tstz: "1999-12-31T23:59:59.999Z", d: "1999-12-31T00:00:00.000Z" },
];

const failures: string[] = [];

// Renders a decoded cell (Date, array of Dates, or text) for comparison with
// the expected strings; anything else is reported as its type tag.
function render(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(render).join(",")}]`;
  if (!(value instanceof Date)) return Object.prototype.toString.call(value);
  return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
}

function checkRows(protocol: string, rows: Array<Record<string, unknown>>, want: Array<Record<string, string>>) {
  for (let i = 0; i < want.length; i++) {
    for (const col of Object.keys(want[i])) {
      const got = render(rows[i]?.[col]);
      if (got !== want[i][col]) {
        failures.push(`${protocol} row=${i} ${col}: want ${want[i][col]} got ${got}`);
      }
    }
  }
}

// `0.1::real` tells the two result formats apart in-band: the 4-byte binary
// float4 decodes to Math.fround(0.1), the text rendering "0.1" to 0.1.
function checkFormat(protocol: string, rows: Array<{ fmt: number }>, want: number) {
  if (rows[0]?.fmt !== want) {
    failures.push(`${protocol} query: format sentinel 0.1::real decoded to ${rows[0]?.fmt}, want ${want}`);
  }
}

// The bound parameter matters: a statement without parameters is prepared and
// executed in one round trip, before the result types are known, so its Bind
// asks for text results. With a parameter, Bind is sent after Describe and
// requests binary for timestamp/timestamptz; the sentinel proves which one
// each query got.
const binaryRows = await sql`SELECT ts, tstz, d, 0.1::real AS fmt FROM ${sql(t)} WHERE id >= ${0} ORDER BY id`;
const textRows = await sql`SELECT ts, tstz, d, 0.1::real AS fmt FROM ${sql(t)} ORDER BY id`.simple();
checkFormat("binary", binaryRows, Math.fround(0.1));
checkFormat("text", textRows, 0.1);
checkRows("binary", binaryRows, expected);
checkRows("text", textRows, expected);

// Sub-millisecond sweep, checked against the server's own arithmetic:
// floor(extract(epoch) * 1000) is numeric (exact) on PostgreSQL 14+, and,
// unlike the text path, is also an oracle where the text decoders are known to
// differ and are not this decoder's business: BC dates and 5+ digit years fall
// back to Date.parse, which yields Invalid Date for BC and reads a 5+ digit
// year `timestamp` as local time. Those literals are checked on the binary
// path only. Values beyond JS Date's +/-8.64e15 ms decode to Invalid Date.
const subMsLiterals: Array<[literal: string, textToo: boolean]> = [
  ["4714-11-24 00:00:00.000001 BC", false], // the Postgres minimum
  ["0001-12-31 23:59:59.999999 BC", false],
  // Years 1-99 used to be windowed into 19xx/20xx by the timestamptz text path.
  ["0001-01-01 00:00:00.123456", true],
  ["0099-12-31 23:59:59.999999", true],
  ["0100-01-01 00:00:00.000999", true],
  // More than 2^53 µs from 2000-01-01: the old f64 conversion was lossy here
  // on top of truncating toward zero, on both sides of 1970.
  ["1000-06-15 01:02:03.999999", true],
  ["2300-01-01 00:00:00.000999", true],
  ["3000-06-01 12:00:00.123999", true],
  ["1600-02-29 12:00:00.000001", true],
  ["1969-12-31 23:59:59.999999", true],
  ["1969-12-31 23:59:59.000001", true],
  ["1970-01-01 00:00:00.000001", true],
  ["1970-01-01 00:00:00.999999", true],
  ["1999-12-31 23:59:59.999999", true],
  ["2000-01-01 00:00:00.000001", true],
  ["275760-09-13 00:00:00.000999", false], // JS Date's maximum instant plus 999 µs floors onto the maximum
  ["275760-09-14 00:00:00", false], // past the JS Date range: Invalid Date
];
const JS_DATE_MAX_MS = 8.64e15;

for (const type of ["timestamp", "timestamptz"] as const) {
  const columns = (value: (i: number) => string) =>
    subMsLiterals
      .map(
        (_, i) =>
          `${value(i)}::${type} AS v${i}, floor(extract(epoch FROM ${value(i)}::${type}) * 1000)::text AS ms${i}`,
      )
      .concat("0.1::real AS fmt")
      .join(", ");
  // With parameters this is an extended query whose results arrive binary;
  // without, unsafe() sends a simple query whose results arrive as text.
  const binaryResult = await sql.unsafe(
    `SELECT ${columns(i => `$${i + 1}`)}`,
    subMsLiterals.map(([literal]) => literal),
  );
  const textResult = await sql.unsafe(`SELECT ${columns(i => `'${subMsLiterals[i][0]}'`)}`);
  checkFormat(`binary ${type} sweep`, binaryResult, Math.fround(0.1));
  checkFormat(`text ${type} sweep`, textResult, 0.1);
  const [binary] = binaryResult;
  const [text] = textResult;

  for (let i = 0; i < subMsLiterals.length; i++) {
    const [literal, textToo] = subMsLiterals[i];
    const serverMs = Number(binary[`ms${i}`]);
    const want = Math.abs(serverMs) <= JS_DATE_MAX_MS ? serverMs : NaN;
    for (const [protocol, row] of [
      ["binary", binary],
      ["text", text],
    ] as const) {
      if (protocol === "text" && !textToo) continue;
      const got = row[`v${i}`];
      const gotMs = got instanceof Date ? got.getTime() : undefined;
      if (!(gotMs === want || (Number.isNaN(gotMs) && Number.isNaN(want)))) {
        failures.push(
          `${protocol} '${literal}'::${type}: want ${want} got ${gotMs ?? Object.prototype.toString.call(got)} (server says ${binary[`ms${i}`]} ms)`,
        );
      }
    }
  }
}

// Historical instants: for a date this old the session zone's rule is local
// mean time, so the server prints the offset with a seconds field
// (`1883-11-18 07:03:58-04:56:02` for America/New_York), which only the
// component decoder understands. Arrays are sent as text on both protocols,
// so they exercise the text decoder even in the "binary" query.
await sql.unsafe("SET TIME ZONE 'America/New_York'");
const lmt = "1883-11-18 12:00:00+00";
const historicalExpected = [
  {
    // The server's own rendering, so this block is known to be exercising the
    // seconds-resolution offset and not a plain `-05`.
    tstz_text: "1883-11-18 07:03:58-04:56:02",
    tstz: "1883-11-18T12:00:00.000Z",
    tstz_arr: "[1883-11-18T12:00:00.000Z,2024-06-15T12:00:00.000Z]",
    ts_arr: "[2024-06-15T12:00:00.000Z]",
  },
];
// The same query on both protocols: a bound parameter makes it an extended
// query (scalar tstz arrives binary); unsafe() without parameters is a simple
// query (every cell arrives as text).
const historicalBinary = await sql`
    SELECT ${lmt}::timestamptz::text AS tstz_text,
           ${lmt}::timestamptz AS tstz,
           ARRAY[${lmt}::timestamptz, '2024-06-15 12:00:00+00'::timestamptz] AS tstz_arr,
           ARRAY['2024-06-15 12:00:00'::timestamp] AS ts_arr,
           0.1::real AS fmt`;
const historicalText = await sql.unsafe(`
    SELECT '${lmt}'::timestamptz::text AS tstz_text,
           '${lmt}'::timestamptz AS tstz,
           ARRAY['${lmt}'::timestamptz, '2024-06-15 12:00:00+00'::timestamptz] AS tstz_arr,
           ARRAY['2024-06-15 12:00:00'::timestamp] AS ts_arr,
           0.1::real AS fmt`);
checkFormat("binary historical", historicalBinary, Math.fround(0.1));
checkFormat("text historical", historicalText, 0.1);
checkRows("binary historical", historicalBinary, historicalExpected);
checkRows("text historical", historicalText, historicalExpected);

if (failures.length) {
  console.error(`FAIL TZ=${process.env.TZ} offsetMin=${new Date().getTimezoneOffset()}`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

console.log(`OK TZ=${process.env.TZ} offsetMin=${new Date().getTimezoneOffset()}`);
