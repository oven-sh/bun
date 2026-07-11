// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// An ErrorResponse rejects the current query and drops its GC protection, but
// the request stays at the head of the connection's queue until ReadyForQuery
// closes the exchange. A DataRow (or CommandComplete / EmptyQueryResponse /
// CloseComplete) arriving in that window was routed to the released query;
// after a GC that collected the JS wrapper this hit
//   debug_assert!(false, "query value was freed earlier than expected")
// on debug builds and, on release, returned ExpectedRequest which tore down
// the connection. Messages for an already-failed request must be consumed and
// discarded so the connection stays usable.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

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
}, // panic handler before SIGABRT so the fail-before output is captured // the fixture is a debug+ASan bun; the unpatched build spends ~10s in the
30_000);
