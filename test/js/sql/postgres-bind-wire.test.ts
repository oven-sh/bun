// Pins the exact frontend bytes of a query for each kind of parameter, so a
// change to the Bind encoder cannot change the wire by accident.
// A real server does not show what it received, so this uses a mock.
// What the server makes of these bytes is in postgres-bind.test.ts.
import { SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import type { Socket } from "node:net";
import {
  pgBind,
  pgBindComplete,
  pgCommandComplete,
  pgCString,
  pgDataRow,
  pgDecodeBind,
  pgDescribe,
  pgExecute,
  pgHold,
  pgInt32,
  pgMockServer,
  pgParameterDescription,
  pgParse,
  pgParseComplete,
  pgRaw,
  pgReadyForQuery,
  pgRowDescription,
  pgSync,
} from "./wire-frames";

const OID = {
  bool: 16,
  bytea: 17,
  int8: 20,
  int4: 23,
  text: 25,
  json: 114,
  float4: 700,
  float8: 701,
  int4_array: 1007,
  box_array: 1020,
  float4_array: 1021,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  numeric: 1700,
  jsonb: 3802,
  jsonb_array: 3807,
};
// Above u16::MAX, so the client treats it as a type it does not know.
const CUSTOM_OID = 70000;

// The mock has no SQL parser. A query tells it what to describe in a comment:
// `/* params=<oid,...> cols=<oid,...> */`.
function described(query: string): { params: number[]; cols: number[] } {
  const list = (key: string) => (query.match(new RegExp(`${key}=([0-9,]*)`))?.[1] ?? "").split(",").filter(Boolean);
  return { params: list("params").map(Number), cols: list("cols").map(Number) };
}

const received = new Map<Socket, Buffer[]>();
const lastParse = new Map<Socket, { params: number[]; cols: number[] }>();
const mock = await pgMockServer((type, body, socket) => {
  if (!received.has(socket)) received.set(socket, []);
  received.get(socket)!.push(pgRaw(type, body));
  switch (type) {
    case "P": {
      const query = body.toString("utf8", body.indexOf(0) + 1, body.indexOf(0, body.indexOf(0) + 1));
      lastParse.set(socket, described(query));
      return pgParseComplete();
    }
    case "D": {
      const { params, cols } = lastParse.get(socket)!;
      return [pgParameterDescription(params), pgRowDescription(cols.map((typeOid, i) => ({ name: `c${i}`, typeOid })))];
    }
    case "B":
      return pgBindComplete();
    case "E":
      return pgCommandComplete("SELECT 0");
    case "S":
      return pgReadyForQuery();
    case "Q":
      return [pgCommandComplete("SELECT 0"), pgReadyForQuery()];
  }
});
afterAll(() => new Promise<void>(resolve => mock.server.close(() => resolve())));

/** Everything the one connection of `sql` sent since the last call, one hex string per frontend message. */
function drain(): string[] {
  const out: string[] = [];
  for (const frames of received.values()) out.push(...frames.splice(0).map(f => f.toString("hex")));
  return out;
}
const hex = (frames: Buffer[]) => frames.map(f => f.toString("hex"));
/** The statement name and query text of the first message (a Parse) of a drained stream. */
function parsed(stream: string[]): { statement: string; query: string } {
  const parse = Buffer.from(stream[0], "hex");
  const nameEnd = parse.indexOf(0, 5);
  return {
    statement: parse.toString("utf8", 5, nameEnd),
    query: parse.toString("utf8", nameEnd + 1, parse.indexOf(0, nameEnd + 1)),
  };
}
const statementName = (stream: string[]) => parsed(stream).statement;

const date = new Date("2000-01-01T00:00:01.000Z");

// [label, value, type the server describes, type the client declares in Parse (0 = server decides), Bind format, Bind value]
const cases: [string, unknown, number, number, 0 | 1, Buffer | null][] = [
  ["null", null, OID.int4, 0, 0, null],
  ["boolean as bool", true, OID.bool, OID.bool, 1, Buffer.from([1])],
  ["integer as int4", 42, OID.int4, OID.int4, 1, Buffer.from("0000002a", "hex")],
  ["safe integer past int32 as int8", 2 ** 52, OID.int8, OID.int8, 0, Buffer.from("4503599627370496")],
  ["BigInt as int8", 123n, OID.int8, OID.int8, 0, Buffer.from("123")],
  ["BigInt past int64 as numeric", 2n ** 64n, OID.numeric, OID.numeric, 0, Buffer.from("18446744073709551616")],
  ["double as float8", 1.5, OID.float8, OID.float8, 1, Buffer.from("3ff8000000000000", "hex")],
  ["-0 as float8", -0, OID.float8, OID.float8, 1, Buffer.from("8000000000000000", "hex")],
  ["Infinity as float8", Infinity, OID.float8, OID.float8, 1, Buffer.from("7ff0000000000000", "hex")],
  // Microseconds since 2000-01-01T00:00:00Z.
  ["Date as timestamptz", date, OID.timestamptz, 0, 1, Buffer.from("00000000000f4240", "hex")],
  ["Date as timestamp", date, OID.timestamp, 0, 1, Buffer.from("00000000000f4240", "hex")],
  ["Date as date", date, OID.date, 0, 0, Buffer.from("2000-01-01T00:00:01.000Z")],
  ["Date as time", date, OID.time, 0, 0, Buffer.from("2000-01-01 00:00:01.000Z")],
  ["Date as jsonb", date, OID.jsonb, 0, 0, Buffer.from('"2000-01-01T00:00:01.000Z"')],
  ["Date as int4", date, OID.int4, 0, 0, Buffer.from("2000-01-01T00:00:01.000Z")],
  ["Invalid Date as timestamptz", new Date(NaN), OID.timestamptz, 0, 0, Buffer.from("Invalid Date")],
  ["ASCII string as text", "hello", OID.text, 0, 0, Buffer.from("hello")],
  ["non-ASCII string as text", "h\u00e9llo \u2603", OID.text, 0, 0, Buffer.from("h\u00e9llo \u2603", "utf8")],
  ["string as jsonb", '{"a":"\u00e9\u2603"}', OID.jsonb, 0, 0, Buffer.from('"{\\"a\\":\\"\u00e9\u2603\\"}"', "utf8")],
  ["String object as text", new String("hello"), OID.text, 0, 0, Buffer.from("hello")],
  ["String object as json", new String("hello"), OID.json, 0, 0, Buffer.from('"hello"')],
  ["object as jsonb", { a: 1 }, OID.jsonb, 0, 0, Buffer.from('{"a":1}')],
  ["object as text", { a: 1 }, OID.text, 0, 0, Buffer.from('{"a":1}')],
  ["object as bool", { a: 1 }, OID.bool, 0, 0, Buffer.from('{"a":1}')],
  ["object with toString as numeric", { toString: () => "1.50" }, OID.numeric, 0, 0, Buffer.from("1.50")],
  ["object with toString as float4", { toString: () => "1.50" }, OID.float4, 0, 0, Buffer.from("1.50")],
  ["object with toString as jsonb", { toString: () => "1.50", n: 1 }, OID.jsonb, 0, 0, Buffer.from('{"n":1}')],
  ["URL as text", new URL("http://a/b"), OID.text, 0, 0, Buffer.from("http://a/b")],
  ["array as json", [1, "x"], OID.json, 0, 0, Buffer.from('[1,"x"]')],
  ["array as int4[]", [1, null, 2], OID.int4_array, 0, 0, Buffer.from('{"1",NULL,"2"}')],
  ["array as jsonb[]", [{ a: 1 }], OID.jsonb_array, 0, 0, Buffer.from('{"{\\"a\\":1}"}')],
  ["array as box[]", ["(1,1),(0,0)", "(3,3),(2,2)"], OID.box_array, 0, 0, Buffer.from('{"(1,1),(0,0)";"(3,3),(2,2)"}')],
  ["array as text", ["a", "b"], OID.text, 0, 0, Buffer.from("a,b")],
  ["array as bool", [true], OID.bool, 0, 0, Buffer.from("true")],
  ["array for an unknown type", ["a", "b"], CUSTOM_OID, 0, 0, Buffer.from("a,b")],
  ["Int32Array as int4[]", new Int32Array([1, 2]), OID.int4_array, 0, 0, Buffer.from('{"1","2"}')],
  ["Int32Array as text", new Int32Array([1, 2]), OID.text, 0, 0, Buffer.from("1,2")],
  ["Int32Array as bytea", new Int32Array([1]), OID.bytea, 0, 1, Buffer.from(new Int32Array([1]).buffer)],
  ["Float32Array as bytea", new Float32Array([1.5]), OID.bytea, OID.bytea, 1, Buffer.from("0000c03f", "hex")],
  ["Buffer as bytea", Buffer.from([1, 2, 3]), OID.bytea, OID.bytea, 1, Buffer.from([1, 2, 3])],
  [
    "DataView as bytea",
    new DataView(new Uint8Array([1, 2, 3]).buffer, 1),
    OID.bytea,
    OID.bytea,
    1,
    Buffer.from([2, 3]),
  ],
  ["string for a binary type stays text", "42", OID.int4, 0, 0, Buffer.from("42")],
  ["string for an unknown type", "happy", CUSTOM_OID, 0, 0, Buffer.from("happy")],
];

describe("named statements", () => {
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1 });
  afterAll(() => sql.close({ timeout: 0 }));

  test.each(cases)("%s", async (label, value, described, declared, format, encoded) => {
    // The label makes the text unique, so every case prepares its own statement.
    const query = `select $1 as v /* ${label}: params=${described} cols=${OID.text} */`;
    await sql.unsafe(query, [value]);
    const first = drain();
    const statement = statementName(first);
    expect(statement).not.toBe("");
    const bind = pgBind({ statement, paramFormats: [format], params: [encoded], resultFormats: [] });
    // Parse and Describe go first. The Bind waits for the ParameterDescription.
    expect(first).toEqual(
      hex([pgParse(statement, query, [declared]), pgDescribe("S", statement), pgSync(), bind, pgExecute(), pgSync()]),
    );

    // The statement is prepared now: the next execution sends only the Bind batch.
    await sql.unsafe(query, [value]);
    expect(drain()).toEqual(hex([bind, pgExecute(), pgSync()]));
  });

  test("several parameters, one binary result column", async () => {
    const query = `select $1, $2, $3, $4 /* params=${OID.int4},${OID.text},${OID.int4},${OID.bool} cols=${OID.int4},${OID.text} */`;
    await sql.unsafe(query, [7, "seven", null, false]);
    const stream = drain();
    const statement = statementName(stream);
    expect(stream).toEqual(
      hex([
        pgParse(statement, query, [OID.int4, 0, 0, OID.bool]),
        pgDescribe("S", statement),
        pgSync(),
        pgBind({
          statement,
          paramFormats: [1, 0, 0, 1],
          params: [Buffer.from("00000007", "hex"), Buffer.from("seven"), null, Buffer.from([0])],
          // One code per column once any column can be binary.
          resultFormats: [1, 0],
        }),
        pgExecute(),
        pgSync(),
      ]),
    );
  });

  // 65552 is 65536 + 16: a user-defined type, not bool.
  const columns = [
    ...[OID.bool, OID.int4, OID.float8, OID.timestamp, OID.timestamptz, OID.bytea],
    // int2[], int4[], float4[], float8[]
    ...[1005, OID.int4_array, OID.float4_array, 1022],
    // int8[] and text[] among them
    ...[OID.numeric, OID.float4, OID.time, 1016, 1009, OID.text, 65552],
  ];
  const resultFormats = (stream: string[]) =>
    stream
      .filter(frame => frame.startsWith("42"))
      .map(frame => pgDecodeBind(Buffer.from(frame, "hex").subarray(5)).resultFormats);

  test("the columns that have a decoder for it are asked for in binary, the rest in text", async () => {
    await sql.unsafe(`select $1 /* formats: params=${OID.int4} cols=${columns} */`, [1]);
    expect(resultFormats(drain())).toEqual([[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0]]);
  });

  test("raw() asks for the columns in binary that it has always handed out in binary", async () => {
    await sql.unsafe(`select $1 /* raw formats: params=${OID.int4} cols=${columns.slice(0, -1)} */`, [1]).raw();
    expect(resultFormats(drain())).toEqual([[1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 0]]);
  });

  test("values of an object through the sql() helper", async () => {
    // Literal OIDs: an interpolation in a tagged template is a parameter.
    await sql`insert into t ${sql({ a: 7, b: "seven", c: null })} /* params=23,25,23 cols=25 */`;
    const stream = drain();
    // The helper writes the column list and the placeholders: the text is not pinned here, the values are.
    const { statement, query } = parsed(stream);
    expect(query).toContain("$3");
    expect(stream).toEqual(
      hex([
        pgParse(statement, query, [OID.int4, 0, 0]),
        pgDescribe("S", statement),
        pgSync(),
        pgBind({
          statement,
          paramFormats: [1, 0, 0],
          params: [Buffer.from("00000007", "hex"), Buffer.from("seven"), null],
          resultFormats: [],
        }),
        pgExecute(),
        pgSync(),
      ]),
    );
  });

  test("no parameters: one batch", async () => {
    // sql.unsafe() without parameters is a simple query. A tagged template is not.
    const query = "select 1 /* params= cols=25 */";
    await sql`select 1 /* params= cols=25 */`;
    const stream = drain();
    const statement = statementName(stream);
    expect(statement).not.toBe("");
    expect(stream).toEqual(
      hex([
        pgParse(statement, query),
        pgDescribe("S", statement),
        pgBind({ statement, paramFormats: [], params: [], resultFormats: [] }),
        pgExecute(),
        pgSync(),
      ]),
    );
  });

  test("a simple query is one Query message and nothing else", async () => {
    await sql.unsafe("select 1");
    await sql`select 2`.simple();
    // The second one waits for the first, so the queue writes it.
    await Promise.all([sql.unsafe("select 3"), sql.unsafe("select 4")]);
    // The length of a frame counts a terminator, also behind a text that ends in NUL.
    await sql.unsafe("select 5\0");
    expect(drain()).toEqual(
      hex(["select 1", "select 2", "select 3", "select 4", "select 5\0"].map(text => pgRaw("Q", pgCString(text)))),
    );
  });
});

describe("prepare: false", () => {
  const sql = new SQL({ url: `postgres://u@127.0.0.1:${mock.port}/db`, max: 1, prepare: false });
  afterAll(() => sql.close({ timeout: 0 }));

  test("parameters: one batch, encoded from the types the client declares", async () => {
    const query = `select $1, $2, $3, $4, $5 /* params=${OID.int4},${OID.text},${OID.int4},${OID.bool},${OID.float8} cols=${OID.text} */`;
    const batch = [
      pgParse("", query, [OID.int4, 0, 0, OID.bool, OID.float8]),
      pgDescribe("S", ""),
      pgBind({
        statement: "",
        paramFormats: [1, 0, 0, 1, 1],
        params: [
          Buffer.from("0000002a", "hex"),
          Buffer.from("hello"),
          null,
          Buffer.from([1]),
          Buffer.from("3ff8000000000000", "hex"),
        ],
        resultFormats: [],
      }),
      pgExecute(),
      pgSync(),
    ];
    await sql.unsafe(query, [42, "hello", null, true, 1.5]);
    expect(drain()).toEqual(hex(batch));
    // The unnamed statement is never reused: every execution sends the whole batch.
    await sql.unsafe(query, [42, "hello", null, true, 1.5]);
    expect(drain()).toEqual(hex(batch));
  });

  test("a Date and a plain object have one text form: one batch", async () => {
    const query = `select $1, $2 /* params=${OID.timestamptz},${OID.jsonb} cols=${OID.text} */`;
    await sql.unsafe(query, [date, { a: 1 }]);
    expect(drain()).toEqual(
      hex([
        pgParse("", query, [0, 0]),
        pgDescribe("S", ""),
        pgBind({
          statement: "",
          paramFormats: [0, 0],
          params: [Buffer.from("2000-01-01T00:00:01.000Z"), Buffer.from('{"a":1}')],
          resultFormats: [],
        }),
        pgExecute(),
        pgSync(),
      ]),
    );
  });

  // Each phase ends in a Sync, so a pooler in transaction mode can route them apart.
  test.each<[string, unknown, number, string]>([
    ["an array", [1, 2], OID.int4_array, '{"1","2"}'],
    ["an array", [1, 2], OID.jsonb, "[1,2]"],
    ["an Int32Array", new Int32Array([1, 2]), OID.int4_array, '{"1","2"}'],
    ["an object with toString", { toString: () => "1.50" }, OID.numeric, "1.50"],
    ["an object with toString", { toString: () => "1.50" }, OID.jsonb, "{}"],
  ])("%s asks the server for the types first (%#)", async (_, value, described, text) => {
    const query = `select $1, $2 /* params=${described},${OID.int4} cols=${OID.int4} */`;
    await sql.unsafe(query, [value, 7]);
    expect(drain()).toEqual(
      hex([
        pgParse("", query, [0, OID.int4]),
        pgDescribe("S", ""),
        pgSync(),
        pgParse("", query, [0, OID.int4]),
        pgBind({
          statement: "",
          paramFormats: [0, 1],
          params: [Buffer.from(text), Buffer.from("00000007", "hex")],
          // Text, as in the one batch of every other query without a named statement.
          resultFormats: [],
        }),
        pgExecute(),
        pgSync(),
      ]),
    );
  });

  test("no parameters: one batch", async () => {
    const query = "select 1 /* params= cols=25 */";
    await sql`select 1 /* params= cols=25 */`;
    expect(drain()).toEqual(
      hex([
        pgParse("", query),
        pgDescribe("S", ""),
        pgBind({ statement: "", paramFormats: [], params: [], resultFormats: [] }),
        pgExecute(),
        pgSync(),
      ]),
    );
  });
});

// A statement without parameters is prepared at its ParseComplete, so the same query can be bound again before the
// RowDescription says which columns can be binary.
describe("a Bind that is written before the RowDescription of its statement", () => {
  /** Like PostgreSQL, sends the column in the format that the Bind asked for. */
  async function int4Server(holdAfterParseComplete: boolean) {
    const resultFormats: number[][] = [];
    const server = await pgMockServer((type, body) => {
      switch (type) {
        case "P":
          return holdAfterParseComplete ? [pgParseComplete(), pgHold] : pgParseComplete();
        case "D":
          return [pgParameterDescription([]), pgRowDescription([{ name: "n", typeOid: OID.int4 }])];
        case "B":
          resultFormats.push(pgDecodeBind(body).resultFormats);
          return pgBindComplete();
        case "E":
          return [
            pgDataRow([resultFormats.at(-1)![0] === 1 ? pgInt32(1234) : Buffer.from("1234")]),
            pgCommandComplete("SELECT 1"),
          ];
        case "S":
          return pgReadyForQuery();
      }
    });
    return { ...server, resultFormats };
  }

  // execute() sends a query at once.
  test.each([
    ["objects", (query: SQL.Query<any>) => query.execute(), [{ n: 1234 }]],
    ["values()", (query: SQL.Query<any>) => query.values().execute(), [[1234]]],
    // The Bind is written for raw(). The mode is read again at each row.
    ["raw(), then values()", (query: SQL.Query<any>) => query.raw().execute().values(), [[1234]]],
  ])("asks for text and reads text: %s", async (_, start, rows) => {
    const server = await int4Server(true);
    try {
      await using sql = new SQL({ url: `postgres://u@127.0.0.1:${server.port}/db`, max: 1 });
      const run = () => start(sql`select 1234 as n`);
      const first = run();
      await server.held();
      const second = run();
      server.release();

      expect({
        rows: [...(await Promise.all([first, second])), await run()],
        resultFormats: server.resultFormats,
      }).toEqual({
        rows: [rows, rows, rows],
        // The third one knows the column.
        resultFormats: [[], [], [1]],
      });
    } finally {
      server.server.close();
    }
  });

  test("asks for text and reads text: started by the column transform", async () => {
    const server = await int4Server(false);
    try {
      let nested: PromiseLike<unknown> | undefined;
      await using sql: SQL = new SQL({
        url: `postgres://u@127.0.0.1:${server.port}/db`,
        max: 1,
        transform: {
          // Runs while the RowDescription is read.
          column: name => {
            nested ??= run();
            return name;
          },
        },
      });
      const run = () => sql`select 1234 as n`.execute();

      expect({ rows: [await run(), await nested], resultFormats: server.resultFormats }).toEqual({
        rows: [[{ n: 1234 }], [{ n: 1234 }]],
        resultFormats: [[], []],
      });
    } finally {
      server.server.close();
    }
  });
});
