// The conversion of a parameter (toString, toJSON) is user code. It can start another query on the same
// connection with execute(), close the connection, throw, or run the event loop.
// At the end: what a server sends out of place.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";
import {
  pgBindComplete,
  pgBindParameters,
  pgCloseComplete,
  pgCommandComplete,
  pgCopyData,
  pgCopyDone,
  pgCopyInResponse,
  pgCopyOutResponse,
  pgDataRow,
  pgErrorResponse,
  pgMockServer,
  pgNoData,
  pgParameterDescription,
  pgParseComplete,
  pgRaw,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

const fixture = path.join(import.meta.dir, "postgres-dispatch-fixture.ts");
const wireFixture = path.join(import.meta.dir, "postgres-dispatch-wire-fixture.ts");

const ok = (...rows: object[]) => ({ ok: rows });
const closed = { err: "ERR_POSTGRES_CONNECTION_CLOSED" };
const afterwards = ok({ ok: 1 });

// One subprocess runs one group, each scenario on a new connection.
// `conversions`: one per parameter. A request that is dispatched twice converts its parameter twice.
const groups: Record<string, Record<string, object>> = {
  "the conversion starts a query": {
    "first execution, nested new statement": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ y: 2 })],
      conversions: 1,
      sameBackend: true,
    },
    "first execution, nested prepared statement": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ t: "nested" })],
      conversions: 1,
      sameBackend: true,
    },
    "nested query dispatches again from its own bind": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ x: "2" }), ok({ x: "3" })],
      conversions: 3,
      sameBackend: true,
    },
    "inside a transaction": { rows: { ok: [[{ x: "1" }], [{ y: 2 }]] }, conversions: 1 },
    "prepared statement, nested new statement": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ y: 2 })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, nested same statement": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ x: "2" })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, nested simple query": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ s: "simple" })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, nested query started by drainMicrotasks()": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ y: 2 })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, nested notify()": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ pg_notify: "" })],
      conversions: 1,
      sameBackend: true,
    },
  },
  "queue order": {
    "prepared statement, nested burst": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ t: "a" }), ok({ x: "2" }), ok({ y: 3 }), ok({ s: "simple" }), ok({ t: "b" })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement behind two in-flight queries, nested burst": {
      ahead: [ok({ x: "7" }), ok({ t: "8" })],
      later: [ok({ x: "9" }), ok({ t: "10" })],
      outer: ok({ x: "1" }),
      dispatched: [ok({ t: "a" }), ok({ y: 3 }), ok({ x: "2" })],
      conversions: 1,
      sameBackend: true,
    },
    "prepare: false": {
      outer: ok({ x: "1" }),
      dispatched: [ok({ y: 2 }), ok({ t: "nested" })],
      conversions: 1,
      sameBackend: true,
    },
  },
  "the conversion throws": {
    "first execution, conversion throws after dispatching": {
      outer: { err: "boom" },
      dispatched: [ok({ y: 2 })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, conversion throws after dispatching": {
      outer: { err: "boom" },
      dispatched: [ok({ y: 2 })],
      conversions: 1,
      sameBackend: true,
    },
    "prepare: false, conversion throws after dispatching": {
      outer: { err: "boom" },
      dispatched: [ok({ y: 2 })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement behind an in-flight query, conversion throws after dispatching": {
      ahead: ok({ x: "7" }),
      outer: { err: "boom" },
      dispatched: [ok({ y: 2 })],
      conversions: 1,
      sameBackend: true,
    },
    "prepare: false, conversion throws a value that is not an Error": {
      thrown: [{ rejected: "undefined" }, { rejected: null }, { rejected: 0 }, { rejected: "text" }],
      sameBackend: true,
    },
  },
  "the conversion runs the event loop": {
    "prepared statement, a reply comes in during the conversion": {
      ahead: [ok({ pg_advisory_xact_lock: "", x: "ahead 0" })],
      later: ok({ x: "later" }),
      repliesDuringConversion: true,
      outer: ok({ x: "1" }),
      dispatched: [],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, two replies come in during the conversion": {
      ahead: [ok({ pg_advisory_xact_lock: "", x: "ahead 0" }), ok({ x: "ahead 1" })],
      later: ok({ x: "later" }),
      repliesDuringConversion: true,
      outer: ok({ x: "1" }),
      dispatched: [],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, the conversion waits for a request that is not sent yet": {
      ahead: ok({ x: "ahead" }),
      later: ok({ x: "later" }),
      outer: ok({ x: "1" }),
      dispatched: [],
      conversions: 1,
      sameBackend: true,
    },
    "requests written when a reply comes in, two replies come in during the conversion": {
      first: ok({ x: "first" }),
      blocked: ok({ pg_advisory_xact_lock: "", x: "blocked" }),
      second: ok({ x: "second" }),
      third: ok({ x: "third" }),
      later: ok({ x: "later" }),
      repliesDuringConversion: true,
      conversions: 1,
      sameBackend: true,
    },
  },
  "the conversion closes the connection": {
    "close() from a conversion, first execution": { outer: closed, afterwards },
    "close() from a conversion, prepared statement": { outer: closed, afterwards },
    "close() from a conversion, prepare: false": { outer: closed, afterwards },
    "close() from a conversion, request queued ahead": {
      ahead: closed,
      outer: closed,
      aheadConverted: true,
      afterwards,
    },
    "close() from a conversion, request buffered ahead": {
      ahead: closed,
      outer: closed,
      aheadConverted: true,
      afterwards,
    },
    "close() from a getter of the values, first execution": { outer: closed, afterwards },
    "close() from a getter of the values, prepared statement": { outer: closed, afterwards },
    "close() from a getter of the values, prepare: false": { outer: closed, afterwards },
  },
};

/** Runs `fixture` with the scenarios of `expected` and pairs each output line with its scenario. */
async function run(fixture: string, expected: Record<string, object>, env: Record<string, string> = {}) {
  const names = Object.keys(expected);
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: { ...bunEnv, ...env, SCENARIOS: JSON.stringify(names) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stdout.split("\n").filter(Boolean);
  const report = Object.fromEntries(names.map((name, i) => [name, lines[i] ? JSON.parse(lines[i]) : "no result"]));
  // stderr is here so that a failure shows it. A sanitizer build can write to it.
  expect({ report, stderr, exitCode }).toEqual({ report: expected, stderr: expect.any(String), exitCode: 0 });
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  test.concurrent.each(Object.entries(groups))("%s", async (_, expected) => {
    await container.ready;
    await run(fixture, expected, { DATABASE_URL: url() });
  });

  test.concurrent.each([true, false])(
    "a script exits on its own when the outer and the nested conversion both throw (prepare: %p)",
    async prepare => {
      await container.ready;
      const script = `
        const sql = new Bun.SQL({ url: process.env.DATABASE_URL, max: 1, prepare: ${prepare} });
        const text = value => ({ toString: () => value });
        await sql\`select \${text("warm")}::text as x\`;
        await sql\`select \${text("warm")}::text as y\`;
        // A later tick: the idle connection does not hold the process any more.
        await new Promise(resolve => setImmediate(resolve));
        const message = query => query.then(() => "resolved", e => e.message);
        let nested;
        const param = {
          toString() {
            const throws = { toString() { throw new Error("nested boom"); } };
            nested = message(sql\`select \${throws}::text as y\`.execute());
            throw new Error("outer boom");
          },
        };
        console.log(await message(sql\`select \${param}::text as x\`), await nested);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, DATABASE_URL: url() },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: "outer boom nested boom\n",
        stderr: expect.any(String),
        exitCode: 0,
      });
    },
  );
});

// The mock answers each Execute with the parameter of the Bind before it. B(x) is a Bind that
// carries exactly the parameter x: a Bind with another query's messages inside does not decode.
const wire = (nested: string, ...frames: string[]) => ({
  outer: ok({ v: "outer" }),
  nested: ok({ v: nested }),
  frames,
});
const nestedBind = ["B(nested)", "E", "S"];

test.concurrent("wire order equals queue order", async () => {
  await run(wireFixture, {
    "prepared statement": wire("nested", "B(outer)", "E", "S", ...nestedBind),
    "prepared statement, nested query without parameters": wire(
      "",
      ...["B(outer)", "E", "S", "P", "D", "B()", "E", "S"],
    ),
    "prepared statement, nested simple query": wire("simple", "B(outer)", "E", "S", "Q"),
    "first execution": wire("nested", "P", "D", "S", "B(outer)", "E", "S", ...nestedBind),
    // An object with a toString asks for the types first. A string does not.
    "prepare: false": wire("nested", "P", "D", "S", "P", "B(outer)", "E", "S", "P", "D", ...nestedBind),
  });
});

// A reply has no name on it: it goes to the request at the head of the queue. A broken server or proxy can send a
// message that cannot belong to that request. Whatever the client makes of it, every query settles and the next one runs.
describe("a message that is out of place", () => {
  /** Answers a Bind with its first parameter in the column `v`. Once, `stray` follows the answer to a Parse. */
  async function strayAfterParse(stray: Buffer[]) {
    let row: Buffer | null = null;
    const { port, server } = await pgMockServer((type, body) => {
      switch (type) {
        case "P":
          return [pgParseComplete(), ...stray.splice(0)];
        case "D":
          return [pgParameterDescription([25]), pgRowDescription([{ name: "v", typeOid: 25 }])];
        case "B":
          row = pgBindParameters(body)[0];
          return pgBindComplete();
        case "E":
          return [pgDataRow([row]), pgCommandComplete("SELECT 1")];
        case "S":
          return pgReadyForQuery();
      }
    });
    return { url: `postgres://u@127.0.0.1:${port}/db`, [Symbol.dispose]: () => void server.close() };
  }
  const settled = (query: PromiseLike<unknown[]>) =>
    query.then(
      rows => [...rows],
      e => e.errno ?? e.code,
    );
  const empty = Buffer.alloc(0);
  const violation = "ERR_POSTGRES_UNEXPECTED_MESSAGE";

  // Only Parse, Describe and Sync of the first query are written: nothing was executed.
  test.each([
    // A result. The connection fails and the pool dials again.
    ["CommandComplete", pgCommandComplete("SELECT 1"), violation],
    ["EmptyQueryResponse", pgRaw("I", empty), violation],
    ["DataRow", pgDataRow([Buffer.from("stray")]), violation],
    // The answer of a server that refuses the Parse.
    ["ErrorResponse", pgErrorResponse({ S: "ERROR", C: "22012", M: "division by zero" }), "22012"],
    ["CopyInResponse", pgCopyInResponse([0]), "ERR_POSTGRES_COPY_NOT_SUPPORTED"],
    ["CopyOutResponse", pgCopyOutResponse([0]), "ERR_POSTGRES_COPY_NOT_SUPPORTED"],
    // pgdog 0.1.60 sends a ReadyForQuery too many.
    ["ReadyForQuery", pgReadyForQuery(), [{ v: "a" }]],
    ["ParseComplete", pgParseComplete(), [{ v: "a" }]],
    ["ParameterDescription", pgParameterDescription([25]), [{ v: "a" }]],
    ["RowDescription", pgRowDescription([{ name: "v", typeOid: 25 }]), [{ v: "a" }]],
    ["NoData", pgNoData(), [{ v: "a" }]],
    ["BindComplete", pgBindComplete(), [{ v: "a" }]],
    ["CloseComplete", pgCloseComplete(), [{ v: "a" }]],
    ["PortalSuspended", pgRaw("s", empty), [{ v: "a" }]],
    ["CopyData", pgCopyData(Buffer.from("stray")), [{ v: "a" }]],
    ["CopyDone", pgCopyDone(), [{ v: "a" }]],
  ])("%s in the answer to Parse", async (_, stray, first) => {
    using server = await strayAfterParse([stray]);
    await using sql = new SQL(server.url, { max: 1 });
    expect([await settled(sql`select ${"a"} as v`), await settled(sql`select ${"b"} as v`)]).toEqual([
      first,
      [{ v: "b" }],
    ]);
  });

  test.each([
    ["behind a ReadyForQuery too many", [pgReadyForQuery(), pgCommandComplete("SELECT 1")], {}],
    ["with prepare: false", [pgCommandComplete("SELECT 1")], { prepare: false }],
  ])("CommandComplete in the answer to Parse, %s", async (_, stray, options) => {
    using server = await strayAfterParse(stray);
    await using sql = new SQL(server.url, { max: 1, ...options });
    // With prepare: false only a value like this one asks for the types first.
    const text = (v: string) => ({ toString: () => v });
    expect([await settled(sql`select ${text("a")} as v`), await settled(sql`select ${text("b")} as v`)]).toEqual([
      violation,
      [{ v: "b" }],
    ]);
  });
});
