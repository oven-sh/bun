import type { FileSink } from "bun";
import { dlopen, FFIType } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, libcPathForDlopen, tempDir } from "harness";
import { closeSync, writeSync } from "node:fs";

// On POSIX the shell only runs its own `cat` when this flag is set (see
// `Kind::DISABLED_ON_POSIX`); otherwise it spawns the system binary. The
// scripts run in a child so the flag applies.
const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

// Unless `quiet` is set, cat's stdout is the shell's IOWriter on the child's
// stdout pipe: a chunk cat reads stays queued there until the event loop
// reaches the writable poll, which is the window the read-error paths under
// test fire in. `r.stdout` is a tee of the same bytes, so the child's stdout
// ends up as cat's own output followed by the report line. With `quiet`
// nothing is queued (output goes straight into the capture buffer).
function spawnReport(command: string, options: { quiet?: boolean; stdin?: number | "pipe"; cwd?: string } = {}) {
  return Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        import { $ } from "bun";
        const r = await $\`${command}\`${options.quiet ? ".quiet()" : ""}.nothrow();
        console.log(JSON.stringify({ exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }));
      `,
    ],
    env: builtinEnv,
    cwd: options.cwd,
    stdin: options.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

function report(exitCode: number, stdout: string): string {
  return JSON.stringify({ exitCode, stdout, stderr: "" }) + "\n";
}

const EIO = 5;

// On Linux, once the slave side of a pty is closed, read() on the master
// returns whatever the slave wrote and then fails with EIO. Handing the master
// to the child as its stdin is a way to feed the builtin a genuine read error
// preceded by data: cat gets both in the same poll wake.
function openptyMasterWithClosedSlave(payload: string): number {
  const { openpty } = dlopen(libcPathForDlopen(), {
    openpty: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32,
    },
  }).symbols;
  const master = new Int32Array(1);
  const slave = new Int32Array(1);
  expect(openpty(master, slave, null, null, null)).toBe(0);
  // No newline: the pty's output processing would turn it into "\r\n".
  writeSync(slave[0], payload);
  closeSync(slave[0]);
  return master[0];
}

describe.concurrent("cat (builtin)", () => {
  test.skipIf(!isPosix)("copies stdin to stdout until EOF", async () => {
    await using proc = spawnReport("cat", { stdin: "pipe" });
    const stdin = proc.stdin as FileSink;
    stdin.write("piped in\n");
    await stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "piped in\n" + report(0, "piped in\n"), stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("read error with nothing queued: exits with the errno", async () => {
    const master = openptyMasterWithClosedSlave("read before the error");
    await using proc = spawnReport("cat", { quiet: true, stdin: master });
    // The child holds its own copy of the master.
    closeSync(master);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: report(EIO, "read before the error"), stderr: "" });
    expect(exitCode).toBe(0);
  });

  // Same error, but with the data still queued on stdout. This used to cancel
  // the queued chunk and suspend; a cancelled chunk completes without calling
  // back into cat, so the command never finished, the `$` promise never
  // settled, and the data was dropped.
  test.skipIf(!isLinux)("read error with data still queued: flushes it, then exits with the errno", async () => {
    const master = openptyMasterWithClosedSlave("read before the error");
    await using proc = spawnReport("cat", { stdin: master });
    closeSync(master);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({
      stdout: "read before the error" + report(EIO, "read before the error"),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // File-argument state. A directory opens but cannot be read (Linux already
  // refuses to register it with epoll), so the reader fails before anything is
  // queued. With stdout on an fd this used to suspend forever too: finishing
  // was gated on a flag that only a completed chunk could set.
  test.skipIf(!isPosix)("unreadable file argument exits with the errno instead of hanging", async () => {
    using dir = tempDir("shell-cat-dir-arg", { "sub/.keep": "" });
    await using proc = spawnReport("cat sub", { cwd: String(dir) });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const parsed = JSON.parse(stdout);
    expect({ parsed, stderr }).toEqual({
      parsed: { exitCode: expect.any(Number), stdout: "", stderr: "" },
      stderr: "",
    });
    expect(parsed.exitCode).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  });
});
