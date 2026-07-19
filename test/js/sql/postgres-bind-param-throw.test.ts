// write_bind() used to interleave JS evaluation (QueryBindingIterator.next,
// coerce<i32> / to_number / BunString::from_js / json_stringify_fast, all of
// which can run user getters, valueOf/toString, toJSON or Proxy traps) with
// writer.write() calls into the connection's write_buffer. A throw mid-bind
// left a half-written Bind in the buffer (the message length is backfilled
// last, so the partial frame declares length 0), and the next query on the
// same connection was appended after that garbage: protocol desync.
//
// Fault-injection test: requires a server that frames strictly by the
// client-declared length so a partial Bind is observable. Wire bytes come from
// test/js/sql/wire-frames.ts; do not inline frame construction here.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-bind-param-throw-fixture.ts");

test("postgres: a throwing parameter conversion leaves no partial Bind in the write buffer", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr: stderr.trim(), stdout: stdout.trim().replace(/"frames":"[^"]*"/, '"frames":"<elided>"') }).toEqual({
    stderr: "",
    stdout: `ok {"warm":"1","thrown":"boom-valueOf","after":"9","partial":false,"bindsServed":2,"binds":[1,9],"frames":"<elided>"}`,
  });
  expect(exitCode).toBe(0);
});

// End-to-end against a real server: the throwing bind rejects with the user's
// error and the connection remains usable. One round-trip per path that
// re-enters JS during conversion (coerce<i32> valueOf, to_number valueOf,
// BunString::from_js toString, json_stringify_fast toJSON).
describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  async function rejection(q: Promise<unknown>): Promise<unknown> {
    try {
      await q;
    } catch (e) {
      return e;
    }
    throw new Error("expected the query to reject");
  }

  test.each([
    ["int4 valueOf", "int", { valueOf: () => { throw new Error("boom"); } }, 1, 5],
    ["float8 valueOf", "float8", { valueOf: () => { throw new Error("boom"); } }, 1, 5],
    ["text toString", "text", { toString: () => { throw new Error("boom"); }, toJSON: undefined }, "a", "e"],
    ["json toJSON", "json", { toJSON: () => { throw new Error("boom"); } }, { x: 1 }, { y: 2 }],
  ] as const)("a throwing %s during bind does not desync the connection", async (_label, cast, boom, before, after) => {
    await container.ready;
    await using sql = new Bun.SQL({ url: url(), max: 1, idleTimeout: 30 });

    // prettier-ignore
    const go = (a: unknown, b: unknown) =>
      cast === "int" ? sql`SELECT ${a}::int AS v, ${b}::int AS w`
      : cast === "float8" ? sql`SELECT ${a}::float8 AS v, ${b}::float8 AS w`
      : cast === "text" ? sql`SELECT ${a}::text AS v, ${b}::text AS w`
      : sql`SELECT ${a}::json AS v, ${b}::json AS w`;

    expect((await go(before, before))[0].v).toEqual(before);
    expect(((await rejection(go(before, boom))) as Error).message).toContain("boom");
    expect((await go(after, after))[0].v).toEqual(after);
  });
});
