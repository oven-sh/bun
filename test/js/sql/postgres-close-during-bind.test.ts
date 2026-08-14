// Encoding a Bind message converts each parameter through user JS (valueOf /
// toString / toJSON), and that JS can close the connection the query is being
// encoded for (reserved.close()). close() rejected and dequeued every request
// and freed the write buffer while the encoder was still in the middle of the
// Bind, holding offsets into that buffer for the length prefixes it patches in
// afterwards. When the conversion hook returned, the encoder appended to the
// emptied buffer and patched at the stale offset:
//
//   panic: range start index 42 out of range for slice of length 4
//   (Writer::pwrite, PostgresSQLConnection.rs; on the first execution of a
//   statement, debug builds trip "pending_requests underflow" in
//   clean_up_requests first, because advance() had already taken the request
//   being encoded out of that counter)
//
// Now close() leaves the buffer to the encoder, whose caller releases it and
// fails the request with ERR_POSTGRES_CONNECTION_CLOSED instead of recording
// it as written on the dead connection. Each scenario runs in a subprocess and
// reports how every query settled; before the fix the subprocess aborts, and a
// request left behind on the dead connection would keep it alive until the
// test times out.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

const fixture = path.join(import.meta.dir, "postgres-close-during-bind-fixture.ts");

const closed = { err: "ERR_POSTGRES_CONNECTION_CLOSED" };
const afterwards = { ok: [{ ok: 1 }] };

const scenarios: Record<string, unknown> = {
  "first execution": { outer: closed, closedFrom: "valueOf", afterwards },
  "first execution, request queued ahead": {
    ahead: closed,
    outer: closed,
    aheadConverted: true,
    closedFrom: "valueOf",
    afterwards,
  },
  "prepared statement": { outer: closed, closedFrom: "valueOf", afterwards },
  "prepared statement, request buffered ahead": {
    ahead: closed,
    outer: closed,
    aheadConverted: true,
    closedFrom: "valueOf",
    afterwards,
  },
  "unnamed statement (prepare: false)": { outer: closed, closedFrom: "toString", afterwards },
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
