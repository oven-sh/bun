// Postgres `'infinity'::date` / `'-infinity'::timestamp` must decode to the JS
// Number ±Infinity, not `Invalid Date`. An Invalid Date's getTime() is NaN, so
// the sign (and the fact that the value is infinity at all, as opposed to a
// parse failure) is lost. node-postgres (via postgres-date) returns ±Infinity
// for these values; this test pins the same behaviour on every decode path:
//   - scalar text (simple query)
//   - scalar binary (extended protocol, timestamp/timestamptz only)
//   - array text ({infinity,-infinity}::date[] etc.)
//
// Driven by a scripted v3 backend so the exact wire bytes each path sees are
// deterministic. A finite value is included in every case to show that Date
// decoding for ordinary values is unaffected.
//
// The same scripted backends also pin how finite sub-millisecond values are
// reduced to JS Date's millisecond precision by the two scalar decoders (the
// "sub-ms" and "range boundaries" sections below): both must drop the extra
// digits, so that a value arriving in binary decodes to the same instant as
// its text rendering. Which decoder runs is selected by the format code the
// scripted RowDescription declares per column (format: 1 below); against a
// real server the binary decoder is reached when Bind requests binary results,
// which sql-postgres-datetime-tz-fixture.ts covers.

import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
  type PgRowDescriptionColumn,
} from "./wire-frames";

const OID = {
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
  date_array: 1182,
  timestamp_array: 1115,
  timestamptz_array: 1185,
} as const;

// Postgres src/include/datatype/timestamp.h: DT_NOBEGIN / DT_NOEND are
// PG_INT64_MIN / PG_INT64_MAX on the wire for timestamp / timestamptz.
const PG_INT64_MAX = 0x7fffffffffffffffn;
const PG_INT64_MIN = -0x8000000000000000n;

function be64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(n, 0);
  return b;
}

function readBindParameters(body: Buffer): Buffer[] {
  // PostgreSQL FE/BE §55.7 Bind: String(portal) String(stmt) Int16(nFmt)
  // Int16[nFmt] Int16(nParams) (Int32 len, Byte[len])[nParams] ...
  let o = body.indexOf(0) + 1;
  o = body.indexOf(0, o) + 1;
  const nFmt = body.readInt16BE(o);
  o += 2 + 2 * nFmt;
  const nParams = body.readInt16BE(o);
  o += 2;
  const out: Buffer[] = [];
  for (let i = 0; i < nParams; i++) {
    const len = body.readInt32BE(o);
    o += 4;
    out.push(len < 0 ? Buffer.alloc(0) : body.subarray(o, o + len));
    if (len > 0) o += len;
  }
  return out;
}

// --- scripted backends -----------------------------------------------------

// Simple-query backend: serves one RowDescription + one DataRow, latched per
// test via `simpleReply`.
let simpleReply!: { cols: PgRowDescriptionColumn[]; row: (Buffer | null)[] };
const simple = await listeningServer(socket => {
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
        pgRowDescription(simpleReply.cols),
        pgDataRow(simpleReply.row),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => simple.server.close(() => r())));

async function runSimple(cols: PgRowDescriptionColumn[], row: (Buffer | null)[]): Promise<any> {
  simpleReply = { cols, row };
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${simple.port}/db`, max: 1, connectionTimeout: 2 });
  try {
    const [r]: any = await sql`select 1`.simple();
    return r;
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
}

// Extended-protocol backend: answers Parse with the latched RowDescription,
// answers Bind with the latched DataRow. The RowDescription's per-column
// `format: 1` is what routes each cell to the binary decoder (the client's own
// Bind for this parameterless query asks for text), so the DataRow here
// carries raw big-endian i64 microseconds.
let extReply!: { cols: PgRowDescriptionColumn[]; row: (Buffer | null)[] };
const extended = await listeningServer(socket => {
  const reply = () => extReply;
  let pending = Buffer.alloc(0);
  let sawStartup = false;
  socket.on("data", chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (!sawStartup) {
      if (pending.length < 4) return;
      const len = pending.readInt32BE(0);
      if (pending.length < len) return;
      pending = pending.subarray(len);
      sawStartup = true;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    }
    pending = pgReadFrontendMessages(pending, type => {
      if (type === 0x50 /* Parse */) {
        socket.write(
          Buffer.concat([
            pgParseComplete(),
            pgParameterDescription([]),
            pgRowDescription(reply().cols),
            pgReadyForQuery(),
          ]),
        );
      } else if (type === 0x42 /* Bind */) {
        socket.write(
          Buffer.concat([pgBindComplete(), pgDataRow(reply().row), pgCommandComplete("SELECT 1"), pgReadyForQuery()]),
        );
      }
    });
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => extended.server.close(() => r())));

async function runExtended(cols: PgRowDescriptionColumn[], row: (Buffer | null)[]): Promise<any> {
  extReply = { cols, row };
  const sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port: extended.port,
    username: "u",
    database: "db",
    tls: false,
    max: 1,
    prepare: true,
    connectionTimeout: 2,
  });
  try {
    const [r]: any = await sql`select 1`;
    return r;
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
  }
}

// --- scalar text path ------------------------------------------------------

test.each(["date", "timestamp", "timestamptz"] as const)(
  "scalar %s text 'infinity'/'-infinity' → ±Infinity",
  async t => {
    const row = await runSimple(
      [
        { name: "pos", typeOid: OID[t] },
        { name: "neg", typeOid: OID[t] },
        { name: "fin", typeOid: OID[t] },
      ],
      [
        Buffer.from("infinity"),
        Buffer.from("-infinity"),
        Buffer.from(t === "date" ? "2000-01-02" : "2000-01-02 00:00:00+00"),
      ],
    );
    expect(row.pos).toBe(Infinity);
    expect(row.neg).toBe(-Infinity);
    expect(row.fin).toBeInstanceOf(Date);
    expect((row.fin as Date).getTime()).toBe(Date.UTC(2000, 0, 2));
  },
);

// --- scalar binary path (timestamp / timestamptz) --------------------------

test.each(["timestamp", "timestamptz"] as const)("scalar %s binary DT_NOEND/DT_NOBEGIN → ±Infinity", async t => {
  const row = await runExtended(
    [
      { name: "pos", typeOid: OID[t], format: 1 },
      { name: "neg", typeOid: OID[t], format: 1 },
      { name: "fin", typeOid: OID[t], format: 1 },
    ],
    // 86_400_000_000 µs past 2000-01-01 == 2000-01-02 UTC
    [be64(PG_INT64_MAX), be64(PG_INT64_MIN), be64(86_400_000_000n)],
  );
  expect(row.pos).toBe(Infinity);
  expect(row.neg).toBe(-Infinity);
  expect(row.fin).toBeInstanceOf(Date);
  expect((row.fin as Date).getTime()).toBe(Date.UTC(2000, 0, 2));
});

// --- sub-ms precision: binary must floor like text does --------------------
// Each case is an instant at ms precision plus the sub-ms microseconds Postgres
// stored on top of it. Decoding must yield the ms instant itself, i.e. drop the
// extra digits, exactly as the text decoders (and Date.parse) do. The binary
// decoder used to convert µs to a fractional f64 and let the Date constructor's
// timeClip truncate it toward zero, which for instants before 1970 lands 1 ms
// late (the first case came back as 1970-01-01T00:00:00.000Z). More than 2^53
// µs from 2000-01-01 (about 285 years either side) the f64 conversion itself
// was lossy as well, so large remainders rounded up to the next ms there even
// after 1970; the 1000, 2300 and 3000 cases cover that.
const SUB_MS_CASES = [
  // [column, ms-precision instant, extra µs stored beyond the ms]
  ["pre_1970_high_remainder", "1969-12-31T23:59:59.999Z", 999],
  ["pre_1970_low_remainder", "1969-12-31T23:59:59.000Z", 1],
  ["pre_1970_far", "1883-11-18T12:00:00.123Z", 456],
  ["pre_1970_beyond_2p53_us", "1000-06-15T01:02:03.999Z", 999],
  ["pre_1970_whole_ms", "1969-12-31T23:59:59.999Z", 0],
  // Before the Postgres epoch (2000) but after 1970: negative on the wire,
  // positive as unix ms. Already correct before; must stay so.
  ["pre_2000", "1999-12-31T23:59:59.999Z", 600],
  ["post_2000", "2024-06-01T12:00:00.123Z", 456],
  ["post_2000_beyond_2p53_us", "2300-01-01T00:00:00.000Z", 999],
  ["post_2000_far", "3000-06-01T12:00:00.123Z", 999],
] as const;

const SUB_MS_EXPECTED = Object.fromEntries(SUB_MS_CASES.map(([name, iso]) => [name, iso]));

const POSTGRES_EPOCH_UNIX_MS = 946_684_800_000n;

/** Postgres binary timestamp/timestamptz: µs since 2000-01-01T00:00:00Z. */
function pgMicrosecondsFromUnixMs(unixMs: bigint, extraMicros: bigint): bigint {
  return (unixMs - POSTGRES_EPOCH_UNIX_MS) * 1000n + extraMicros;
}

function pgMicroseconds(isoMs: string, extraMicros: number): bigint {
  return pgMicrosecondsFromUnixMs(BigInt(Date.parse(isoMs)), BigInt(extraMicros));
}

/**
 * The server's ISO DateStyle text for the same value, e.g.
 * `1969-12-31 23:59:59.9996` (`+00` appended for timestamptz in a UTC session);
 * Postgres strips trailing zeros from the fraction.
 */
function pgText(isoMs: string, extraMicros: number, withOffset: boolean): string {
  const fraction = (isoMs.slice(-4, -1) + String(extraMicros).padStart(3, "0")).replace(/0+$/, "");
  return `${isoMs.slice(0, 10)} ${isoMs.slice(11, 19)}${fraction && "." + fraction}${withOffset ? "+00" : ""}`;
}

/** Each named column rendered as its ISO instant, "Invalid Date", or its type tag if not a Date. */
function isoStrings(row: Record<string, unknown>, columns: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    columns.map(name => {
      const v = row[name];
      if (!(v instanceof Date)) return [name, Object.prototype.toString.call(v)];
      return [name, Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString()];
    }),
  );
}

const SUB_MS_COLUMNS = SUB_MS_CASES.map(([name]) => name);

test.each(["timestamp", "timestamptz"] as const)("scalar %s binary sub-ms values floor to the ms instant", async t => {
  const row = await runExtended(
    SUB_MS_CASES.map(([name]) => ({ name, typeOid: OID[t], format: 1 })),
    SUB_MS_CASES.map(([, iso, extra]) => be64(pgMicroseconds(iso, extra))),
  );
  expect(isoStrings(row, SUB_MS_COLUMNS)).toEqual(SUB_MS_EXPECTED);
});

test.each(["timestamp", "timestamptz"] as const)("scalar %s text sub-ms values floor to the ms instant", async t => {
  const row = await runSimple(
    SUB_MS_CASES.map(([name]) => ({ name, typeOid: OID[t] })),
    SUB_MS_CASES.map(([, iso, extra]) => Buffer.from(pgText(iso, extra, t === "timestamptz"))),
  );
  expect(isoStrings(row, SUB_MS_COLUMNS)).toEqual(SUB_MS_EXPECTED);
});

// --- range boundaries (binary) ---------------------------------------------
// The wire values next to the DT_NOEND / DT_NOBEGIN sentinels must divide
// without overflowing and come out as Invalid Date (past JS Date's range), and
// because the decoder floors to a whole ms before timeClip sees the value, a
// sub-ms remainder on JS Date's extreme instants floors onto them: the maximum
// plus 999 µs used to become Invalid Date, and 1 µs below the minimum floors
// out of range.
const JS_DATE_MAX_UNIX_MS = 8_640_000_000_000_000n;
const JS_DATE_MAX_ISO = "+275760-09-13T00:00:00.000Z";
const JS_DATE_MIN_ISO = "-271821-04-20T00:00:00.000Z";

const BOUNDARY_CASES = [
  // [column, wire value, decoded]
  ["below_dt_noend", PG_INT64_MAX - 1n, "Invalid Date"],
  ["above_dt_nobegin", PG_INT64_MIN + 1n, "Invalid Date"],
  ["js_max", pgMicrosecondsFromUnixMs(JS_DATE_MAX_UNIX_MS, 0n), JS_DATE_MAX_ISO],
  ["js_max_plus_999us", pgMicrosecondsFromUnixMs(JS_DATE_MAX_UNIX_MS, 999n), JS_DATE_MAX_ISO],
  ["js_max_plus_1ms", pgMicrosecondsFromUnixMs(JS_DATE_MAX_UNIX_MS + 1n, 0n), "Invalid Date"],
  ["js_min", pgMicrosecondsFromUnixMs(-JS_DATE_MAX_UNIX_MS, 0n), JS_DATE_MIN_ISO],
  ["js_min_plus_999us", pgMicrosecondsFromUnixMs(-JS_DATE_MAX_UNIX_MS, 999n), JS_DATE_MIN_ISO],
  ["js_min_minus_1us", pgMicrosecondsFromUnixMs(-JS_DATE_MAX_UNIX_MS, -1n), "Invalid Date"],
] as const;

const BOUNDARY_COLUMNS = BOUNDARY_CASES.map(([name]) => name);

test.each(["timestamp", "timestamptz"] as const)("scalar %s binary values at the JS Date range boundaries", async t => {
  const row = await runExtended(
    BOUNDARY_CASES.map(([name]) => ({ name, typeOid: OID[t], format: 1 })),
    BOUNDARY_CASES.map(([, wire]) => be64(wire)),
  );
  expect(isoStrings(row, BOUNDARY_COLUMNS)).toEqual(
    Object.fromEntries(BOUNDARY_CASES.map(([name, , iso]) => [name, iso])),
  );
});

// --- array text path -------------------------------------------------------

test.each(["date_array", "timestamp_array", "timestamptz_array"] as const)(
  "%s text {infinity,-infinity,<finite>} → [Infinity, -Infinity, Date]",
  async t => {
    const fin = t === "date_array" ? "2000-01-02" : '"2000-01-02 00:00:00+00"';
    const row = await runSimple([{ name: "a", typeOid: OID[t] }], [Buffer.from(`{infinity,-infinity,${fin}}`)]);
    expect(row.a[0]).toBe(Infinity);
    expect(row.a[1]).toBe(-Infinity);
    expect(row.a[2]).toBeInstanceOf(Date);
    expect((row.a[2] as Date).getTime()).toBe(Date.UTC(2000, 0, 2));
  },
);

// --- encode (bind) path ----------------------------------------------------
// Binding the ±Infinity the decoder produces back to a timestamp / timestamptz
// parameter must write DT_NOEND / DT_NOBEGIN on the wire. Before the matching
// from_js fix, `f64::INFINITY as i64` saturated to i64::MAX and the
// (ms - epoch) * 1000 arithmetic overflowed: debug panicked, release wrapped
// to a garbage i64.

test.each(["timestamp", "timestamptz"] as const)("binding ±Infinity to %s writes DT_NOEND / DT_NOBEGIN", async t => {
  let sent: Buffer[] | undefined;
  const { port, server } = await listeningServer(socket => {
    let pending = Buffer.alloc(0);
    let sawStartup = false;
    socket.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      if (!sawStartup) {
        if (pending.length < 4) return;
        const len = pending.readInt32BE(0);
        if (pending.length < len) return;
        pending = pending.subarray(len);
        sawStartup = true;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      }
      pending = pgReadFrontendMessages(pending, (type, body) => {
        if (type === 0x50 /* Parse */) {
          socket.write(
            Buffer.concat([
              pgParseComplete(),
              pgParameterDescription([OID[t], OID[t], OID[t]]),
              pgRowDescription([{ name: "x", typeOid: 25 }]),
              pgReadyForQuery(),
            ]),
          );
        } else if (type === 0x42 /* Bind */) {
          sent = readBindParameters(body);
          socket.write(
            Buffer.concat([
              pgBindComplete(),
              pgDataRow([Buffer.from("ok")]),
              pgCommandComplete("SELECT 1"),
              pgReadyForQuery(),
            ]),
          );
        }
      });
    });
    socket.on("error", () => {});
  });
  try {
    const sql = new SQL({
      adapter: "postgres",
      hostname: "127.0.0.1",
      port,
      username: "u",
      database: "db",
      tls: false,
      max: 1,
      prepare: true,
      connectionTimeout: 2,
    });
    try {
      await sql`select ${Infinity}, ${-Infinity}, ${new Date(Date.UTC(2000, 0, 2))}`;
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
    }
  } finally {
    await new Promise<void>(r => server.close(() => r()));
  }
  expect(sent).toBeDefined();
  expect(sent!.map(b => b.readBigInt64BE(0))).toEqual([PG_INT64_MAX, PG_INT64_MIN, 86_400_000_000n]);
});

test.each(["timestamp", "timestamptz"] as const)(
  "binding a number beyond the %s range clamps to DT_NOEND / DT_NOBEGIN",
  async t => {
    let sent: Buffer[] | undefined;
    const { port, server } = await listeningServer(socket => {
      let pending = Buffer.alloc(0);
      let sawStartup = false;
      socket.on("data", chunk => {
        pending = Buffer.concat([pending, chunk]);
        if (!sawStartup) {
          if (pending.length < 4) return;
          const len = pending.readInt32BE(0);
          if (pending.length < len) return;
          pending = pending.subarray(len);
          sawStartup = true;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        }
        pending = pgReadFrontendMessages(pending, (type, body) => {
          if (type === 0x50 /* Parse */) {
            socket.write(
              Buffer.concat([
                pgParseComplete(),
                pgParameterDescription([OID[t], OID[t], OID[t]]),
                pgRowDescription([{ name: "x", typeOid: 25 }]),
                pgReadyForQuery(),
              ]),
            );
          } else if (type === 0x42 /* Bind */) {
            sent = readBindParameters(body);
            socket.write(
              Buffer.concat([
                pgBindComplete(),
                pgDataRow([Buffer.from("ok")]),
                pgCommandComplete("SELECT 1"),
                pgReadyForQuery(),
              ]),
            );
          }
        });
      });
      socket.on("error", () => {});
    });
    try {
      const sql = new SQL({
        adapter: "postgres",
        hostname: "127.0.0.1",
        port,
        username: "u",
        database: "db",
        tls: false,
        max: 1,
        prepare: true,
        connectionTimeout: 2,
      });
      try {
        await sql`select ${1e18}, ${-1e18}, ${new Date(Date.UTC(2000, 0, 2))}`;
      } finally {
        await sql.close({ timeout: 0 }).catch(() => {});
      }
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
    expect(sent).toBeDefined();
    expect(sent!.map(b => b.readBigInt64BE(0))).toEqual([PG_INT64_MAX, PG_INT64_MIN, 86_400_000_000n]);
  },
);
