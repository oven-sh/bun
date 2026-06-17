// PostgresSQLQuery.do_run refs the connection's poll_ref KeepAlive. KeepAlive
// is a two-state flag, not a counter, so when this query is the only in-flight
// work the call flips Inactive -> Active. When do_run then returns early with
// a synchronous error (bad binding, signature-generation failure, OOM during
// enqueue, ...) the poll_ref must not be left Active: nothing else on the
// connection will touch it until the next server message, so the event loop
// stays pinned and the process never exits.
//
// The fixture connects to a real Postgres, lets the connection go idle, then
// issues a query whose binding is rejected synchronously before anything is
// written. It must print the rejection and exit on its own.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer } from "harness";
import path from "node:path";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("postgres: synchronous do_run failure does not pin the event loop", async () => {
    await container.ready;
    const url = `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "sql-postgres-run-error-pollref-fixture.ts")],
      env: { ...bunEnv, DATABASE_URL: url },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    void stderr;

    expect(stdout).toBe("rejected:ERR_INVALID_ARG_TYPE\n");
    // exited on its own, not killed by the runner's timeout
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});
