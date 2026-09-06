import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix } from "harness";

// The signal mask and SIG_IGN dispositions survive execve. A parent that
// blocks SIGSEGV or ignores SIGCHLD before it execs bun must not break
// JSC's signal-based fault handling or child process reaping.

const python = Bun.which("python3");

// execs bun with the given signal state set up by the parent
function launch(setup: string, args: string[]) {
  return Bun.spawn({
    cmd: [
      python!,
      "-c",
      `import os, signal, sys\n${setup}\nos.execv(sys.argv[1], sys.argv[1:])`,
      bunExe(),
      ...args,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
}

// i32.load at offset 112 past the end of a one-page memory
const wasmOutOfBounds = `
  const b = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,5,3,1,0,1,7,5,1,1,102,0,0,10,9,1,7,0,65,112,40,2,0,11]);
  const i = new WebAssembly.Instance(new WebAssembly.Module(b));
  try { i.exports.f() } catch (e) { console.log("caught", e.constructor.name) }
`;

describe.skipIf(!isPosix || !python)("inherited signal state", () => {
  test.concurrent("SIGCHLD ignored by the parent: child exit codes still arrive", async () => {
    await using proc = launch("signal.signal(signal.SIGCHLD, signal.SIG_IGN)", [
      "-e",
      `console.log(
        Bun.spawnSync(["sh", "-c", "exit 7"]).exitCode,
        require("child_process").spawnSync("sh", ["-c", "exit 7"]).status,
        await Bun.spawn(["sh", "-c", "exit 7"]).exited,
      )`,
    ]);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("7 7 7\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("SIGSEGV blocked by the parent: a wasm out-of-bounds access is a RuntimeError", async () => {
    await using proc = launch("signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGSEGV})", ["-e", wasmOutOfBounds]);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("caught RuntimeError\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!isLinux)("blocked signals are not inherited by bun or its children", async () => {
    const sigBlk = `fs.readFileSync("/proc/self/status", "utf8").match(/SigBlk:\\s*(\\w+)/)[1]`;
    await using proc = launch("signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGUSR1, signal.SIGSEGV})", [
      "-e",
      `const fs = require("fs");
       console.log(${sigBlk});
       console.log(Bun.spawnSync(["grep", "SigBlk", "/proc/self/status"]).stdout.toString().split(/\\s+/)[1]);`,
    ]);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0000000000000000\n0000000000000000\n");
    expect(exitCode).toBe(0);
  });
});
