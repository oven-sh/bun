import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux } from "harness";

// JSC uses SIGPWR on Linux to suspend/resume the JS thread for conservative stack scanning.
// An unsolicited SIGPWR (from process.kill, Bun.spawn().kill, or an external `kill -PWR`)
// used to reach WTF::Thread::signalHandlerSuspendResume with targetThread == nullptr and
// segfault at offset 0x58. These tests prove the process now survives and that a JS listener
// registered via process.on("SIGPWR", ...) actually fires.

describe.skipIf(!isLinux)("SIGPWR", () => {
  async function runScript(script: string, extraEnv: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  async function spawnAndSignalAfterReady(deliver: (proc: import("bun").Subprocess<"ignore", "pipe", "pipe">) => void) {
    const script = /*js*/ `
      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGPWR", () => { console.log("handler ran"); resolve(); });
      console.log("ready");
      await promise;
      console.log("survived");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrPromise = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    let sent = false;
    while (true) {
      const { done, value } = await reader.read();
      if (value) stdout += decoder.decode(value, { stream: true });
      if (!sent && stdout.includes("ready\n")) {
        sent = true;
        deliver(proc);
      }
      if (done) break;
    }
    stdout += decoder.decode();

    const [stderr, exitCode] = await Promise.all([stderrPromise, proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  const ok = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signalCode: null });

  // The literal 30 is intentional: this exercises the numeric-signal path from the repro,
  // which hands the raw number straight to kill(2) without name-table lookup.
  test.concurrent("process.kill(self, 30) runs the SIGPWR listener instead of crashing", async () => {
    const script = /*js*/ `
      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGPWR", (name, num) => {
        console.log("handler", name, num);
        resolve();
      });
      process.kill(process.pid, 30);
      await promise;
      console.log("survived");
    `;
    expect(await runScript(script)).toEqual(ok("handler SIGPWR 30\nsurvived\n"));
  });

  test.concurrent('process.kill(self, "SIGPWR") runs the listener', async () => {
    const script = /*js*/ `
      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGPWR", () => { console.log("handler ran"); resolve(); });
      process.kill(process.pid, "SIGPWR");
      await promise;
    `;
    expect(await runScript(script)).toEqual(ok("handler ran\n"));
  });

  test.concurrent("SIGPWR delivered from outside the process runs the listener", async () => {
    const result = await spawnAndSignalAfterReady(proc => process.kill(proc.pid!, "SIGPWR"));
    expect(result).toEqual(ok("ready\nhandler ran\nsurvived\n"));
  });

  test.concurrent("subprocess.kill('SIGPWR') runs the listener in the child", async () => {
    const result = await spawnAndSignalAfterReady(proc => proc.kill("SIGPWR"));
    expect(result).toEqual(ok("ready\nhandler ran\nsurvived\n"));
  });

  test.concurrent("unsolicited SIGPWR with no listener does not crash the process", async () => {
    const script = /*js*/ `
      process.kill(process.pid, 30);
      await new Promise(r => setImmediate(r));
      console.log("survived");
    `;
    expect(await runScript(script)).toEqual(ok("survived\n"));
  });

  test.concurrent("unsolicited SIGPWR after breakOnSigint primed the signal ring does not crash", async () => {
    const script = /*js*/ `
      require("node:vm").runInNewContext("1", {}, { breakOnSigint: true });
      process.kill(process.pid, 30);
      await new Promise(r => setImmediate(r));
      console.log("survived");
    `;
    expect(await runScript(script)).toEqual(ok("survived\n"));
  });

  // collectContinuously runs a dedicated collector thread in the same VM that suspends the
  // main mutator via pthread_kill(SIGPWR); a broken SI_TKILL passthrough would hang here.
  // The exact `handled` count also proves internal deliveries are not misrouted to JS.
  test.concurrent("GC suspend/resume still works with the SIGPWR guard installed", async () => {
    const iterations = isDebug ? 10 : 50;
    const script = /*js*/ `
      let handled = 0;
      process.on("SIGPWR", () => { handled++; });
      for (let i = 0; i < ${iterations}; i++) {
        const junk = [];
        for (let j = 0; j < 200; j++) junk.push({ a: j, b: Buffer.alloc(64, 65).toString() });
        Bun.gc(true);
        process.kill(process.pid, 30);
        await new Promise(r => setImmediate(r));
      }
      console.log(JSON.stringify({ handled }));
    `;

    const { stdout, stderr, exitCode, signalCode } = await runScript(script, { BUN_JSC_collectContinuously: "1" });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ handled: iterations });
    expect(exitCode).toBe(0);
    expect(signalCode).toBe(null);
  });

  test.concurrent("removing all SIGPWR listeners does not reset the disposition to SIG_DFL", async () => {
    const script = /*js*/ `
      const fn = () => {};
      process.on("SIGPWR", fn);
      process.off("SIGPWR", fn);
      Bun.gc(true);
      process.kill(process.pid, 30);
      await new Promise(r => setImmediate(r));
      console.log("survived");
    `;
    expect(await runScript(script)).toEqual(ok("survived\n"));
  });
});
