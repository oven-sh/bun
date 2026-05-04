// A malicious or buggy Postgres server can send a binary-format int4[]/float4[]
// DataRow whose header `len` field exceeds the actual column byte length.
// The binary array parser must validate `len` against the column's byte length
// before iterating; otherwise slice() reads and writes past the read buffer.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

function pkt(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

function int16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function cstr(s: string): Buffer {
  return Buffer.concat([Buffer.from(s), Buffer.from([0])]);
}

function rowDescription(cols: { name: string; oid: number; format: number }[]): Buffer {
  const fields = Buffer.concat(
    cols.map(c =>
      Buffer.concat([
        cstr(c.name),
        int32(0), // table oid
        int16(0), // column attr number
        int32(c.oid), // type oid
        int16(-1), // type size
        int32(-1), // type modifier
        int16(c.format), // format: 0=text, 1=binary
      ]),
    ),
  );
  return pkt("T", Buffer.concat([int16(cols.length), fields]));
}

function dataRowRaw(cols: Buffer[]): Buffer {
  const body = Buffer.concat(cols.map(c => Buffer.concat([int32(c.length), c])));
  return pkt("D", Buffer.concat([int16(cols.length), body]));
}

// Binary int4[] header: ndim, flags, elemtype, [len, lbound] per dim, then elements.
function binaryArrayHeader(opts: {
  ndim: number;
  flags: number;
  elemtype: number;
  len: number;
  lbound: number;
}): Buffer {
  return Buffer.concat([
    int32(opts.ndim),
    int32(opts.flags),
    int32(opts.elemtype),
    int32(opts.len),
    int32(opts.lbound),
  ]);
}

const authenticationOk = pkt("R", int32(0));
const readyForQuery = pkt("Z", Buffer.from("I"));
const commandComplete = (tag: string) => pkt("C", cstr(tag));

async function runMockQuery(columnBytes: Buffer, typeOid: number): Promise<unknown> {
  const server = net.createServer(socket => {
    let startup = true;
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([authenticationOk, readyForQuery]));
        return;
      }
      if (data[0] !== 0x51 /* 'Q' */) return;
      // Column name length is chosen so the column payload lands on a
      // 4-byte boundary within the response buffer; this lets the
      // unpatched parser reach slice() (the actual overflow) instead of
      // tripping the debug-only @alignCast in init() first.
      socket.write(
        Buffer.concat([
          rowDescription([{ name: "arr", oid: typeOid, format: 1 /* binary */ }]),
          dataRowRaw([columnBytes]),
          commandComplete("SELECT 1"),
          readyForQuery,
        ]),
      );
    });
    socket.on("error", () => {});
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

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
      int32(4),
      int32(42),
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
    col: Buffer.concat([int32(1), int32(0), int32(INT4), int32(1)]),
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
    int32(4),
    int32(1),
    int32(4),
    int32(2),
    int32(4),
    int32(3),
  ]);
  const result: any = await runMockQuery(col, INT4_ARRAY);
  expect(result[0].arr).toEqual(new Int32Array([1, 2, 3]));
});
