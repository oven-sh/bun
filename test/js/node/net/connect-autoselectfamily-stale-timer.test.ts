// https://github.com/oven-sh/bun/issues/25633
//
// node:net's autoSelectFamily path arms a per-attempt timer with the current
// `self._handle`. When an address fails synchronously at the connect()
// syscall, Bun's native layer dispatches the connectError handler *inside*
// kConnectTcp. That recurses through afterConnectMultiple →
// internalConnectMultiple for every remaining address and, once exhausted,
// destroys the socket (nulling `_handle`) before unwinding. The outer frame
// then resumed and armed its timer with `self._handle` === null, and the
// timer's `handle.close()` threw `TypeError: null is not an object`.
//
// A separate path leaves the same timer armed after a user destroy() while an
// attempt is in flight, since Socket._destroy can't reach the per-context
// timer.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";
import { join } from "node:path";

async function run(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", join(import.meta.dir, fixture)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The synchronous connect() rejection for Class E that drives the recursion
// is a macOS kernel behavior; other platforms route or black-hole it.
test.concurrent.skipIf(!isMacOS)(
  "autoSelectFamily: synchronously-failing addresses do not arm a stale per-attempt timer",
  async () => {
    const { stdout, stderr, exitCode } = await run("connect-autoselectfamily-sync-fail-fixture.js");
    expect(stderr).not.toContain("UNCAUGHT");
    expect(stderr).not.toContain("null is not an object");
    expect(stdout).toContain("OK");
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "autoSelectFamily: destroy() while an attempt is pending does not leave the per-attempt timer to fire",
  async () => {
    const { stdout, stderr, exitCode } = await run("connect-autoselectfamily-destroy-fixture.js");
    expect(stderr).not.toContain("UNCAUGHT");
    expect(stderr).not.toContain("null is not an object");
    expect(stdout).toContain("OK");
    expect(exitCode).toBe(0);
  },
);
