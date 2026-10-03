// A parameter's conversion (toString, toJSON, a getter) runs while its Bind is encoded, and it can
// start another query on the same connection with execute(). That query must only be queued:
// the connection writes it after the request being encoded, and each query gets its own reply.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-dispatch-during-bind-fixture.ts");
const wireFixture = path.join(import.meta.dir, "postgres-dispatch-during-bind-wire-fixture.ts");

// Every test starts a subprocess. On a loaded machine a debug build took 15 s to run one.
// A fixture that hangs stops itself at 45 s, so the test reports what the fixture printed.
const timeout = 60_000;

const ok = (...rows: object[]) => ({ ok: rows });
const closed = { err: "ERR_POSTGRES_CONNECTION_CLOSED" };
const afterwards = ok({ ok: 1 });

// One subprocess runs one group, each scenario on a new connection.
// `conversions`: one per Bind. A request that is encoded twice converts its parameter twice.
const groups: Record<string, Record<string, object>> = {
  "first execution": {
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
  },
  "prepared statement": {
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
  },
  "a query started by drainMicrotasks() or notify()": {
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
  },
  "the conversion throws, other cases": {
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
  // The conversion runs the event loop, and the reply of a request in flight is handled in it.
  "a reply comes in during the conversion": {
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
  },
  "the conversion waits for a request in the write buffer": {
    "prepared statement, the conversion waits for a request that is not sent yet": {
      ahead: ok({ x: "ahead" }),
      later: ok({ x: "later" }),
      outer: ok({ x: "1" }),
      dispatched: [],
      conversions: 1,
      sameBackend: true,
    },
  },
  "replies come in while advance() encodes": {
    "a request that advance() encodes, two replies come in during the conversion": {
      first: ok({ x: "first" }),
      blocked: ok({ pg_advisory_xact_lock: "", x: "blocked" }),
      outer: ok({ x: "outer" }),
      nested: ok({ x: "nested" }),
      later: ok({ x: "later" }),
      repliesDuringConversion: true,
      conversions: 2,
      sameBackend: true,
    },
  },
  "a termination stops the conversion": {
    "prepared statement, node:vm timeout stops the conversion after it dispatched": {
      thrown: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      outer: { err: "ERR_POSTGRES_INVALID_QUERY_BINDING" },
      dispatched: [ok({ y: "2" })],
      conversions: 1,
      sameBackend: true,
    },
    "prepare: false, node:vm timeout stops the conversion after it dispatched": {
      thrown: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      outer: { err: "ERR_POSTGRES_INVALID_QUERY_BINDING" },
      dispatched: [ok({ y: "2" })],
      conversions: 1,
      sameBackend: true,
    },
    "prepared statement, conversion throws after dispatching a query whose conversion does not return": {
      thrown: null,
      outer: { err: "boom" },
      dispatched: [ok({ y: "2" })],
      conversions: 2,
      sameBackend: true,
    },
    "prepare: false, conversion throws after dispatching a query whose conversion does not return": {
      thrown: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      outer: { err: "boom" },
      dispatched: [{ err: "ERR_POSTGRES_INVALID_QUERY_BINDING" }],
      conversions: 2,
      sameBackend: true,
    },
  },
  // close() rejects every request of the connection. The pool then opens a new connection.
  // These groups do not close their pools: a request left on a connection keeps the process alive.
  "close() from a conversion": {
    "close() from a conversion, first execution": { outer: closed, afterwards },
    "close() from a conversion, prepared statement": { outer: closed, afterwards },
    "close() from a conversion, prepare: false": { outer: closed, afterwards },
  },
  "close() from a conversion, a request ahead": {
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
  },
  "close() from a getter of the values": {
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

  test.concurrent.each(Object.entries(groups))(
    "%s",
    async (_, expected) => {
      await container.ready;
      await run(fixture, expected, { DATABASE_URL: url() });
    },
    timeout,
  );

  // Neither query sends a byte, so no reply comes back to release the event loop ref of the nested query.
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
    timeout,
  );
});

// The mock answers each Execute with the parameter of the Bind before it. B(x) is a Bind that
// carries exactly the parameter x: a Bind with another query's messages inside does not decode.
const wire = (nested: string, ...frames: string[]) => ({
  outer: ok({ v: "outer" }),
  nested: ok({ v: nested }),
  frames,
});
const nestedBind = ["B(nested)", "E", "H", "S"];

test.concurrent(
  "wire order equals queue order: prepared statement",
  async () => {
    await run(wireFixture, {
      "prepared statement": wire("nested", "B(outer)", "E", "H", "S", ...nestedBind),
      "prepared statement, nested query without parameters": wire(
        "",
        ...["B(outer)", "E", "H", "S", "P", "D", "B()", "E", "H", "S"],
      ),
      "prepared statement, nested simple query": wire("simple", "B(outer)", "E", "H", "S", "Q", "H"),
    });
  },
  timeout,
);

test.concurrent(
  "wire order equals queue order: advance() encodes",
  async () => {
    await run(wireFixture, {
      "first execution": wire("nested", "P", "D", "S", "B(outer)", "E", "H", "S", ...nestedBind),
      "prepare: false": wire("nested", "P", "D", "B(outer)", "E", "H", "S", "P", "D", ...nestedBind),
    });
  },
  timeout,
);
