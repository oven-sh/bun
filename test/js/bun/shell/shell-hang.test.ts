import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, libcPathForDlopen } from "harness";
import path from "path";

// Pass by not hanging
const fail = [
  "./shell-hang-error-fixture.js",
  "./shell-hang-success-and-error.js",
  "./shell-hang-first-works-second-fails.js",
];

// Pass by not hanging AND a 0 exit code
const pass = [
  "./shell-hang-error-or-success.js",
  "./shell-hang-fixture-success-and-success.js",
  "./shell-hang-success-fixture.js",
];

describe("fail", () => {
  test.concurrent.each(fail)("%s", async fixture => {
    const { exitCode } = await bunRun(path.join(import.meta.dir, fixture));
    expect(exitCode).not.toBe(0);
  });
});

describe("pass", () => {
  test.concurrent.each(pass)("%s", async fixture => {
    const { stderr, exitCode } = await bunRun(path.join(import.meta.dir, fixture));
    if (exitCode !== 0) console.error(stderr);
    expect(exitCode).toBe(0);
  });
});

// Without pidfd_open (a seccomp profile can block it) bun on Linux waits for
// children on a second thread. That thread reaps the command before the test's
// waitpid() can, so the wait cannot be made to fail there.
function hasPidfdOpen() {
  const libc = dlopen(libcPathForDlopen(), {
    syscall: { args: ["i64", "i32", "u32"], returns: "i64" },
    close: { args: ["i32"], returns: "i32" },
  });
  const SYS_pidfd_open = 434;
  const pidfd = Number(libc.symbols.syscall(SYS_pidfd_open, process.pid, 0));
  if (pidfd >= 0) libc.symbols.close(pidfd);
  libc.close();
  return pidfd >= 0;
}
const canForceFailedWait = !isWindows && (!isLinux || hasPidfdOpen());

// Other code in the process (here a blocking waitpid(-1) through bun:ffi) reaps
// the command first. bun's own wait then fails with ECHILD, and the exit status
// is gone.
//
// Not concurrent: if this case times out, its child never exits, and the runner
// kills the child of a timed-out test only when the test is not concurrent.
test.skipIf(!canForceFailedWait)("a command whose wait fails still completes", async () => {
  const script = /* js */ `
    import { $ } from "bun";
    import { dlopen, ptr } from "bun:ffi";

    const { waitpid } = dlopen(${JSON.stringify(libcPathForDlopen())}, {
      waitpid: { args: ["i32", "ptr", "i32"], returns: "i32" },
    }).symbols;

    const results = {};
    for (const quiet of [true, false]) {
      // then() starts the command, so its process exists when waitpid() blocks.
      const pending = $\`sh -c "echo out; echo err >&2; exit 3"\`.nothrow().quiet(quiet).then(r => r);
      const status = new Int32Array(1);
      const reaped = waitpid(-1, ptr(status), 0) > 0;
      const { exitCode, stdout, stderr } = await pending;
      results[quiet ? "quiet" : "loud"] = {
        reaped,
        reapedExitCode: (status[0] >> 8) & 0xff,
        exitCode,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      };
    }
    console.log(JSON.stringify(results));
  `;

  // This flag forces the second-thread wait that the script has to avoid.
  const { BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: _, ...env } = bunEnv;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const waitFailed = {
    reaped: true,
    reapedExitCode: 3,
    exitCode: 1,
    stdout: "out\n",
    stderr: `err\nbun: failed to wait for ${Bun.which("sh")}: No child processes\n`,
  };
  // Only the loud run also writes through to the real stdout and stderr.
  expect(stderr).toBe(waitFailed.stderr);
  expect(stdout).toBe("out\n" + JSON.stringify({ quiet: waitFailed, loud: waitFailed }) + "\n");
  expect(exitCode).toBe(0);
});
