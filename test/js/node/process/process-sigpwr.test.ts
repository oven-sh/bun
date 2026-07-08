import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";

// JSC uses SIGPWR on Linux to suspend/resume the JS thread for conservative stack scanning.
// An unsolicited SIGPWR (from process.kill, Bun.spawn().kill, or an external `kill -PWR`)
// used to reach WTF::Thread::signalHandlerSuspendResume with targetThread == nullptr and
// segfault at offset 0x58. These tests prove the process now survives and that a JS listener
// registered via process.on("SIGPWR", ...) actually fires.

describe.skipIf(!isLinux)("SIGPWR", () => {
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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "handler SIGPWR 30\nsurvived\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent('process.kill(self, "SIGPWR") runs the listener', async () => {
    const script = /*js*/ `
      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGPWR", () => { console.log("handler ran"); resolve(); });
      process.kill(process.pid, "SIGPWR");
      await promise;
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "handler ran\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

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

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  test.concurrent("SIGPWR delivered from outside the process runs the listener", async () => {
    const result = await spawnAndSignalAfterReady(proc => process.kill(proc.pid!, "SIGPWR"));
    expect(result).toEqual({
      stdout: "ready\nhandler ran\nsurvived\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("subprocess.kill('SIGPWR') runs the listener in the child", async () => {
    const result = await spawnAndSignalAfterReady(proc => proc.kill("SIGPWR"));
    expect(result).toEqual({
      stdout: "ready\nhandler ran\nsurvived\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("unsolicited SIGPWR with no listener does not crash the process", async () => {
    const script = /*js*/ `
      process.kill(process.pid, 30);
      await new Promise(r => setImmediate(r));
      console.log("survived");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "survived\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // GC stress: make JSC actually use its SIGPWR suspend/resume machinery alongside an
  // external SIGPWR, to prove the si_code gate lets the GC path through unmolested.
  test.concurrent("GC suspend/resume still works with the SIGPWR guard installed", async () => {
    const script = /*js*/ `
      let handled = 0;
      process.on("SIGPWR", () => { handled++; });
      for (let i = 0; i < 50; i++) {
        const junk = [];
        for (let j = 0; j < 1000; j++) junk.push({ a: j, b: Buffer.alloc(64, 65).toString() });
        Bun.gc(true);
        process.kill(process.pid, 30);
        await new Promise(r => setImmediate(r));
      }
      console.log(JSON.stringify({ handled }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ handled: 50 });
    expect(exitCode).toBe(0);
    expect(proc.signalCode).toBe(null);
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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "survived\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
