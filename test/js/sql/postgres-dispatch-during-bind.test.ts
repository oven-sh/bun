// Encoding a Bind message converts each parameter through user JS (valueOf /
// toString / toJSON), and that JS can synchronously dispatch another query on
// the same connection: with max: 1 (or inside a transaction) the pool hands it
// the connection whose write buffer currently ends in the half-encoded Bind.
//
// The nested dispatch used to either write its own messages into the middle of
// that Bind, or re-enter advance(), which bound the still-Pending outer request
// a second time and then flushed the buffer out from under the outer encoder,
// whose length prefix was an offset into it:
//
//   panic: range start index 42 out of range for slice of length 4
//   (Writer::pwrite, PostgresSQLConnection.rs; debug builds trip
//   "pending_requests underflow" first)
//
// For an already-prepared statement the Bind is written at enqueue time instead,
// and the nested query's frames and queue entry both ended up ahead of the
// outer's half-written Bind, so the server's error for the torn message was
// delivered to the nested query and the outer one never settled.
//
// Now a dispatch that lands inside an encoder only enqueues, and whoever is
// encoding drains the queue afterwards. Each scenario runs in a subprocess and
// reports what every query settled with and how many times the outer parameter
// was converted (one conversion per query is the observable form of one Bind
// per request); a broken scenario shows up as a panic in the subprocess's
// stderr or, for the wedged-connection shapes, as the test timing out.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-dispatch-during-bind-fixture.ts");

const scenarios: Record<string, unknown> = {
  "first execution, nested new statement": {
    outer: { ok: [{ x: 1 }] },
    dispatched: [{ ok: [{ y: 2 }] }],
    conversions: 1,
  },
  "first execution, nested prepared statement": {
    outer: { ok: [{ x: 1 }] },
    dispatched: [{ ok: [{ t: "nested" }] }],
    conversions: 1,
  },
  "prepared statement, nested new statement": {
    outer: { ok: [{ x: 1 }] },
    dispatched: [{ ok: [{ y: 2 }] }],
    conversions: 1,
  },
  "prepared statement, nested same statement": {
    outer: { ok: [{ x: 1 }] },
    dispatched: [{ ok: [{ x: 2 }] }],
    conversions: 1,
  },
  "prepared statement, nested burst": {
    outer: { ok: [{ x: 1 }] },
    dispatched: [
      { ok: [{ t: "a" }] },
      { ok: [{ x: 2 }] },
      { ok: [{ y: 3 }] },
      { ok: [{ s: "simple" }] },
      { ok: [{ t: "b" }] },
    ],
    conversions: 1,
  },
  "nested query dispatches again from its own bind": {
    outer: { ok: [{ x: 1 }] },
    dispatched: [{ ok: [{ x: 2 }] }, { ok: [{ x: 3 }] }],
    conversions: 3,
  },
  "inside a transaction": {
    rows: { ok: [[{ x: 1 }], [{ y: 2 }]] },
    conversions: 1,
  },
  "unnamed statements (prepare: false)": {
    outer: { ok: [{ x: 1 }] },
    dispatched: [{ ok: [{ y: 2 }] }, { ok: [{ t: "nested" }] }],
    conversions: 1,
  },
  "prepared statement, conversion throws after dispatching": {
    outer: { err: "boom" },
    dispatchedSettled: 1,
    afterwards: { ok: [{ z: 3 }] },
    conversions: 1,
  },
};

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  for (const [scenario, expected] of Object.entries(scenarios)) {
    test.concurrent(scenario, async () => {
      await container.ready;
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: {
          ...bunEnv,
          DATABASE_URL: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
          SCENARIO: scenario,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      let result: unknown = stdout;
      try {
        result = JSON.parse(stdout);
      } catch {}
      expect({ result, exitCode, stderr }).toEqual({
        result: expected,
        exitCode: 0,
        // not asserted; included so a panic trace shows up in the diff
        stderr: expect.any(String),
      });
    });
  }
});
