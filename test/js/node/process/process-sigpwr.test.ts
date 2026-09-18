import type { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, libcPathForDlopen } from "harness";

// On Linux, JSC suspends and resumes threads (for the GC and the sampling profiler) with SIGPWR.
// WebKit's handler used to act on every delivery, so a SIGPWR that JSC did not send (process.kill,
// subprocess.kill, `kill -PWR <pid>`, raise()) segfaulted the process, or ended a suspension early.

type Child = Subprocess<"pipe", "pipe", "pipe">;

describe.skipIf(!isLinux)("SIGPWR", () => {
  // Runs `script` in a child. `onReady` runs once the child has printed "ready"; the child's stdin
  // is closed after it.
  async function runScript(
    script: string,
    options: { env?: Record<string, string>; onReady?: (proc: Child) => void } = {},
  ) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ...options.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrPromise = proc.stderr.text();
    const decoder = new TextDecoder();
    let stdout = "";
    let isReady = false;
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      if (!isReady && options.onReady && stdout.includes("ready\n")) {
        isReady = true;
        options.onReady(proc);
        proc.stdin.end();
      }
    }
    stdout += decoder.decode();

    const [stderr, exitCode] = await Promise.all([stderrPromise, proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  const ok = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signalCode: null });

  // The signal is generated before stdin closes, and a sleeping main thread takes it first, so the
  // child handles the signal before it sees the end of stdin.
  const waitForStdinToClose = /*js*/ `
    console.log("ready");
    for await (const _ of Bun.stdin.stream()) {}
    console.log("survived");
  `;

  test.concurrent("process.kill(process.pid, 30) does not crash the process", async () => {
    const script = /*js*/ `
      process.kill(process.pid, 30);
      await new Promise(r => setImmediate(r));
      console.log("survived");
    `;
    expect(await runScript(script)).toEqual(ok("survived\n"));
  });

  test.concurrent("SIGPWR from another process does not crash the process", async () => {
    const result = await runScript(waitForStdinToClose, { onReady: proc => void process.kill(proc.pid, 30) });
    expect(result).toEqual(ok("ready\nsurvived\n"));
  });

  test.concurrent('subprocess.kill("SIGPWR") does not crash the child', async () => {
    const result = await runScript(waitForStdinToClose, { onReady: proc => proc.kill("SIGPWR") });
    expect(result).toEqual(ok("ready\nsurvived\n"));
  });

  // raise() is pthread_kill() on the calling thread: the same kind of delivery as JSC's own.
  test.concurrent("raise(SIGPWR) does not crash the process", async () => {
    const script = /*js*/ `
      const { dlopen } = require("bun:ffi");
      const { symbols } = dlopen(${JSON.stringify(libcPathForDlopen())}, { raise: { args: ["int"], returns: "int" } });
      console.log("raise returned", symbols.raise(30));
      await new Promise(r => setImmediate(r));
      console.log("survived");
    `;
    expect(await runScript(script)).toEqual(ok("raise returned 0\nsurvived\n"));
  });

  // collectContinuously runs a collector thread in the same VM, which suspends the main thread
  // with SIGPWR over and over while the main thread also sends SIGPWR to the process.
  test.concurrent("GC thread suspension works around unsolicited SIGPWR", async () => {
    const iterations = isDebug ? 10 : 50;
    const script = /*js*/ `
      for (let i = 0; i < ${iterations}; i++) {
        const junk = [];
        for (let j = 0; j < 200; j++) junk.push({ a: j, b: Buffer.alloc(64, 65).toString() });
        Bun.gc(true);
        process.kill(process.pid, 30);
        await new Promise(r => setImmediate(r));
      }
      console.log("survived");
    `;
    const result = await runScript(script, { env: { BUN_JSC_collectContinuously: "1" } });
    expect(result).toEqual(ok("survived\n"));
  });

  // With no room to queue siginfo the kernel delivers JSC's own pthread_kill() as SI_USER from
  // pid 0, the same as a kill(2) from a parent PID namespace. Thread suspension must not depend on it.
  test.concurrent("GC thread suspension works with RLIMIT_SIGPENDING exhausted", async () => {
    const script = /*js*/ `
      const { dlopen, ptr } = require("bun:ffi");
      const { symbols } = dlopen(${JSON.stringify(libcPathForDlopen())}, {
        setrlimit: { args: ["int", "ptr"], returns: "int" },
      });
      const RLIMIT_SIGPENDING = 11;
      console.log("setrlimit returned", symbols.setrlimit(RLIMIT_SIGPENDING, ptr(new BigUint64Array([0n, 0n]))));
      for (let i = 0; i < ${isDebug ? 5 : 20}; i++) {
        const junk = [];
        for (let j = 0; j < 200; j++) junk.push({ a: j, b: Buffer.alloc(64, 65).toString() });
        Bun.gc(true);
        await new Promise(r => setImmediate(r));
      }
      console.log("survived");
    `;
    const result = await runScript(script, { env: { BUN_JSC_collectContinuously: "1" } });
    expect(result).toEqual(ok("setrlimit returned 0\nsurvived\n"));
  });

  // WebKit's handler waits in sigsuspend(), which returns as soon as any handler returns. The hook
  // suspends this thread the way the GC does, sends SIGPWR during the suspension, and reports
  // whether the thread ran before the resume. A second round proves that the handshake still works.
  //
  // suspendThreadAndSignalForTesting(state, signal, holdMilliseconds, threadDirected): `state` is an
  // Int32Array over a SharedArrayBuffer. The caller keeps incrementing state[0]. The hook sets
  // state[1] to 1 if that counter moved during the suspension, and state[2] to 1 once the thread is
  // resumed. `threadDirected` sends with pthread_kill() to this thread instead of kill(2) to the process.
  describe.each([
    ["kill(2)", false],
    ["pthread_kill()", true],
  ])("SIGPWR from %s while JSC has the thread suspended", (_, threadDirected) => {
    test.concurrent("does not resume the thread early", async () => {
      const script = /*js*/ `
        const { suspendThreadAndSignalForTesting } = require("bun:internal-for-testing");
        const ranWhileSuspended = [];
        for (let round = 0; round < 2; round++) {
          const state = new Int32Array(new SharedArrayBuffer(12));
          suspendThreadAndSignalForTesting(state, 30, 30, ${threadDirected});
          while (Atomics.load(state, 2) === 0) Atomics.add(state, 0, 1);
          ranWhileSuspended.push(Atomics.load(state, 1) === 1);
        }
        console.log(JSON.stringify({ ranWhileSuspended }));
      `;
      expect(await runScript(script)).toEqual(ok('{"ranWhileSuspended":[false,false]}\n'));
    });
  });
});
