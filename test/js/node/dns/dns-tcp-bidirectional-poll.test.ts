// c-ares opens a TCP socket when the UDP response has TC=1. At
// ares_open_connection() it reports (readable=1, writable=1) for that fd via
// the sock_state_cb so it learns when the nonblocking connect() completes.
// onDNSSocketState registers both directions on one FilePoll; before the fix,
// unregisterWithFd asserted !(poll_readable && poll_writable) and crashed the
// debug build, and on epoll the second register()'s CTL_MOD silently dropped
// the first direction's mask so the response was never read.
//
// The server and resolver run together in a subprocess: the assertion aborts
// the whole process, and the busy-loop on EPOLLOUT (pre-fix) would otherwise
// starve the test runner.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

test.skipIf(isWindows)(
  "c-ares TCP DNS fd registers readable+writable on one FilePoll without asserting",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "dns-tcp-bidirectional-poll-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.trim()).toBe("");
    expect(stdout.trim()).toBe('[["hello"]]');
    expect(exitCode).toBe(0);
  },
);
