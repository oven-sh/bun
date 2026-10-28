// Fault-injection test: requires a server that sends malformed values, which a
// healthy container will not do on demand. DO NOT COPY THIS PATTERN: anything a
// real server can produce belongs in describeWithContainer (postgres-decode.test.ts).
// All wire-protocol bytes come from test/js/sql/wire-frames.ts.
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

const OID = { int4: 23, float8: 701, timestamp: 1114, timestamptz: 1184, int4_array: 1007, text_array: 1009 } as const;
const OID_ARRAY = { float8: 1022, bytea: 1001, json: 199 } as const;

// One mock server for the file: it answers each simple query with one row that holds `current`.
type Cell = { typeOid: number; format: 0 | 1; bytes: Buffer };
let current!: Cell;
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
        pgRowDescription([{ name: "v", typeOid: current.typeOid, format: current.format }]),
        pgDataRow([current.bytes]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ]),
    );
  });
  socket.on("error", () => {});
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

/** The decoded cells, or the code each rejected with. All on one connection: a rejected query leaves it usable. */
async function decode(cells: Cell[]): Promise<unknown[]> {
  await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 5, connectionTimeout: 5 });
  const values: unknown[] = [];
  for (const cell of cells) {
    current = cell;
    values.push(
      await sql`select x`.simple().then(
        rows => rows[0].v,
        error => error.code ?? error.name,
      ),
    );
  }
  return values;
}
const text = (typeOid: number, value: string): Cell => ({ typeOid, format: 0, bytes: Buffer.from(value) });
const binary = (typeOid: number, length: number): Cell => ({ typeOid, format: 1, bytes: Buffer.alloc(length, 1) });

test("an array literal that is not one rejects", async () => {
  const literals = [
    "",
    "1",
    "{",
    "{1,2",
    "{1,2,",
    "{1,,2}",
    "{,}",
    "{1}x",
    "{1}}",
    "{{1},2",
    "{{{{{{{1}}}}}}}", // one level more than the server's MAXDIM
    "[0:1]{1,2}",
    "[0:1]=",
    "[0:1]=1",
  ];
  expect(
    await decode([...literals.map(literal => text(OID.int4_array, literal)), text(OID.int4_array, "{7}")]),
  ).toEqual([...literals.map(() => "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT"), [7]]);
});

test("a quoted element that does not end rejects", async () => {
  const literals = ['{"a', '{"a\\', '{"a\\"', '{"a"', '{"a"b}'];
  expect(await decode(literals.map(literal => text(OID.text_array, literal)))).toEqual(
    literals.map(() => "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT"),
  );
});

test("text that is not a value of the type rejects, in a column and in an array", async () => {
  expect(
    await decode([
      text(OID.int4, "x"),
      text(OID.int4, ""),
      text(OID.int4, "2147483648"),
      text(OID.float8, "1.5x"),
      text(OID.int4_array, "{1,x}"),
      text(OID.int4_array, "{1,2147483648}"),
      text(OID_ARRAY.float8, "{1.5,x}"),
      text(OID_ARRAY.bytea, "{abc}"),
      text(OID_ARRAY.json, "{falsy}"),
    ]),
  ).toEqual([
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT",
    "SyntaxError",
  ]);
});

// No server writes a number in most of these ways. What one does write is in postgres-decode.test.ts.
test.each([
  [
    "float8",
    OID.float8,
    OID_ARRAY.float8,
    [
      ...[
        "0",
        "-0",
        "00",
        "-00.0",
        "007",
        "-007.50",
        "1.",
        ".5",
        "-.5",
        "+5",
        "+0.5",
        "1e3",
        "1E3",
        "1.5e-7",
        "0.1e1",
        "1e+20",
      ],
      ...["999999999999999", "9999999999999999", "0.999999999999999", "0.9999999999999999", "000000000000000001"],
      ...[
        "123456789012345.6",
        "9007199254740993",
        "0.000000000000001",
        "0.0000000000000001",
        "99999999999999999999999",
      ],
      ...["NaN", "nan", "Infinity", "-Infinity", "inf", "-inf"],
      ...["1.5x", "1..5", "1.5.", "-", "--1", "1-", ".", "-.", "e5", "1e", "0x10", " 1", "1 "],
    ],
  ],
  [
    "int4",
    OID.int4,
    OID.int4_array,
    [
      ...["0", "-0", "00", "007", "-007", "+5", "2147483647", "-2147483648", "0000000002147483647"],
      ...["2147483648", "-2147483649", "999999999999999", "9999999999999999", "99999999999999999999"],
      ...["1.", "1.0", ".5", "1e3", "-", "--1", "1-", "x", "0x10", " 1", "1 ", "NaN"],
    ],
  ],
] as const)(
  "%s: an element of an array reads as a column does, however it is written",
  async (_, column, array, texts) => {
    const show = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
    const columns = (await decode(texts.map(value => text(column, value)))).map(show);
    expect(new Set(columns).size).toBeGreaterThan(5);

    const alone = await decode(texts.map(value => text(array, `{${value}}`)));
    expect(alone.map(value => (Array.isArray(value) ? value.map(show).join() : value))).toEqual(columns);

    const numbers = texts.filter((_, i) => !columns[i].startsWith("ERR_"));
    const [together] = (await decode([text(array, `{${numbers.join(",NULL,")}}`)])) as [unknown[]];
    expect(together.map(show)).toEqual(columns.filter(value => !value.startsWith("ERR_")).flatMap(value => ["null", value]).slice(1)); // prettier-ignore
  },
);

test("a binary value of the wrong width rejects", async () => {
  expect(
    await decode([
      binary(OID.int4, 0),
      binary(OID.int4, 3),
      binary(OID.int4, 5),
      binary(OID.float8, 4),
      binary(OID.float8, 9),
      binary(OID.timestamp, 4),
      binary(OID.timestamptz, 9),
      binary(OID.int4, 4),
    ]),
  ).toEqual([
    "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
    "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
    "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
    "ERR_POSTGRES_INVALID_BINARY_DATA",
    "ERR_POSTGRES_INVALID_BINARY_DATA",
    "ERR_POSTGRES_INVALID_BINARY_DATA",
    "ERR_POSTGRES_INVALID_BINARY_DATA",
    0x01010101,
  ]);
});

const int32 = (...values: number[]) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeInt32BE(value, i * 4));
  return bytes;
};
/** What array_send writes: dimensions, a flag, the type of the elements, a length and a lower bound for each dimension. */
const int4Array = (lengths: number[], elements: Buffer, dimensions = lengths.length, element: number = OID.int4) => ({
  typeOid: OID.int4_array,
  format: 1 as const,
  bytes: Buffer.concat([int32(dimensions, 0, element), ...lengths.map(length => int32(length, 1)), elements]),
});
const int4s = (...values: (number | null)[]) =>
  Buffer.concat(values.map(value => (value === null ? int32(-1) : int32(4, value))));

test("a binary array that is not one rejects", async () => {
  const most = 0x7fffffff;
  const malformed: Cell[] = [
    { typeOid: OID.int4_array, format: 1, bytes: Buffer.alloc(0) },
    { typeOid: OID.int4_array, format: 1, bytes: int32(1, 0) },
    { typeOid: OID.int4_array, format: 1, bytes: int32(1, 0, OID.int4, 1) },
    int4Array([], int4s(1), 7),
    int4Array([], int4s(1), -1),
    int4Array([], int4s(1), 0),
    int4Array([1], int4s(1), 2),
    int4Array([1], int4s(1), 1, OID.float8),
    int4Array([0], int4s()),
    int4Array([-1], int4s(1)),
    int4Array([2], int4s(1)),
    int4Array([1], int4s(1, 2)),
    int4Array([1], Buffer.concat([int4s(1), Buffer.alloc(1)])),
    // No room is made for what the message cannot hold.
    int4Array([most], int4s(1)),
    int4Array([most, most, most, most, most, most], int4s(1)),
    int4Array([1, 1, 1, 1, 1, most], int4s(1)),
    int4Array([2, 2], int4s(1, 2, 3)),
    int4Array([2, 0], int4s()),
    int4Array([1], int32(-2)),
    int4Array([1], int32(0)),
    int4Array([1], Buffer.concat([int32(3), Buffer.alloc(3)])),
    int4Array([1], Buffer.concat([int32(8), Buffer.alloc(8)])),
    int4Array([1], Buffer.concat([int32(4), Buffer.alloc(2)])),
    int4Array([1], int32(most)),
  ];
  expect(
    await decode([
      ...malformed,
      int4Array([], int4s()),
      int4Array([3], int4s(1, 0, -1)),
      int4Array([3], int4s(1, null, -1)),
      int4Array([2, 2], int4s(1, 2, 3, null)),
    ]),
  ).toEqual([
    ...malformed.map(() => "ERR_POSTGRES_INVALID_BINARY_DATA"),
    new Int32Array(),
    new Int32Array([1, 0, -1]),
    [1, null, -1],
    [
      [1, 2],
      [3, null],
    ],
  ]);
});
