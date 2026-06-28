import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tls } from "harness";
import { join } from "node:path";

// See socket-syscall-fault-fixture.ts for the full write-up. Summary: an
// accepted TLS socket already parked in uSockets' low-priority handshake
// queue (low_prio_state == 1) could be dispatched READABLE again and re-run
// the park, which unlinked it from group->head_sockets using its
// low_prio_head links. head_sockets and low_prio_head got cross-spliced and
// a later close freed the socket while still reachable from both, so the
// timer sweep, the low-priority walk, and neighbouring link/unlink all
// touched freed memory. Only ASan (plus the usockets debug asserts) turns
// that into a hard failure, hence the isASAN gate; the fault injector is
// compiled in for ASan builds.
const skip = !fault.available() || !isASAN;

test.skipIf(skip)(
  "TLS accept: a parked low-priority handshake socket is not unlinked from the group list",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "socket-syscall-fault-fixture.ts")],
      env: { ...bunEnv, TLS_PEM: JSON.stringify({ key: tls.key, cert: tls.cert }) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Keep only the first sanitizer / assertion line so a failure diff shows
    // the actual report instead of an opaque non-zero exit code.
    const crash = stderr.match(/ERROR: \w*Sanitizer: [^\n]*|Assertion `[^\n]*/)?.[0] ?? "";
    expect({ crash, result: stdout.trim().split("\n").at(-1), exitCode, signal: proc.signalCode }).toEqual({
      crash: "",
      result: expect.stringContaining('"ok":true'),
      exitCode: 0,
      signal: null,
    });
  },
  120_000,
);
