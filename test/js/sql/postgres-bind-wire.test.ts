// Pins the exact frontend bytes of an extended-protocol query for each kind of
// parameter, so a change to the Bind encoder cannot change the wire by accident.
// A real server does not show what it received, so this uses a mock.
import { SQL } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import type { Socket } from "node:net";
import {
  pgBind,
  pgBindComplete,
  pgCommandComplete,
  pgDescribe,
  pgExecute,
  pgFlush,
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
  float8: 701,
  timestamptz: 1184,
  jsonb: 3802,
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
  ["null", null, OID.int4, 0, 1, null],
  ["boolean as bool", true, OID.bool, OID.bool, 1, Buffer.from([1])],
  ["integer as int4", 42, OID.int4, OID.int4, 1, Buffer.from("0000002a", "hex")],
  ["BigInt as int8", 123n, OID.int8, OID.int8, 0, Buffer.from("123")],
  ["double as float8", 1.5, OID.float8, OID.float8, 1, Buffer.from("3ff8000000000000", "hex")],
  // Microseconds since 2000-01-01T00:00:00Z.
  ["Date as timestamptz", date, OID.timestamptz, 0, 1, Buffer.from("00000000000f4240", "hex")],
  ["ASCII string as text", "hello", OID.text, 0, 0, Buffer.from("hello")],
  ["non-ASCII string as text", "h\u00e9llo \u2603", OID.text, 0, 0, Buffer.from("h\u00e9llo \u2603", "utf8")],
  ["object as jsonb", { a: 1 }, OID.jsonb, 0, 0, Buffer.from('{"a":1}')],
  ["array as json", [1, "x"], OID.json, 0, 0, Buffer.from('[1,"x"]')],
  ["Buffer as bytea", Buffer.from([1, 2, 3]), OID.bytea, OID.bytea, 1, Buffer.from([1, 2, 3])],
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
      hex([
        pgParse(statement, query, [declared]),
        pgDescribe("S", statement),
        pgSync(),
        bind,
        pgExecute(),
        pgFlush(),
        pgSync(),
      ]),
    );

    // The statement is prepared now: the next execution sends only the Bind batch.
    await sql.unsafe(query, [value]);
    expect(drain()).toEqual(hex([bind, pgExecute(), pgFlush(), pgSync()]));
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
          paramFormats: [1, 0, 1, 1],
          params: [Buffer.from("00000007", "hex"), Buffer.from("seven"), null, Buffer.from([0])],
          // One code per column once any column can be binary.
          resultFormats: [1, 0],
        }),
        pgExecute(),
        pgFlush(),
        pgSync(),
      ]),
    );
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
          paramFormats: [1, 0, 1],
          params: [Buffer.from("00000007", "hex"), Buffer.from("seven"), null],
          resultFormats: [],
        }),
        pgExecute(),
        pgFlush(),
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
        pgFlush(),
        pgSync(),
      ]),
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
      pgFlush(),
      pgSync(),
    ];
    await sql.unsafe(query, [42, "hello", null, true, 1.5]);
    expect(drain()).toEqual(hex(batch));
    // The unnamed statement is never reused: every execution sends the whole batch.
    await sql.unsafe(query, [42, "hello", null, true, 1.5]);
    expect(drain()).toEqual(hex(batch));
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
        pgFlush(),
        pgSync(),
      ]),
    );
  });
});
