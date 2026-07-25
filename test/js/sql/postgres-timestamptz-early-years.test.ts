// Postgres emits `timestamptz` text as `YYYY-MM-DD HH:MM:SS[.ffffff]±HH[:MM[:SS]]`
// (DateStyle=ISO, pinned in the startup packet). Routing that through JS
// `Date.parse` is wrong: the space separator makes JSC take its non-ISO
// heuristic path, which windows years 0001..0099 into 1900..2099 (and
// misreads 0001 entirely). The binary path decodes µs since 2000-01-01 and is
// unaffected, so the two protocols silently disagreed on the same value. The
// text decoder must parse the ISO components and the explicit offset directly,
// like the naive-timestamp decoder already does.
//
// Driven by a scripted v3 backend so the exact wire text each path sees is
// pinned and no Postgres server is required.

import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
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

// Simple-query backend: replies to every 'Q' with the latched RowDescription +
// DataRow. format: 0 (text) for every column.
let reply!: { cols: PgRowDescriptionColumn[]; row: (Buffer | null)[] };
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

async function simple(cols: PgRowDescriptionColumn[], row: (Buffer | null)[]): Promise<any> {
  reply = { cols, row };
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, connectionTimeout: 2 });
  try {
    const [r]: any = await sql`select 1`.simple();
    return r;
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d);

// --- scalar timestamptz text ----------------------------------------------

test("timestamptz text: years 0001..0099 decode literally (text path == binary path)", async () => {
  const col = (name: string) => ({ name, typeOid: OID.timestamptz });
  const row = await simple(
    [col("y0001"), col("y0044"), col("y0099"), col("y0100"), col("y2024")],
    [
      Buffer.from("0001-03-15 12:00:00+00"),
      Buffer.from("0044-03-15 12:00:00+00"),
      Buffer.from("0099-03-15 12:00:00+00"),
      Buffer.from("0100-03-15 12:00:00+00"),
      Buffer.from("2024-03-15 12:00:00+00"),
    ],
  );
  expect({
    y0001: iso(row.y0001),
    y0044: iso(row.y0044),
    y0099: iso(row.y0099),
    y0100: iso(row.y0100),
    y2024: iso(row.y2024),
  }).toEqual({
    y0001: "0001-03-15T12:00:00.000Z",
    y0044: "0044-03-15T12:00:00.000Z",
    y0099: "0099-03-15T12:00:00.000Z",
    y0100: "0100-03-15T12:00:00.000Z",
    y2024: "2024-03-15T12:00:00.000Z",
  });
});

test("timestamptz text: explicit offset is applied (±HH, ±HH:MM, ±HH:MM:SS, fractional seconds)", async () => {
  const col = (name: string) => ({ name, typeOid: OID.timestamptz });
  const row = await simple(
    [col("neg"), col("hhmm"), col("hhmmss"), col("frac")],
    [
      Buffer.from("0044-03-15 12:00:00-05"),
      Buffer.from("0044-03-15 12:00:00+05:30"),
      // Pre-standardization zones: Postgres emits offsets with seconds.
      Buffer.from("0044-03-15 17:53:28+05:53:28"),
      Buffer.from("0044-03-15 12:00:00.123456+00"),
    ],
  );
  expect({ neg: iso(row.neg), hhmm: iso(row.hhmm), hhmmss: iso(row.hhmmss), frac: iso(row.frac) }).toEqual({
    neg: "0044-03-15T17:00:00.000Z",
    hhmm: "0044-03-15T06:30:00.000Z",
    hhmmss: "0044-03-15T12:00:00.000Z",
    frac: "0044-03-15T12:00:00.123Z",
  });
});

// --- array text path ------------------------------------------------------

test("timestamptz[] / timestamp[] text: early-year elements decode literally", async () => {
  const row = await simple(
    [
      { name: "tz", typeOid: OID.timestamptz_array },
      { name: "ts", typeOid: OID.timestamp_array },
    ],
    [
      Buffer.from(`{"0044-03-15 12:00:00+00","0099-03-15 12:00:00+00"}`),
      Buffer.from(`{"0044-03-15 12:00:00","0099-03-15 12:00:00"}`),
    ],
  );
  expect({ tz: row.tz.map(iso), ts: row.ts.map(iso) }).toEqual({
    tz: ["0044-03-15T12:00:00.000Z", "0099-03-15T12:00:00.000Z"],
    ts: ["0044-03-15T12:00:00.000Z", "0099-03-15T12:00:00.000Z"],
  });
});

// --- unaffected neighbours ------------------------------------------------

test("date / naive timestamp text: early years already decoded correctly", async () => {
  const row = await simple(
    [
      { name: "d", typeOid: OID.date },
      { name: "ts", typeOid: OID.timestamp },
    ],
    [Buffer.from("0044-03-15"), Buffer.from("0044-03-15 12:00:00")],
  );
  expect({ d: iso(row.d), ts: iso(row.ts) }).toEqual({
    d: "0044-03-15T00:00:00.000Z",
    ts: "0044-03-15T12:00:00.000Z",
  });
});
