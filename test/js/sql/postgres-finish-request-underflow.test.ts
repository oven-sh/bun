// https://github.com/oven-sh/bun/issues/32004
//
// PostgresSQLConnection::finish_request decremented the per-class in-flight
// counter (nonpipelinable_requests / pipelined_requests) from three call
// sites (ReadyForQuery, ErrorResponse, connection-close cleanup) with no
// per-request idempotence guard. Under connection-failure timing a request
// could be finished twice, driving the u32 past zero: a debug build panics
// with `attempt to subtract with overflow`; a release build silently wraps
// to u32::MAX, after which advance() treats the connection as permanently
// busy and queued queries never dispatch.
//
// The double-decrement reproduces under syscall fault injection on the
// Postgres socket but not from a scripted server alone (the known
// server-driven path was closed by the status==Fail skip in
// CommandComplete/DataRow). This test is a regression guard over the
// per-request `counted` bookkeeping: it drives one connection through every
// finish_request call site back-to-back and asserts a follow-up query still
// dispatches. A leaked-high or wrapped counter would wedge the follow-up
// query until the fixture's watchdog fires, and a violated counter invariant
// would trip the debug_assert in finish_request.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

test("postgres: per-class request counter is balanced across every finish_request call site", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "postgres-finish-request-underflow-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout: stdout.trim(),
    overflowPanic: /attempt to subtract with overflow|_requests underflow/.test(stderr),
    watchdog: /WATCHDOG/.test(stderr),
    exitCode,
    signalCode: proc.signalCode,
    // not asserted; included so a panic backtrace shows up in the diff
    stderr,
  }).toEqual({
    stdout: "DONE",
    overflowPanic: false,
    watchdog: false,
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
}, 30_000);
