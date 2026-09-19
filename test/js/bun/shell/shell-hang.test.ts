import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, libcPathForDlopen } from "harness";
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

// Other code in the process (here a blocking waitpid(-1) through bun:ffi) reaps
// the command first. bun's own wait then fails with ECHILD, and the exit status
// is gone.
test.skipIf(isWindows)("a command whose wait fails still completes", async () => {
  const script = /* js */ `
    import { $ } from "bun";
    import { dlopen, ptr } from "bun:ffi";

    const { waitpid, syscall, getpid, close } = dlopen(${JSON.stringify(libcPathForDlopen())}, {
      waitpid: { args: ["i32", "ptr", "i32"], returns: "i32" },
      syscall: { args: ["i64", "i32", "u32"], returns: "i64" },
      getpid: { args: [], returns: "i32" },
      close: { args: ["i32"], returns: "i32" },
    }).symbols;

    // Without pidfd_open (a seccomp profile can block it) bun on Linux waits on
    // a second thread, and that thread reaps the command before waitpid() here.
    if (process.platform === "linux") {
      const SYS_pidfd_open = 434;
      const pidfd = Number(syscall(SYS_pidfd_open, getpid(), 0));
      if (pidfd < 0) {
        console.log(JSON.stringify({ skipped: "pidfd_open is not available" }));
        process.exit(0);
      }
      close(pidfd);
    }

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

  if (stdout === JSON.stringify({ skipped: "pidfd_open is not available" }) + "\n") {
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    console.warn("pidfd_open is not available here, so the failed wait was not exercised");
    return;
  }

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
