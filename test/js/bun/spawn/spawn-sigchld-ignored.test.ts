import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, libcPathForDlopen, tempDir } from "harness";
import { join } from "node:path";

// An ignored SIGCHLD survives execve. While it is ignored, Linux reaps the
// children of the process itself and wait4() fails with ECHILD, so the exit
// status of every child is lost.

// `trap "" CHLD` sets SIGCHLD to SIG_IGN in bash and `exec` hands that to the
// next program. dash leaves SIGCHLD alone, so /bin/sh cannot be the launcher.
function launcher(ignore: string) {
  return ["bash", "-c", `trap "" ${ignore}; exec "$0" "$@"`];
}

// Bit n-1 of a signal mask in /proc/<pid>/status is set for signal n.
// SigIgn has the ignored signals, SigCgt the ones with a handler.
function signals(status: string, field: "SigIgn" | "SigCgt") {
  const mask = parseInt(new RegExp(`^${field}:\\s*([0-9a-f]+)$`, "m").exec(status)?.[1].slice(-8) ?? "0", 16);
  return { SIGHUP: (mask & 1) !== 0, SIGINT: (mask & 2) !== 0, SIGCHLD: (mask & (1 << 16)) !== 0 };
}

const printStatus = `console.log(require("node:fs").readFileSync("/proc/self/status", "utf8"))`;

const launcherIgnoresSigchld =
  isLinux &&
  Bun.which("bash") != null &&
  signals(Bun.spawnSync({ cmd: [...launcher("CHLD"), "cat", "/proc/self/status"] }).stdout.toString(), "SigIgn")
    .SIGCHLD;

const cc = Bun.which("cc") ?? Bun.which("clang") ?? Bun.which("gcc");

describe.skipIf(!launcherIgnoresSigchld)("bun started with SIGCHLD ignored", () => {
  async function run(ignore: string, args: string[], options: { cwd?: string; env?: typeof bunEnv } = {}) {
    await using proc = Bun.spawn({
      cmd: [...launcher(ignore), bunExe(), ...args],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // Without the reset, `bun run` with BUN_FEATURE_FLAG_NO_ORPHANS=1 does not stop on SIGTERM.
      killSignal: "SIGKILL",
      ...options,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent.each([
    ["Bun.spawnSync", `Bun.spawnSync(["sh", "-c", "exit 7"]).exitCode`, "7"],
    ["Bun.spawn", `await Bun.spawn(["sh", "-c", "exit 7"]).exited`, "7"],
    ["child_process.spawnSync", `require("node:child_process").spawnSync("sh", ["-c", "exit 7"]).status`, "7"],
    ["Bun.$", `(await Bun.$\`sh -c "exit 5"\`.nothrow().quiet()).exitCode`, "5"],
  ])("%s reports the exit code of the child", async (_, expression, expected) => {
    const { stdout, stderr, exitCode } = await run("CHLD", ["-e", `console.log(${expression})`]);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected + "\n");
    expect(exitCode).toBe(0);
  });

  // system() forks and waits inside libc, not through bun's spawn. The wait
  // status of a command that exits holds its exit code in bits 8 to 15.
  test.concurrent("system() through bun:ffi reports the exit code of the command", async () => {
    // A skipped describe still runs its callback, and libcPathForDlopen() throws on Windows.
    const libc = JSON.stringify(libcPathForDlopen());
    const { stdout, stderr, exitCode } = await run("CHLD", [
      "-e",
      `const { symbols } = require("bun:ffi").dlopen(${libc}, { system: { args: ["cstring"], returns: "int" } });
       console.log(symbols.system(Buffer.from("exit 7\\0")) >> 8);`,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("7\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
    ["bun run", {}],
    ["bun run with BUN_FEATURE_FLAG_NO_ORPHANS=1", { BUN_FEATURE_FLAG_NO_ORPHANS: "1" }],
  ])("%s exits with the exit code of the script", async (_, env) => {
    using dir = tempDir("sigchld-ignored", {
      "package.json": JSON.stringify({ name: "sigchld-ignored", scripts: { fail: "exit 3" } }),
    });
    const { stderr, exitCode } = await run("CHLD", ["run", "fail"], { cwd: String(dir), env: { ...bunEnv, ...env } });
    expect(stderr).toBe('$ exit 3\nerror: script "fail" exited with code 3\n');
    expect(exitCode).toBe(3);
  });

  // Only SIGCHLD is put back to its default. `nohup bun` depends on the others.
  test.concurrent("SIGHUP and SIGINT stay ignored", async () => {
    const { stdout, stderr, exitCode } = await run("CHLD HUP INT", ["-e", printStatus]);
    expect(stderr).toBe("");
    expect(signals(stdout, "SigIgn")).toEqual({ SIGHUP: true, SIGINT: true, SIGCHLD: false });
    expect(exitCode).toBe(0);
  });

  // Only an exact SIG_IGN is replaced. A preloaded library runs before main(),
  // and the handler that it installs stays.
  test.concurrent.skipIf(cc == null)("a SIGCHLD handler installed before main() stays", async () => {
    using dir = tempDir("sigchld-handler", {
      "handler.c": `
        #include <signal.h>
        static void on_sigchld(int sig) { (void)sig; }
        __attribute__((constructor)) static void install(void) {
          struct sigaction sa = {0};
          sa.sa_handler = on_sigchld;
          sigaction(SIGCHLD, &sa, 0);
        }
      `,
    });
    const library = join(String(dir), "handler.so");
    await using compile = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", library, join(String(dir), "handler.c")],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [compileStdout, compileStderr, compileExitCode] = await Promise.all([
      compile.stdout.text(),
      compile.stderr.text(),
      compile.exited,
    ]);
    expect({ stdout: compileStdout, stderr: compileStderr, exitCode: compileExitCode }).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const { stdout, stderr, exitCode } = await run("CHLD", ["-e", printStatus], {
      env: { ...bunEnv, LD_PRELOAD: library },
    });
    expect(stderr).toBe("");
    expect(signals(stdout, "SigCgt").SIGCHLD).toBe(true);
    expect(exitCode).toBe(0);
  });
});
