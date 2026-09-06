// Text-path decoding of `timestamptz` (`YYYY-MM-DD HH:MM:SS[.ffffff]±HH[:MM[:SS]]`)
// must yield the same instant as the binary path for every offset width
// Postgres emits, including the `±HH:MM:SS` form it prints for local-mean-time
// instants, and for years 0001..0099. JS `Date.parse` gets both wrong.
//
// Driven by a scripted v3 backend so the exact wire text is pinned and no
// Postgres server is needed. The `±HH:MM:SS` vectors are what PostgreSQL 17
// prints for `'1883-11-18 12:00:00+00'::timestamptz` under the zones named
// next to them.

import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
  type PgRowDescriptionColumn,
} from "./wire-frames";

const OID = {
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
  timestamp_array: 1115,
  timestamptz_array: 1185,
} as const;

// The naive `timestamp` vectors below must decode as UTC whatever the host
// zone is, so run the file under a zone with a non-zero offset: a decoder that
// reads them as local time then fails instead of coinciding with UTC.
const originalTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
  expect(new Date(Date.UTC(2024, 5, 15, 12)).getTimezoneOffset()).toBe(240);
});
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

// Simple-query backend: replies to every 'Q' with the latched RowDescription +
// DataRow. format: 0 (text) for every column.
let reply!: { cols: PgRowDescriptionColumn[]; row: Buffer[] };
const mock = await listeningServer(socket => {
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
        pgRowDescription(reply.cols),
        pgDataRow(reply.row),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => mock.server.close(() => r())));

/** Serves one row whose cells are `texts`, every column of type `typeOid`; returns the decoded cells in order. */
async function decode(typeOid: number, texts: string[]): Promise<unknown[]> {
  reply = {
    cols: texts.map((_, i) => ({ name: `c${i}`, typeOid })),
    row: texts.map(text => Buffer.from(text)),
  };
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, connectionTimeout: 2 });
  try {
    const [row]: any = await sql`select 1`.simple();
    return texts.map((_, i) => row[`c${i}`]);
  } finally {
    await sql.close({ timeout: 0 });
  }
}

// toISOString() throws on an Invalid Date; render it as a marker instead so a
// failing diff names the cell that broke.
const iso = (v: unknown) => (v instanceof Date ? (Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString()) : v);

// --- scalar timestamptz text ----------------------------------------------

test("timestamptz text: every offset width Postgres emits (±HH, ±HH:MM, ±HH:MM:SS)", async () => {
  const cells = await decode(OID.timestamptz, [
    "1883-11-18 12:00:00+00",
    "1883-11-18 07:00:00-05",
    "2024-06-01 17:45:00+05:45",
    "1883-11-18 07:03:58-04:56:02", // America/New_York
    "1883-11-18 12:19:32+00:19:32", // Europe/Amsterdam
    "1883-11-18 11:34:39-00:25:21", // Europe/Dublin: negative offset whose hour field is 00
    "1883-11-18 17:21:10+05:21:10", // Asia/Kolkata
  ]);
  expect(cells.map(iso)).toEqual([
    "1883-11-18T12:00:00.000Z",
    "1883-11-18T12:00:00.000Z",
    "2024-06-01T12:00:00.000Z",
    "1883-11-18T12:00:00.000Z",
    "1883-11-18T12:00:00.000Z",
    "1883-11-18T12:00:00.000Z",
    "1883-11-18T12:00:00.000Z",
  ]);
});

test("timestamptz text: fractional seconds combine with every offset width", async () => {
  const cells = await decode(OID.timestamptz, [
    "2024-06-01 12:00:00.5+00",
    "2024-06-01 12:00:00.123456-05",
    "2024-06-01 12:00:00.25+05:30",
    "1883-11-18 07:03:58.25-04:56:02",
  ]);
  expect(cells.map(iso)).toEqual([
    "2024-06-01T12:00:00.500Z",
    "2024-06-01T17:00:00.123Z",
    "2024-06-01T06:30:00.250Z",
    "1883-11-18T12:00:00.250Z",
  ]);
});

test("timestamptz text: years 0001..0099 decode literally (text path == binary path)", async () => {
  const cells = await decode(OID.timestamptz, [
    "0001-03-15 12:00:00+00",
    "0044-03-15 12:00:00+00",
    "0099-03-15 12:00:00+00",
    "0100-03-15 12:00:00+00",
    "2024-03-15 12:00:00+00",
  ]);
  expect(cells.map(iso)).toEqual([
    "0001-03-15T12:00:00.000Z",
    "0044-03-15T12:00:00.000Z",
    "0099-03-15T12:00:00.000Z",
    "0100-03-15T12:00:00.000Z",
    "2024-03-15T12:00:00.000Z",
  ]);
});

test("timestamptz text outside the fixed-width shape still falls back to Date.parse", async () => {
  const cells = await decode(OID.timestamptz, [
    // Five-digit years are the one such shape Date.parse handles; it must keep doing so.
    "10000-01-01 00:00:00+00",
    // Out-of-range offset fields are not treated as 99 minutes / 99 seconds.
    "2024-06-01 12:00:00+01:99",
    "2024-06-01 12:00:00+00:00:99",
  ]);
  expect(cells.map(iso)).toEqual(["+010000-01-01T00:00:00.000Z", "Invalid Date", "Invalid Date"]);
});

// --- array text path (arrays are text even on the extended protocol) --------

test("timestamptz[] text: elements get the same offset parsing as scalars", async () => {
  const [arr] = await decode(OID.timestamptz_array, [
    '{"1883-11-18 07:03:58-04:56:02","2024-06-01 08:00:00.5-04","0044-03-15 12:00:00+00"}',
  ]);
  expect((arr as unknown[]).map(iso)).toEqual([
    "1883-11-18T12:00:00.000Z",
    "2024-06-01T12:00:00.500Z",
    "0044-03-15T12:00:00.000Z",
  ]);
});

test("timestamp[] text: elements decode as UTC wall-clock, like the scalar decoder", async () => {
  const [arr] = await decode(OID.timestamp_array, [
    '{"2024-06-15 12:00:00","2024-06-15 12:00:00.5","0044-03-15 12:00:00"}',
  ]);
  expect((arr as unknown[]).map(iso)).toEqual([
    "2024-06-15T12:00:00.000Z",
    "2024-06-15T12:00:00.500Z",
    "0044-03-15T12:00:00.000Z",
  ]);
});

// --- unaffected neighbours --------------------------------------------------

test("date / naive timestamp scalars keep decoding as UTC", async () => {
  const dates = await decode(OID.date, ["2024-06-15", "0044-03-15"]);
  const timestamps = await decode(OID.timestamp, ["2024-06-15 12:00:00", "0044-03-15 12:00:00.25"]);
  expect([...dates, ...timestamps].map(iso)).toEqual([
    "2024-06-15T00:00:00.000Z",
    "0044-03-15T00:00:00.000Z",
    "2024-06-15T12:00:00.000Z",
    "0044-03-15T12:00:00.250Z",
  ]);
});
