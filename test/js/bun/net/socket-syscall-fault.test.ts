import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

const skip = !fault.available() || isWindows;

// uSockets' TLS low-priority handshake queue (loop->data.low_prio_head)
// shares its prev/next links with group->head_sockets. A socket already
// parked in the queue used to be parked a SECOND time whenever a writable
// dispatch re-enabled its readable poll bit (a backpressured handshake
// flight retry does that), running us_internal_socket_group_unlink_socket on
// low-prio-queue links and cross-wiring the two lists. In debug/ASAN builds
// the double-incremented low_prio_count trips the group-deinit assertion; in
// release builds freed sockets stay reachable from both lists
// (heap-use-after-free in us_internal_socket_group_unlink_socket /
// us_internal_handle_low_priority_sockets).
//
// The explicit timeout is required: a bare `bun bd test <file>` applies Bun's
// 5000ms default, and this fixture spawns two Bun processes and has to hold
// 32 concurrent TLS handshakes across several event-loop ticks, which takes
// ~25s on a debug+ASAN build. 180s keeps comfortable headroom over the
// CI runner's ASAN per-test budget instead of capping below it.
test.skipIf(skip)(
  "TLS low-prio queue: a parked socket whose readable poll is re-enabled is not parked twice",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-low-prio-queue-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `stderrTail` is only populated when the fixture did not exit cleanly, so
    // the abort/assertion message shows up in the failure diff.
    expect({
      stdout: stdout.trim(),
      signalCode: proc.signalCode,
      exitCode,
      stderrTail: exitCode === 0 ? "" : stderr.slice(-2000),
    }).toEqual({ stdout: "OK", signalCode: null, exitCode: 0, stderrTail: "" });
  },
  180_000,
);
