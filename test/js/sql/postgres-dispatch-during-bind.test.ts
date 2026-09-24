// A parameter's conversion (toString, toJSON, a getter) runs while its Bind is encoded, and it can
// start another query on the same connection with execute(). That query must only be queued:
// the connection writes it after the request being encoded, and each query gets its own reply.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-dispatch-during-bind-fixture.ts");
const wireFixture = path.join(import.meta.dir, "postgres-dispatch-during-bind-wire-fixture.ts");

const ok = (...rows: object[]) => ({ ok: rows });
const closed = { err: "ERR_POSTGRES_CONNECTION_CLOSED" };

// `conversions`: one per Bind. A request that is encoded twice converts its parameter twice.
const scenarios: [string, object][] = [
  [
    "first execution, nested new statement",
    { outer: ok({ x: "1" }), dispatched: [ok({ y: 2 })], conversions: 1, sameBackend: true },
  ],
  [
    "first execution, nested prepared statement",
    { outer: ok({ x: "1" }), dispatched: [ok({ t: "nested" })], conversions: 1, sameBackend: true },
  ],
  [
    "prepared statement, nested new statement",
    { outer: ok({ x: "1" }), dispatched: [ok({ y: 2 })], conversions: 1, sameBackend: true },
  ],
  [
    "prepared statement, nested same statement",
    { outer: ok({ x: "1" }), dispatched: [ok({ x: "2" })], conversions: 1, sameBackend: true },
  ],
  [
    "prepared statement, nested burst",
    {
      outer: ok({ x: "1" }),
      dispatched: [ok({ t: "a" }), ok({ x: "2" }), ok({ y: 3 }), ok({ s: "simple" }), ok({ t: "b" })],
      conversions: 1,
      sameBackend: true,
    },
  ],
  [
    "nested query dispatches again from its own bind",
    { outer: ok({ x: "1" }), dispatched: [ok({ x: "2" }), ok({ x: "3" })], conversions: 3, sameBackend: true },
  ],
  ["inside a transaction", { rows: { ok: [[{ x: "1" }], [{ y: 2 }]] }, conversions: 1 }],
  [
    "prepare: false",
    { outer: ok({ x: "1" }), dispatched: [ok({ y: 2 }), ok({ t: "nested" })], conversions: 1, sameBackend: true },
  ],
  [
    "prepared statement, nested query started by drainMicrotasks()",
    { outer: ok({ x: "1" }), dispatched: [ok({ y: 2 })], conversions: 1, sameBackend: true },
  ],
  [
    "prepared statement, nested notify()",
    { outer: ok({ x: "1" }), dispatched: [ok({ pg_notify: "" })], conversions: 1, sameBackend: true },
  ],
  [
    "first execution, conversion throws after dispatching",
    { outer: { err: "boom" }, dispatched: [ok({ y: 2 })], conversions: 1, sameBackend: true },
  ],
  [
    "prepared statement, conversion throws after dispatching",
    { outer: { err: "boom" }, dispatched: [ok({ y: 2 })], conversions: 1, sameBackend: true },
  ],
  [
    "prepare: false, conversion throws after dispatching",
    { outer: { err: "boom" }, dispatched: [ok({ y: 2 })], conversions: 1, sameBackend: true },
  ],
  [
    "prepared statement behind an in-flight query, conversion throws after dispatching",
    { ahead: ok({ x: "7" }), outer: { err: "boom" }, dispatched: [ok({ y: 2 })], conversions: 1, sameBackend: true },
  ],
  // close() rejects every request of the connection. The pool then opens a new connection.
  ["close() from a conversion, first execution", { outer: closed, afterwards: ok({ ok: 1 }) }],
  ["close() from a conversion, request queued ahead", { ahead: closed, outer: closed, afterwards: ok({ ok: 1 }) }],
  ["close() from a conversion, prepared statement", { outer: closed, afterwards: ok({ ok: 1 }) }],
  ["close() from a conversion, request buffered ahead", { ahead: closed, outer: closed, afterwards: ok({ ok: 1 }) }],
  ["close() from a conversion, prepare: false", { outer: closed, afterwards: ok({ ok: 1 }) }],
];

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test.concurrent.each(scenarios)("%s", async (scenario, expected) => {
    await container.ready;
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: {
        ...bunEnv,
        SCENARIO: scenario,
        DATABASE_URL: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is here so that a failure shows it. A sanitizer build can write to it.
    expect({ report: stdout.trim() && JSON.parse(stdout), stderr, exitCode }).toEqual({
      report: expected,
      stderr: expect.any(String),
      exitCode: 0,
    });
  });

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
        env: { ...bunEnv, DATABASE_URL: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test` },
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
const nested = ["B(nested)", "E", "H", "S"];
const wire: [string, string, string[]][] = [
  ["prepared statement", "nested", ["B(outer)", "E", "H", "S", ...nested]],
  [
    "prepared statement, nested query without parameters",
    "",
    ["B(outer)", "E", "H", "S", "P", "D", "B()", "E", "H", "S"],
  ],
  ["first execution", "nested", ["P", "D", "S", "B(outer)", "E", "H", "S", ...nested]],
  ["prepare: false", "nested", ["P", "D", "B(outer)", "E", "H", "S", "P", "D", ...nested]],
];

test.concurrent.each(wire)("wire order equals queue order: %s", async (scenario, nestedValue, frames) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), wireFixture],
    env: { ...bunEnv, SCENARIO: scenario },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ report: stdout.trim() && JSON.parse(stdout), stderr, exitCode }).toEqual({
    report: { outer: ok({ v: "outer" }), nested: ok({ v: nestedValue }), frames },
    stderr: expect.any(String),
    exitCode: 0,
  });
});
