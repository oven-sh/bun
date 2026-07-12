// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Invariant: after ErrorResponse rejects the current request it stays queued
// until ReadyForQuery; DataRow / CommandComplete / EmptyQueryResponse /
// CloseComplete arriving in that window must be consumed and discarded, never
// routed to the released request.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// the fixture is a debug+ASan subprocess; allow headroom for its startup
test("postgres: DataRow arriving after ErrorResponse is discarded, not routed to the rejected query", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "postgres-error-then-datarow.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 25_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.trim().split(/\r?\n/),
    exitCode,
    signalCode: proc.signalCode,
    // not asserted (ASan/debug builds emit benign notes); included so the
    // panic/ASan report shows up in the diff when the fixture dies
    stderr,
  }).toEqual({
    stdout: ["FIRST ERR_POSTGRES_SERVER_ERROR", 'SECOND [{"b":"ok"}]'],
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
}, 30_000);
