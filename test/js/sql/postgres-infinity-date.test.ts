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
