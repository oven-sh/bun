// Fault-injection test: requires a server that sends malformed binary-format
// datums, which a healthy Postgres never does on demand. DO NOT COPY THIS
// PATTERN for behavior a real server can produce. All wire-protocol frames come
// from test/js/sql/wire-frames.ts; do not inline Buffer.alloc frame building.
//
// A RowDescription can declare format=1 (binary) for a column, after which the
// server authors the datum bytes. Bun must validate each binary datum's length
// (and range) against the declared type before decoding, and reject a binary
// format code for a type it has no binary decoder for, instead of silently
// turning a wire-level violation into a plausible JS value.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Big-endian integer encoders for assembling hostile *column payloads* (the
// datum bytes inside a DataRow); these are not wire frames.
const i16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
};
const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
};
const i32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
};
const i64 = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(n, 0);
  return b;
};

async function runMockQuery(columnBytes: Buffer, typeOid: number): Promise<unknown> {
  const { port, server } = await listeningServer(socket => {
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
          pgRowDescription([{ name: "c", typeOid, format: 1 /* binary */ }]),
          pgDataRow([columnBytes]),
          pgCommandComplete("SELECT 1"),
          pgReadyForQuery(),
        ]),
      );
    });
    socket.on("error", () => {});
  });

  const sql = new SQL({
    url: `postgres://u@127.0.0.1:${port}/db`,
    max: 1,
    idleTimeout: 5,
    connectionTimeout: 5,
  });

  try {
    return await sql`select c`.simple();
  } finally {
    await sql.close().catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

const BOOL = 16;
const INT4_ARRAY = 1007;
const FLOAT8 = 701;
const TIME = 1083;
const TIMESTAMP = 1114;
const NUMERIC = 1700;
const UUID = 2950;
const INT4 = 23;

// Binary numeric header — PostgreSQL numeric_send(): Int16 ndigits, Int16
// weight, uint16 sign, uint16 dscale, then ndigits Int16 base-10000 groups.
function numericHeader(ndigits: number, weight: number, sign: number, dscale: number): Buffer {
  return Buffer.concat([i16(ndigits), i16(weight), u16(sign), u16(dscale)]);
}

const malformed: { name: string; oid: number; col: Buffer; code: RegExp }[] = [
  {
    name: "float8 with 4-byte datum",
    oid: FLOAT8,
    col: i32(0),
    code: /ERR_POSTGRES_INVALID_BINARY_DATA/,
  },
  {
    name: "timestamp with 4-byte datum",
    oid: TIMESTAMP,
    col: i32(0),
    code: /ERR_POSTGRES_INVALID_BINARY_DATA/,
  },
  {
    name: "bool with 0-byte datum",
    oid: BOOL,
    col: Buffer.alloc(0),
    code: /ERR_POSTGRES_INVALID_BINARY_DATA/,
  },
  {
    name: "bool with out-of-range value 2",
    oid: BOOL,
    col: Buffer.from([2]),
    code: /ERR_POSTGRES_INVALID_BINARY_DATA/,
  },
  {
    // 20-byte header declares one element, but its length prefix claims 8
    // bytes for a 4-byte int4 element.
    name: "int4[] element length prefix != 4",
    oid: INT4_ARRAY,
    col: Buffer.concat([i32(1), i32(0), i32(INT4), i32(1), i32(1), i32(8), i64(0n)]),
    code: /ERR_POSTGRES_INVALID_BINARY_DATA/,
  },
  {
    name: "time = 2^63-1 microseconds (out of range)",
    oid: TIME,
    col: i64(0x7fffffffffffffffn),
    code: /ERR_POSTGRES_INVALID_TIME_FORMAT/,
  },
  {
    name: "time = -1 microseconds (negative)",
    oid: TIME,
    col: i64(-1n),
    code: /ERR_POSTGRES_INVALID_TIME_FORMAT/,
  },
  {
    // ndigits=0 header followed by trailing junk bytes.
    name: "numeric with trailing bytes after ndigits=0",
    oid: NUMERIC,
    col: Buffer.concat([numericHeader(0, 0, 0x0000, 0), Buffer.from([0xde, 0xad, 0xbe, 0xef])]),
    code: /ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT/,
  },
  {
    // dscale read as a signed int16 is negative (0x8000 = -32768).
    name: "numeric with negative dscale",
    oid: NUMERIC,
    col: Buffer.concat([numericHeader(1, 0, 0x0000, 0x8000), i16(1)]),
    code: /ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT/,
  },
  {
    // 16 raw bytes with a binary format code on a type Bun cannot binary-decode.
    name: "uuid sent with binary format code",
    oid: UUID,
    col: Buffer.alloc(16, 0xab),
    code: /ERR_POSTGRES_UNKNOWN_FORMAT_CODE/,
  },
];

test.concurrent.each(malformed)("binary $name is rejected", async ({ oid, col, code }) => {
  let err: any;
  try {
    await runMockQuery(col, oid);
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err?.code ?? err?.message).toMatch(code);
});

test.concurrent("well-formed binary bool still parses", async () => {
  const result: any = await runMockQuery(Buffer.from([1]), BOOL);
  expect(result[0].c).toBe(true);
});

test.concurrent("well-formed binary float8 still parses", async () => {
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(1.5, 0);
  const result: any = await runMockQuery(buf, FLOAT8);
  expect(result[0].c).toBe(1.5);
});

test.concurrent("in-range binary time still parses", async () => {
  // 01:02:03 = 3723 seconds = 3_723_000_000 microseconds.
  const result: any = await runMockQuery(i64(3_723_000_000n), TIME);
  expect(result[0].c).toBe("01:02:03");
});

test.concurrent("well-formed binary numeric still parses", async () => {
  const col = Buffer.concat([numericHeader(1, 0, 0x0000, 0), i16(1)]);
  const result: any = await runMockQuery(col, NUMERIC);
  expect(result[0].c).toBe("1");
});
