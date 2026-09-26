import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir, tempDirWithFiles } from "harness";
import { readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

// Android's per-app seccomp policy (and any other policy built on
// SECCOMP_RET_TRAP) answers a syscall it does not allow with SIGSYS instead of
// an errno. Bun installs a SIGSYS handler at startup that makes the blocked
// syscall return ENOSYS, so the ENOSYS fallbacks that already exist for these
// syscalls take over. Without it the process dies with "Bad system call".
//
// seccomp-trap.c installs such a policy for the given syscall numbers and
// execs Bun under it. The numbers below are the same on x86_64 and aarch64.
// close_range, openat2 and fchmodat2 are the ones Android is known to trap
// (#30766, #39060).
const SYS_pidfd_open = 434;
const SYS_close_range = 436;
const SYS_openat2 = 437;
const SYS_fchmodat2 = 452;

describe.skipIf(!isLinux)("seccomp SECCOMP_RET_TRAP policies", () => {
  const helper = isLinux ? buildHelper() : null;

  async function runTrapped(
    trapped: number[] | "none",
    cmd: string[],
    options: { cwd?: string; env?: Record<string, string> } = {},
  ) {
    await using proc = Bun.spawn({
      cmd: [helper!, trapped === "none" ? "none" : trapped.join(","), ...cmd],
      env: { ...bunEnv, ...options.env },
      cwd: options.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode: proc.exitCode, signalCode: proc.signalCode };
  }

  test.concurrent.skipIf(!helper)("bun starts when close_range is trapped", async () => {
    // bun_initialize_process calls close_range(2) before anything else runs.
    const result = await runTrapped([SYS_close_range], [bunExe(), "-e", `console.log("ok")`]);
    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test.concurrent.skipIf(!helper)("spawned children exec when close_range is trapped", async () => {
    // The vfork child calls close_range(2) right before execve(2).
    const result = await runTrapped(
      [SYS_close_range],
      [
        bunExe(),
        "-e",
        `const r = Bun.spawnSync(["echo", "hi"]);
         console.log(JSON.stringify({ stdout: r.stdout.toString(), exitCode: r.exitCode, signalCode: r.signalCode ?? null }));`,
      ],
    );
    expect(result).toEqual({
      stdout: JSON.stringify({ stdout: "hi\n", exitCode: 0, signalCode: null }) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent.skipIf(!helper)(
    "spawned children exec when close_range is trapped and the caller blocks SIGSYS",
    async () => {
      // The child takes over the caller's signal mask only after close_range(2):
      // a trap on a blocked SIGSYS kills the process instead of reaching the
      // handler. The fixture blocks SIGSYS on the spawning thread first.
      using dir = tempDir("seccomp-trap-blocked", {
        "fixture.js": `
          import { dlopen, FFIType, ptr } from "bun:ffi";
          const libc = dlopen(process.env.LIBC_PATH, {
            sigprocmask: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
          });
          // Large enough for every libc's sigset_t; SIGSYS (31) is bit 30 of the first word.
          const set = new BigUint64Array(16);
          set[0] = 1n << 30n;
          const SIG_BLOCK = 0;
          if (libc.symbols.sigprocmask(SIG_BLOCK, ptr(set), null) !== 0) throw new Error("sigprocmask failed");
          const r = Bun.spawnSync(["echo", "hi"]);
          console.log(JSON.stringify({ stdout: r.stdout.toString(), exitCode: r.exitCode, signalCode: r.signalCode ?? null }));
        `,
      });
      const result = await runTrapped([SYS_close_range], [bunExe(), "fixture.js"], {
        cwd: String(dir),
        env: { LIBC_PATH: libcPathForDlopen() },
      });
      // bun:ffi under ASAN may print a warning about dlopen; nothing else is allowed on stderr.
      result.stderr = result.stderr
        .split("\n")
        .filter(line => line && !line.startsWith("WARNING: ASAN interferes"))
        .join("\n");
      expect(result).toEqual({
        stdout: JSON.stringify({ stdout: "hi\n", exitCode: 0, signalCode: null }) + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  test.concurrent.skipIf(!helper)("Bun.spawn falls back to the waiter thread when pidfd_open is trapped", async () => {
    const result = await runTrapped(
      [SYS_pidfd_open],
      [
        bunExe(),
        "-e",
        `const results = [];
         for (let i = 0; i < 3; i++) {
           const proc = Bun.spawn(["echo", "hi" + i], { stdout: "pipe" });
           results.push([await proc.stdout.text(), await proc.exited]);
         }
         console.log(JSON.stringify(results));`,
      ],
    );
    expect(result).toEqual({
      stdout:
        JSON.stringify([
          ["hi0\n", 0],
          ["hi1\n", 0],
          ["hi2\n", 0],
        ]) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent.skipIf(!helper)("bun install links a nested bin when openat2 and fchmodat2 are trapped", async () => {
    // Bin linking checks a nested link target with openat2(RESOLVE_BENEATH),
    // falling back to realpath on ENOSYS, and then makes the target executable
    // with fchmodat2, falling back to libc's fchmodat on ENOSYS.
    using dir = tempDir("seccomp-trap-install", {
      "package.json": JSON.stringify({ name: "app", dependencies: { dep: "file:./dep" } }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", bin: { depbin: "bin/cli.js" } }),
      "dep/bin/cli.js": `#!/usr/bin/env node\nconsole.log("depbin");\n`,
    });
    const target = join(String(dir), "dep/bin/cli.js");
    expect(statSync(target).mode & 0o111).toBe(0);

    const result = await runTrapped([SYS_openat2, SYS_fchmodat2], [bunExe(), "install"], { cwd: String(dir) });
    expect(result).toEqual({
      stdout: expect.stringContaining(" installed"),
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
      signalCode: null,
    });
    expect(readlinkSync(join(String(dir), "node_modules/.bin/depbin"))).toBe("../dep/bin/cli.js");
    expect(statSync(target).mode & 0o100).toBe(0o100);
  });

  test.concurrent.skipIf(!helper)("bun run --no-orphans waits for the script when pidfd_open is trapped", async () => {
    // spawnSync installs signal forwarding handlers around the script; SIGSYS
    // must not be one of them, or the pidfd_open(2) in the no-orphans wait loop
    // is forwarded to the script as a kill instead of returning ENOSYS.
    using dir = tempDir("seccomp-trap-run", {
      "package.json": JSON.stringify({ name: "app", scripts: { hello: "echo hello-from-script" } }),
    });
    const result = await runTrapped([SYS_pidfd_open], [bunExe(), "run", "--no-orphans", "--silent", "hello"], {
      cwd: String(dir),
    });
    expect(result).toEqual({ stdout: "hello-from-script\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test.concurrent.skipIf(!helper)("a SIGSYS sent with kill still terminates the process", async () => {
    const result = await runTrapped("none", [bunExe(), "-e", `process.kill(process.pid, "SIGSYS");`]);
    expect({ exitCode: result.exitCode, signalCode: result.signalCode }).toEqual({
      exitCode: null,
      signalCode: "SIGSYS",
    });
  });

  test.concurrent.skipIf(!helper)("process.on('SIGSYS') keeps the trap handler and still sees kill", async () => {
    // signal-exit and similar libraries listen for SIGSYS. The listener must
    // not replace the trap handler (spawning still works while it is installed
    // and after it is removed), and a SIGSYS sent with kill still reaches JS.
    const result = await runTrapped(
      [SYS_pidfd_open],
      [
        bunExe(),
        "-e",
        `const { promise, resolve } = Promise.withResolvers();
         process.on("SIGSYS", resolve);
         const first = Bun.spawnSync(["echo", "hi"]).stdout.toString();
         process.kill(process.pid, "SIGSYS");
         await promise;
         process.removeAllListeners("SIGSYS");
         const second = Bun.spawnSync(["echo", "hi"]).stdout.toString();
         console.log(JSON.stringify({ first, listenerRan: true, second }));
         process.kill(process.pid, "SIGSYS");`,
      ],
    );
    expect(result).toEqual({
      stdout: JSON.stringify({ first: "hi\n", listenerRan: true, second: "hi\n" }) + "\n",
      stderr: "",
      exitCode: null,
      signalCode: "SIGSYS",
    });
  });
});

// Compiles seccomp-trap.c and checks that this environment lets us install a
// seccomp filter. Returns null (tests are skipped) when there is no C compiler
// or the filter cannot be installed. A compile error is a test failure.
function buildHelper(): string | null {
  const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");
  if (!cc) {
    console.warn("SKIP seccomp-trap: no C compiler on PATH");
    return null;
  }

  const dir = tempDirWithFiles("seccomp-trap-helper", {});
  const bin = join(dir, "seccomp-trap");
  const compile = Bun.spawnSync({
    cmd: [cc, "-O0", "-o", bin, join(import.meta.dirname, "seccomp-trap.c")],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (compile.exitCode !== 0) {
    throw new Error(`failed to compile seccomp-trap.c:\n${compile.stderr.toString()}`);
  }

  const probe = Bun.spawnSync({ cmd: [bin, "none", Bun.which("true")!], stdout: "pipe", stderr: "pipe" });
  if (probe.exitCode !== 0) {
    console.warn(`SKIP seccomp-trap: cannot install a seccomp filter here: ${probe.stderr.toString().trim()}`);
    return null;
  }
  return bin;
}
