// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A malicious or buggy Postgres server can send a binary-format int4[]/float4[]
// DataRow whose header `len` field exceeds the actual column byte length.
// The binary array parser must validate `len` against the column's byte length
// before iterating; otherwise slice() reads and writes past the read buffer.
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

// Big-endian Int32 encoder for assembling the hostile *column payload* (binary
// array bytes inside a DataRow) — these are not wire frames; the frames
// themselves come from ./wire-frames.
const i32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
};

// Binary int4[]/float4[] column payload header — PostgreSQL array_send():
// Int32 ndim, Int32 flags, Int32 elemtype, then per dim: Int32 len, Int32 lbound.
function binaryArrayHeader(opts: {
  ndim: number;
  flags: number;
  elemtype: number;
  len: number;
  lbound: number;
}): Buffer {
  return Buffer.concat([i32(opts.ndim), i32(opts.flags), i32(opts.elemtype), i32(opts.len), i32(opts.lbound)]);
}

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
      // Column name length is chosen so the column payload lands on a
      // 4-byte boundary within the response buffer; this lets the
      // unpatched parser reach slice() (the actual overflow) instead of
      // tripping the debug-only @alignCast in init() first.
      socket.write(
        Buffer.concat([
          pgRowDescription([{ name: "arr", typeOid, format: 1 /* binary */ }]),
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
    return await sql`select x`.simple();
  } finally {
    await sql.close().catch(() => {});
    await new Promise<void>(r => server.close(() => r()));
  }
}

const INT4_ARRAY = 1007;
const FLOAT4_ARRAY = 1021;
const INT4 = 23;
const FLOAT4 = 700;

const malformed: { name: string; oid: number; col: Buffer }[] = [
  {
    // 20-byte header claims 65536 elements but provides none.
    name: "int4[] with len exceeding column bytes",
    oid: INT4_ARRAY,
    col: binaryArrayHeader({ ndim: 1, flags: 0, elemtype: INT4, len: 65536, lbound: 1 }),
  },
  {
    // Header claims 65536 elements but only 1 element worth of bytes follows.
    name: "int4[] with len exceeding column bytes (partial data)",
    oid: INT4_ARRAY,
    col: Buffer.concat([
      binaryArrayHeader({ ndim: 1, flags: 0, elemtype: INT4, len: 65536, lbound: 1 }),
      i32(4),
      i32(42),
    ]),
  },
  {
    name: "int4[] with negative len",
    oid: INT4_ARRAY,
    col: binaryArrayHeader({ ndim: 1, flags: 0, elemtype: INT4, len: -1, lbound: 1 }),
  },
  {
    // Only 16 bytes: ndim, flags, elemtype, len — missing lbound.
    name: "int4[] with ndim=1 but truncated header",
    oid: INT4_ARRAY,
    col: Buffer.concat([i32(1), i32(0), i32(INT4), i32(1)]),
  },
  {
    name: "int4[] with len = INT32_MAX",
    oid: INT4_ARRAY,
    col: binaryArrayHeader({ ndim: 1, flags: 0, elemtype: INT4, len: 0x7fffffff, lbound: 1 }),
  },
  {
    name: "float4[] with len exceeding column bytes",
    oid: FLOAT4_ARRAY,
    col: binaryArrayHeader({ ndim: 1, flags: 0, elemtype: FLOAT4, len: 1 << 20, lbound: 1 }),
  },
];

test.each(malformed)("binary $name is rejected", async ({ oid, col }) => {
  let err: any;
  try {
    await runMockQuery(col, oid);
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err?.code ?? err?.message).toMatch(/ERR_POSTGRES_INVALID_BINARY_DATA|InvalidBinaryData/);
});

test("well-formed binary int4[] still parses", async () => {
  const col = Buffer.concat([
    binaryArrayHeader({ ndim: 1, flags: 0, elemtype: INT4, len: 3, lbound: 1 }),
    i32(4),
    i32(1),
    i32(4),
    i32(2),
    i32(4),
    i32(3),
  ]);
  const result: any = await runMockQuery(col, INT4_ARRAY);
  expect(result[0].arr).toEqual(new Int32Array([1, 2, 3]));
});
