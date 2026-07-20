// `bun run <script>` re-raises the child's terminating signal via
// `Global.raiseIgnoringPanicHandler`, which first resets the signal's
// disposition with `bun.sys.sigaction(sig, …)`. `SIGKILL`/`SIGSTOP` can't
// have their disposition changed, so libc returns `EINVAL` there — that
// must not reach `std.posix.sigaction`'s `else => unreachable`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";

test.skipIf(!isPosix)("bun run propagates SIGKILL from a child without hitting unreachable", async () => {
  using dir = tempDir("run-sigkill", {
    "package.json": JSON.stringify({
      name: "t",
      scripts: { go: `${bunExe()} -e 'process.kill(process.pid, "SIGKILL")'` },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "go"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The outer `bun run` must itself die by SIGKILL re-raised from the child.
  // If `bun.sys.sigaction` routed through `std.posix.sigaction`'s
  // `else => unreachable`, this would be SIGILL (debug) or undefined.
  expect(stderr).toContain("SIGKILL");
  expect(stdout).toBe("");
  expect(proc.signalCode).toBe("SIGKILL");
  expect(exitCode).not.toBe(0);
});
