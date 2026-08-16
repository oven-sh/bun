// A Postgres `timestamp` (WITHOUT TIME ZONE) stores a naive wall-clock with no
// offset. Bun decodes the binary form as UTC (µs since 2000-01-01), so the
// simple/text path must decode the same wall-clock as UTC too — otherwise it
// goes through JS Date.parse and is read as local time, making the two
// protocols disagree on non-UTC hosts. `timestamptz` (explicit offset) and
// `date` (UTC midnight) must keep decoding correctly.
//
// The driving test spawns this fixture under several TZ values against a real
// Postgres server and asserts binary and text decode to the same instant.

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
];
for (const r of rowsIn) {
  await sql.unsafe(`INSERT INTO ${t} (id, ts, tstz, d) VALUES (${r.id}, '${r.ts}', '${r.tstz}', '${r.d}')`);
}

// What each column should decode to, as a UTC instant (identical on both paths).
const expected = [
  { ts: "2024-06-15T12:00:00.000Z", tstz: "2024-06-15T12:00:00.000Z", d: "2024-06-15T00:00:00.000Z" },
  { ts: "2024-01-15T00:30:00.000Z", tstz: "2024-01-15T00:30:00.000Z", d: "2024-01-15T00:00:00.000Z" },
  { ts: "2024-12-31T23:45:00.000Z", tstz: "2024-12-31T23:45:00.000Z", d: "2024-12-31T00:00:00.000Z" },
];

const failures: string[] = [];

function checkRows(protocol: string, rows: Array<{ ts: Date; tstz: Date; d: Date }>) {
  for (let i = 0; i < expected.length; i++) {
    for (const col of ["ts", "tstz", "d"] as const) {
      const got: Date = rows[i][col];
      if (!(got instanceof Date)) {
        failures.push(`${protocol} id=${i} ${col}: expected Date, got ${Object.prototype.toString.call(got)}`);
        continue;
      }
      if (got.toISOString() !== expected[i][col]) {
        failures.push(`${protocol} id=${i} ${col}: want ${expected[i][col]} got ${got.toISOString()}`);
      }
    }
  }
}

checkRows("binary", await sql`SELECT ts, tstz, d FROM ${sql(t)} ORDER BY id`);
checkRows("text", await sql`SELECT ts, tstz, d FROM ${sql(t)} ORDER BY id`.simple());

if (failures.length) {
  console.error(`FAIL TZ=${process.env.TZ} offsetMin=${new Date().getTimezoneOffset()}`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

console.log(`OK TZ=${process.env.TZ} offsetMin=${new Date().getTimezoneOffset()}`);
