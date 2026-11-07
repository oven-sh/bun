// `bun run <script>` re-raises the child's terminating signal via
// `Global.raiseIgnoringPanicHandler`, which first resets the signal's
// disposition with `bun.sys.sigaction(sig, …)`. `SIGKILL`/`SIGSTOP` can't
// have their disposition changed, so libc returns `EINVAL` there — that
// must not reach `std.posix.sigaction`'s `else => unreachable`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, isLinux, isPosix, tempDir } from "harness";
import { constants } from "os";
import { join } from "path";

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

// The message names the signal with the OS's name for its number (SIGUSR1 is
// 30 on macOS, which the Linux table called SIGPWR; 16 on Linux is SIGSTKFLT,
// which was printed as "code 16"), and bun run then dies from the same signal.
// Signal 40 is a Linux real-time signal with no name at all: it is printed as
// its number, and bun run used to exit 1 instead of dying from it.
const signaled: [number, string][] = [
  [constants.signals.SIGUSR1, "terminated by signal SIGUSR1"],
  ...(isLinux
    ? ([
        [constants.signals.SIGSTKFLT, "terminated by signal SIGSTKFLT"],
        [40, "terminated by signal code 40"],
      ] as [number, string][])
    : []),
];
test.skipIf(!isPosix).each(signaled)("bun run reports and re-raises signal %d", async (signal, message) => {
  using dir = tempDir("run-signaled-script", {
    "package.json": JSON.stringify({ name: "t", scripts: { go: `kill -${signal} $$` } }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "go"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lines = stderr.trim().split("\n");
  expect(lines[0]).toBe(`$ kill -${signal} $$`);
  expect(lines[1]).toContain(message);
  expect(stdout).toBe("");
  expect(exitCode).toBe(128 + signal);
});

// The kernel discards a default-action signal that PID 1 of a pid namespace sends to itself.
// A preloaded no-op raise() simulates that.
const cc = Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
describe.concurrent.skipIf(!cc || !isGlibc)("exits 128 + signo when the re-raise is discarded", () => {
  function project() {
    const dir = tempDir("run-discarded-raise", {
      "package.json": JSON.stringify({ name: "t", scripts: { go: "kill -TERM $$" } }),
      "raise.c": "int raise(int sig) { (void)sig; return 0; }\n",
    });
    const preload = join(String(dir), "libraise.so");
    const { exitCode } = Bun.spawnSync({ cmd: [cc!, "-shared", "-fPIC", "-o", preload, "raise.c"], cwd: String(dir) });
    expect(exitCode).toBe(0);
    return { dir, env: { ...bunEnv, LD_PRELOAD: preload } };
  }

  test("bun run <script>", async () => {
    const { dir, env } = project();
    using _ = dir;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "go"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("terminated by signal SIGTERM");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(128 + constants.signals.SIGTERM);
  });

  // The `yes` builtin runs inside bun, so the Ctrl+C handler has no child to forward the signal to.
  test("Ctrl+C without a live child", async () => {
    const { dir, env } = project();
    using _ = dir;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", "yes"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toStartWith("y\n");
    reader.releaseLock();
    proc.kill("SIGINT");

    expect(await proc.exited).toBe(128 + constants.signals.SIGINT);
    expect(proc.signalCode).toBeNull();
  });
});
