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
import { afterAll, expect, test } from "bun:test";
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
const i16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
};
const f32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeFloatBE(n, 0);
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

// Same header with one (len, lbound = 1) pair per entry of `dims`.
function multiDimArrayHeader(opts: { flags: number; elemtype: number; dims: number[] }): Buffer {
  return Buffer.concat([
    i32(opts.dims.length),
    i32(opts.flags),
    i32(opts.elemtype),
    ...opts.dims.map(len => Buffer.concat([i32(len), i32(1)])),
  ]);
}

// Element payloads: a 4-byte length prefix per element, -1 for NULL.
const int4Elems = (values: (number | null)[]): Buffer =>
  Buffer.concat(values.map(v => (v === null ? i32(-1) : Buffer.concat([i32(4), i32(v)]))));
const float4Elems = (values: (number | null)[]): Buffer =>
  Buffer.concat(values.map(v => (v === null ? i32(-1) : Buffer.concat([i32(4), f32(v)]))));

// One mock server for the file; each test sets `current` before connecting and
// the accept handler latches it per connection. A per-test server flaked on
// Windows CI with ERR_POSTGRES_CONNECTION_REFUSED (loopback SYN not retransmitted).
let current!: { col: Buffer; oid: number };
const { port, server } = await listeningServer(socket => {
  const { col, oid } = current;
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
        pgRowDescription([{ name: "arr", typeOid: oid, format: 1 /* binary */ }]),
        pgDataRow([col]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

async function runMockQuery(columnBytes: Buffer, typeOid: number): Promise<unknown> {
  current = { col: columnBytes, oid: typeOid };
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
  // The has-nulls flag and ndim > 1 take the plain-array decoder. Its counts
  // are server-controlled too.
  {
    name: "int4[] with nulls and len = INT32_MAX",
    oid: INT4_ARRAY,
    col: binaryArrayHeader({ ndim: 1, flags: 1, elemtype: INT4, len: 0x7fffffff, lbound: 1 }),
  },
  {
    // 65536 x 65536 elements claimed, no element bytes follow.
    name: "int4[] with two dimensions whose product exceeds column bytes",
    oid: INT4_ARRAY,
    col: multiDimArrayHeader({ flags: 0, elemtype: INT4, dims: [65536, 65536] }),
  },
  {
    name: "int4[] with ndim exceeding the nesting limit",
    oid: INT4_ARRAY,
    col: Buffer.concat([
      i32(101),
      i32(0),
      i32(INT4),
      ...Array.from({ length: 101 }, () => Buffer.concat([i32(1), i32(1)])),
    ]),
  },
  {
    // ndim=2 but only one dimension pair follows.
    name: "int4[] with ndim=2 and a truncated header",
    oid: INT4_ARRAY,
    col: binaryArrayHeader({ ndim: 2, flags: 0, elemtype: INT4, len: 1, lbound: 1 }),
  },
  {
    name: "int4[] with a negative second dimension",
    oid: INT4_ARRAY,
    col: multiDimArrayHeader({ flags: 0, elemtype: INT4, dims: [1, -1] }),
  },
  {
    // Element length 2 in an int4[] that has the has-nulls flag set.
    name: "int4[] with nulls and an element of the wrong size",
    oid: INT4_ARRAY,
    col: Buffer.concat([
      binaryArrayHeader({ ndim: 1, flags: 1, elemtype: INT4, len: 2, lbound: 1 }),
      i32(-1),
      i32(2),
      i16(7),
    ]),
  },
  {
    // The second element's length prefix says 4 bytes but the column ends.
    name: "int4[] with nulls and a truncated element",
    oid: INT4_ARRAY,
    col: Buffer.concat([
      binaryArrayHeader({ ndim: 1, flags: 1, elemtype: INT4, len: 2, lbound: 1 }),
      i32(-1),
      i32(4),
      i16(7),
    ]),
  },
  {
    // 2 x 2 claimed, the 3rd element's payload is missing.
    name: "int4[] with two dimensions and a missing element",
    oid: INT4_ARRAY,
    col: Buffer.concat([
      multiDimArrayHeader({ flags: 0, elemtype: INT4, dims: [2, 2] }),
      i32(4),
      i32(1),
      i32(4),
      i32(2),
      i32(4),
    ]),
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

// A typed array has no null holes and no nesting, so these shapes decode into
// a plain array, like the text path does for the same value.
const plainArrays: { name: string; oid: number; col: Buffer; expected: unknown }[] = [
  {
    name: "int4[] with a NULL element",
    oid: INT4_ARRAY,
    col: Buffer.concat([
      binaryArrayHeader({ ndim: 1, flags: 1, elemtype: INT4, len: 3, lbound: 1 }),
      int4Elems([1, null, 3]),
    ]),
    expected: [1, null, 3],
  },
  {
    name: "float4[] with a NULL element",
    oid: FLOAT4_ARRAY,
    col: Buffer.concat([
      binaryArrayHeader({ ndim: 1, flags: 1, elemtype: FLOAT4, len: 3, lbound: 1 }),
      float4Elems([1.5, null, 3.5]),
    ]),
    expected: [1.5, null, 3.5],
  },
  {
    // A subscript update leaves the flag set after the last NULL is gone.
    name: "int4[] with the has-nulls flag and no NULL element",
    oid: INT4_ARRAY,
    col: Buffer.concat([
      binaryArrayHeader({ ndim: 1, flags: 1, elemtype: INT4, len: 2, lbound: 1 }),
      int4Elems([1, 2]),
    ]),
    expected: [1, 2],
  },
  {
    name: "int4[] with two dimensions",
    oid: INT4_ARRAY,
    col: Buffer.concat([multiDimArrayHeader({ flags: 0, elemtype: INT4, dims: [2, 2] }), int4Elems([1, 2, 3, 4])]),
    expected: [
      [1, 2],
      [3, 4],
    ],
  },
  {
    name: "float4[] with two dimensions and a NULL element",
    oid: FLOAT4_ARRAY,
    col: Buffer.concat([
      multiDimArrayHeader({ flags: 1, elemtype: FLOAT4, dims: [2, 2] }),
      float4Elems([1.5, null, 3.5, 4.5]),
    ]),
    expected: [
      [1.5, null],
      [3.5, 4.5],
    ],
  },
  {
    name: "int4[] with three dimensions",
    oid: INT4_ARRAY,
    col: Buffer.concat([multiDimArrayHeader({ flags: 0, elemtype: INT4, dims: [2, 1, 2] }), int4Elems([1, 2, 3, 4])]),
    expected: [[[1, 2]], [[3, 4]]],
  },
  {
    // A zero dimension holds no element, whatever the other dimensions say.
    name: "int4[] with a zero dimension",
    oid: INT4_ARRAY,
    col: multiDimArrayHeader({ flags: 0, elemtype: INT4, dims: [0x7fffffff, 0] }),
    expected: [],
  },
];

test.each(plainArrays)("binary $name decodes to a plain array", async ({ oid, col, expected }) => {
  const result: any = await runMockQuery(col, oid);
  expect(result[0].arr).toEqual(expected);
});
