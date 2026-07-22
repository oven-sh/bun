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
// answers Bind with the latched DataRow. The client requests binary result
// format for timestamp/timestamptz, so the DataRow here carries DT_NOEND /
// DT_NOBEGIN as raw i64.
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
          Buffer.concat([pgParseComplete(), pgParameterDescription([]), pgRowDescription(reply().cols), pgReadyForQuery()]),
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

test.each(["date", "timestamp", "timestamptz"] as const)("scalar %s text 'infinity'/'-infinity' → ±Infinity", async t => {
  const row = await runSimple(
    [
      { name: "pos", typeOid: OID[t] },
      { name: "neg", typeOid: OID[t] },
      { name: "fin", typeOid: OID[t] },
    ],
    [Buffer.from("infinity"), Buffer.from("-infinity"), Buffer.from(t === "date" ? "2000-01-02" : "2000-01-02 00:00:00+00")],
  );
  expect(row.pos).toBe(Infinity);
  expect(row.neg).toBe(-Infinity);
  expect(row.fin).toBeInstanceOf(Date);
  expect((row.fin as Date).getTime()).toBe(Date.UTC(2000, 0, 2));
});

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

// --- array text path -------------------------------------------------------

test.each(["date_array", "timestamp_array", "timestamptz_array"] as const)(
  "%s text {infinity,-infinity,<finite>} → [Infinity, -Infinity, Date]",
  async t => {
    const fin = t === "date_array" ? "2000-01-02" : '"2000-01-02 00:00:00+00"';
    const row = await runSimple(
      [{ name: "a", typeOid: OID[t] }],
      [Buffer.from(`{infinity,-infinity,${fin}}`)],
    );
    expect(row.a[0]).toBe(Infinity);
    expect(row.a[1]).toBe(-Infinity);
    expect(row.a[2]).toBeInstanceOf(Date);
    expect((row.a[2] as Date).getTime()).toBe(Date.UTC(2000, 0, 2));
  },
);
