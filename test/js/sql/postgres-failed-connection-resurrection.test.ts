// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// A backend message that fails the connection can share a read with messages
// that follow it. The message loop used to keep dispatching those trailing
// messages against the already-failed connection; a ReadyForQuery in that
// position flipped the status back to Connected and re-armed the idle timer
// on a socket uSockets had already scheduled to free, so the timer callback
// later read freed memory:
//   AddressSanitizer: heap-use-after-free in us_socket_is_closed
//     PostgresSQLConnection::ref_and_close <- fail_with_js_value
//     <- fail_fmt <- on_connection_timeout
// The read of freed memory is only detectable under ASan, so this is gated to
// ASan builds; release lanes would pass regardless of the bug.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import path from "node:path";

test.skipIf(!isASAN)(
  "a failed connection is not resurrected by trailing messages in the same read",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "postgres-failed-connection-resurrection.fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 25_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout: stdout.trim().split(/\r?\n/),
      exitCode,
      // not asserted (ASan/debug builds emit benign notes); included so the
      // ASan report shows up in the diff when the fixture dies
      stderr,
    }).toEqual({
      stdout: ["ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD", "SURVIVED"],
      exitCode: 0,
      stderr: expect.any(String),
    });
  },
  // the fixture is a debug+ASan bun that intentionally outlives a 1s timer
  30_000,
);
