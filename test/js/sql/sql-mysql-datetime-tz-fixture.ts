// A JS Date bound to a MySQL DATETIME and read back must be the same instant
// regardless of the process timezone. Encode breaks the Date's epoch-ms into
// Y/M/D h:m:s via pure-UTC arithmetic, so decode has to treat those components
// as UTC too — if it interprets them as local time, the round-trip silently
// shifts by the machine's UTC offset. This must hold on BOTH the prepared
// (binary) and simple (text) protocols, and MySQL zero-dates must surface as
// Invalid Date on both. TIMESTAMP columns additionally require the session
// time zone to be UTC (the driver sets it on connect), or the server shifts
// the stored instant by the session offset (#40435).
//
// The driving test spawns this fixture under several TZ values against a real
// MySQL server and asserts the identity holds for each.

import { SQL, randomUUIDv7 } from "bun";

const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
await using sql = new SQL({
  url: process.env.MYSQL_URL,
  tls,
  max: 1,
  allowPublicKeyRetrieval: true,
});

const t = "dt_tz_" + randomUUIDv7("hex").replaceAll("-", "");
await sql`CREATE TEMPORARY TABLE ${sql(t)} (id INT PRIMARY KEY, dt DATETIME)`;
// Signal a live connection so the driving test can tell "no MySQL here"
// (soft-skip in local/sandboxed runs) apart from an actual decode failure.
console.log("CONNECTED");

const inputs = [
  new Date("2024-06-15T12:00:00.000Z"), // summer (DST active in zones that observe it)
  new Date("2024-01-15T00:30:00.000Z"), // winter, near midnight UTC — local-time misread crosses the day boundary
  new Date("2024-12-31T23:45:00.000Z"), // year boundary
];

for (let i = 0; i < inputs.length; i++) {
  await sql`INSERT INTO ${sql(t)} (id, dt) VALUES (${i}, ${inputs[i]})`;
}

const failures: string[] = [];

function checkRoundTrip(protocol: string, rows: Array<{ dt: Date }>) {
  for (let i = 0; i < inputs.length; i++) {
    const got: Date = rows[i].dt;
    if (!(got instanceof Date)) {
      failures.push(`${protocol} id=${i}: expected Date, got ${Object.prototype.toString.call(got)}`);
      continue;
    }
    const want = inputs[i].getTime();
    const have = got.getTime();
    if (want !== have) {
      const diffMin = (have - want) / 60000;
      failures.push(`${protocol} id=${i}: in=${inputs[i].toISOString()} out=${got.toISOString()} diffMin=${diffMin}`);
    }
  }
}

// Prepared (binary) and simple (text) protocols must agree — both decode the
// naive wall-clock as UTC.
checkRoundTrip("binary", await sql`SELECT id, dt FROM ${sql(t)} ORDER BY id`);
checkRoundTrip("text", await sql`SELECT id, dt FROM ${sql(t)} ORDER BY id`.simple());

// #40435: the server converts TIMESTAMP (not DATETIME) columns through
// @@session.time_zone, while the driver's Date codec is UTC on both ends. The
// driver must align every new session to UTC, or a Date written to a TIMESTAMP
// column stores an instant shifted by the session offset — and the same-session
// round trip hides it, because the decode error cancels the encode error.
{
  const [{ tz }] = await sql`SELECT @@session.time_zone AS tz`;
  if (tz !== "+00:00") {
    failures.push(`session time_zone: expected +00:00, got ${tz}`);
  }

  const tt = "ts_tz_" + randomUUIDv7("hex").replaceAll("-", "");
  await sql`CREATE TEMPORARY TABLE ${sql(tt)} (ts TIMESTAMP(3) NULL)`;
  const written = new Date("2026-08-25T10:00:00.000Z");
  await sql`INSERT INTO ${sql(tt)} (ts) VALUES (${written})`;
  // UNIX_TIMESTAMP reports the UTC instant the server actually stored,
  // independent of the session zone, so it catches a shifted write that a
  // read-back of `ts` through the same session would cancel out.
  const [row] = await sql`
    SELECT ts, CAST(ROUND(UNIX_TIMESTAMP(ts) * 1000) AS SIGNED) AS stored_ms FROM ${sql(tt)}`;
  const storedMs = Number(row.stored_ms);
  if (storedMs !== written.getTime()) {
    const diffMin = (storedMs - written.getTime()) / 60000;
    failures.push(
      `TIMESTAMP stored instant: wrote ${written.toISOString()}, stored ${new Date(storedMs).toISOString()} diffMin=${diffMin}`,
    );
  }
  if (!(row.ts instanceof Date) || row.ts.getTime() !== written.getTime()) {
    failures.push(`TIMESTAMP read back: expected ${written.toISOString()}, got ${String(row.ts)}`);
  }

  // A server-generated value has no cancelling encode error, so this pins the
  // decode half on its own: NOW() is fixed per statement, so the decoded Date
  // must equal the server's own epoch for the same instant.
  const [gen] = await sql`
    SELECT NOW(3) AS n, CAST(ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000) AS SIGNED) AS n_ms`;
  if (!(gen.n instanceof Date) || gen.n.getTime() !== Number(gen.n_ms)) {
    failures.push(`NOW() decode: got ${String(gen.n)}, server epoch ${gen.n_ms}`);
  }
}

// MySQL's permissive sql_mode stores "0000-00-00 00:00:00"; it must read back
// as Invalid Date (not the Unix epoch / a wrapped date) on both protocols.
// ALLOW_INVALID_DATES additionally lets MySQL store a non-zero day past its
// month length ("2024-02-31") verbatim; that must also read back as Invalid
// Date instead of being normalized to March 2 by the decoder.
const zt = "dt_zero_" + randomUUIDv7("hex").replaceAll("-", "");
await sql`SET SESSION sql_mode='ALLOW_INVALID_DATES'`.simple();
await sql`CREATE TEMPORARY TABLE ${sql(zt)} (id INT PRIMARY KEY, dt DATETIME)`.simple();
await sql.unsafe(`INSERT INTO ${zt} (id, dt) VALUES (1, '0000-00-00 00:00:00'), (2, '2024-02-31 00:00:00')`);
for (const [protocol, rows] of [
  ["binary", await sql`SELECT id, dt FROM ${sql(zt)} ORDER BY id`],
  ["text", await sql`SELECT id, dt FROM ${sql(zt)} ORDER BY id`.simple()],
] as const) {
  for (const [id, label] of [
    [1, "zero-date"],
    [2, "impossible-date"],
  ] as const) {
    const got: Date = rows[id - 1].dt;
    if (!(got instanceof Date) || !Number.isNaN(got.getTime())) {
      failures.push(`${protocol} ${label}: expected Invalid Date, got ${String(got)}`);
    }
  }
}

if (failures.length) {
  console.error(`FAIL TZ=${process.env.TZ} offsetMin=${new Date().getTimezoneOffset()}`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}

console.log(`OK TZ=${process.env.TZ} offsetMin=${new Date().getTimezoneOffset()}`);
