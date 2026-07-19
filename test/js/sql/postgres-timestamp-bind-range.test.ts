// date::from_js converts a JS millisecond value to the Postgres binary
// timestamp wire format (i64 microseconds since 2000-01-01). The arithmetic
// `(ms as i64 - POSTGRES_EPOCH_MS) * 1000` overflows i64 for |ms| beyond
// ~9.224e15 and, because overflow-checks are off in every bun build profile,
// silently wraps: a Bind is sent with a value off by exactly 2^64 and the
// server accepts it as a valid far-past timestamp. A non-finite value (NaN,
// Infinity, or an Invalid Date) reached the same path via `f64 as i64` and
// encoded as a real timestamp. Both must throw a catchable ERR_OUT_OF_RANGE
// instead. A JS Date's time value is clamped to +/-8.64e15 so a valid Date can
// never overflow; raw number parameters can.
//
// A real Postgres echoes back whatever parameter oid bun declares in Parse,
// and bun declares a number parameter as float8, so the timestamp encode arm
// is not reached organically there. A mock backend that answers Describe with
// ParameterDescription(oid=1184) is the minimal way to reach the arm under
// test; the encode path is the same one bind_and_execute drives whenever a
// cached statement's server-declared parameter type is timestamp/timestamptz.
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
} from "./wire-frames";

const TIMESTAMPTZ = 1184;
const POSTGRES_EPOCH_MS = 946_684_800_000n;

// One mock backend for the file. Each accepted connection answers the
// Parse+Describe phase by declaring one timestamptz parameter, then records
// the first Bind's parameter bytes into `bound` (or leaves it undefined if
// the client errors before ever writing a Bind).
let bound: Buffer | undefined;
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
      if (type === 0x50 /* 'P' Parse */) {
        socket.write(
          Buffer.concat([
            pgParseComplete(),
            pgParameterDescription([TIMESTAMPTZ]),
            pgRowDescription([{ name: "t", typeOid: TIMESTAMPTZ, typeSize: 8, format: 1 }]),
            pgReadyForQuery(),
          ]),
        );
      } else if (type === 0x42 /* 'B' Bind */) {
        // Bind body: String(portal) String(stmt) Int16(nFmt) Int16[nFmt] Int16(nParams) (Int32 len, bytes)[nParams] ...
        let o = 0;
        while (body[o] !== 0) o++;
        o++;
        while (body[o] !== 0) o++;
        o++;
        const nFmt = body.readInt16BE(o);
        o += 2 + nFmt * 2;
        o += 2; // nParams
        const plen = body.readInt32BE(o);
        o += 4;
        bound = plen >= 0 ? Buffer.from(body.subarray(o, o + plen)) : Buffer.alloc(0);
        // Echo the bound bytes back as the single timestamptz result column so
        // the round trip completes for the in-range cases.
        socket.write(
          Buffer.concat([
            pgBindComplete(),
            pgDataRow([bound.length === 8 ? bound : Buffer.alloc(8)]),
            pgCommandComplete("SELECT 1"),
            pgReadyForQuery(),
          ]),
        );
      }
    });
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

async function bind(value: unknown): Promise<{ err: any; sent: bigint | undefined }> {
  bound = undefined;
  const sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    username: "u",
    database: "db",
    tls: false,
    max: 1,
    prepare: true,
    connectionTimeout: 1,
  });
  let err: any;
  try {
    await sql`select ${value as number}`;
  } catch (e) {
    err = e;
  }
  await sql.close({ timeout: 0 }).catch(() => {});
  return { err, sent: bound?.length === 8 ? bound.readBigInt64BE(0) : undefined };
}

// Largest/smallest f64-representable ms whose `(ms - POSTGRES_EPOCH_MS) * 1000`
// still fits in i64. Both are between 2^53 and 2^54 so the f64 step is 2; the
// next representable value in either direction (±2) is the first that wraps.
const MAX_PG_MS = 9_224_318_721_654_774;
const MIN_PG_MS = -9_222_425_352_054_774;

// Before the fix each of these silently wrote a Bind with a wrapped (or
// arbitrary, for non-finite input) i64; the assertion on `sent` is what
// fails without the src/ change.
const rejected: { name: string; value: unknown }[] = [
  { name: "MAX_PG_MS + 2 (first f64 past the positive i64-us limit)", value: MAX_PG_MS + 2 },
  { name: "MIN_PG_MS - 2 (first f64 past the negative i64-us limit)", value: MIN_PG_MS - 2 },
  { name: "1e16 ms (x1000 overflows i64)", value: 1e16 },
  { name: "-1e16 ms (x1000 underflows i64)", value: -1e16 },
  { name: "Number.MAX_VALUE (saturates then overflows)", value: Number.MAX_VALUE },
  { name: "Infinity", value: Infinity },
  { name: "-Infinity", value: -Infinity },
  { name: "NaN", value: NaN },
  { name: "Invalid Date", value: new Date(NaN) },
];

test.each(rejected)("binding $name to timestamptz throws ERR_OUT_OF_RANGE", async ({ value }) => {
  const { err, sent } = await bind(value);
  // The wrapped i64 must never reach the wire.
  expect(sent).toBeUndefined();
  expect(err?.code).toBe("ERR_OUT_OF_RANGE");
});

// Values that must keep encoding correctly.
const MAX_DATE_MS = 8.64e15; // ECMA-262 max Date time value.
const accepted: { name: string; value: unknown; ms: bigint }[] = [
  { name: "0 (unix epoch)", value: 0, ms: 0n },
  { name: "8.64e15 (max JS Date ms)", value: MAX_DATE_MS, ms: BigInt(MAX_DATE_MS) },
  { name: "-8.64e15 (min JS Date ms)", value: -MAX_DATE_MS, ms: -BigInt(MAX_DATE_MS) },
  { name: "MAX_PG_MS (largest raw ms that fits i64 us)", value: MAX_PG_MS, ms: BigInt(MAX_PG_MS) },
  { name: "MIN_PG_MS (smallest raw ms that fits i64 us)", value: MIN_PG_MS, ms: BigInt(MIN_PG_MS) },
  { name: "new Date(8.64e15)", value: new Date(MAX_DATE_MS), ms: BigInt(MAX_DATE_MS) },
  { name: "new Date(0)", value: new Date(0), ms: 0n },
];

test.each(accepted)("binding $name to timestamptz encodes the exact microsecond value", async ({ value, ms }) => {
  const { err, sent } = await bind(value);
  expect(err).toBeUndefined();
  expect(sent).toBe((ms - POSTGRES_EPOCH_MS) * 1000n);
});
