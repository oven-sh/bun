import type { Subprocess } from "bun";
import { dlopen } from "bun:ffi";
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, libcPathForDlopen, normalizeBunSnapshot } from "harness";
import { constants } from "node:os";

// When multiple listeners are registered for the same signal, removing one
// listener must NOT uninstall the underlying OS signal handler while other
// listeners remain.
test.skipIf(isWindows)("removing one of multiple signal listeners keeps the handler installed", async () => {
  const script = /*js*/ `
    const { promise, resolve } = Promise.withResolvers();

    let handlerBCount = 0;

    function handlerA() {
      console.log("handlerA fired (bug: I was removed!)");
    }

    function handlerB() {
      handlerBCount++;
      console.log("handlerB fired", handlerBCount);
      if (handlerBCount === 2) {
        resolve();
      }
    }

    process.on("SIGUSR2", handlerA);
    process.on("SIGUSR2", handlerB);

    // Remove handlerA - handlerB should still receive signals.
    process.off("SIGUSR2", handlerA);

    // Send ourselves the signal twice.
    process.kill(process.pid, "SIGUSR2");

    // Wait for first signal, then send again.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    process.kill(process.pid, "SIGUSR2");

    await promise;
    console.log("done");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
"handlerB fired 1
handlerB fired 2
done"
`);
  expect(exitCode).toBe(0);
});

// Verify that removing ALL listeners does properly uninstall the handler,
// so the process dies with the default signal behavior.
test.skipIf(isWindows)("removing all signal listeners uninstalls the handler (default signal behavior)", async () => {
  const script = /*js*/ `
    function handlerA() {}
    function handlerB() {}

    process.on("SIGUSR2", handlerA);
    process.on("SIGUSR2", handlerB);

    process.off("SIGUSR2", handlerA);
    process.off("SIGUSR2", handlerB);

    // Keep event loop alive briefly so signal can be delivered
    setTimeout(() => {
      // If we get here, the signal handler was incorrectly still installed
      // (or signal was ignored). Exit with a distinct code.
      process.exit(42);
    }, 1000);

    process.kill(process.pid, "SIGUSR2");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  // Default SIGUSR2 behavior is to terminate the process with a signal.
  // If the handler was correctly uninstalled, the process dies via signal (not exit code 42).
  expect(exitCode).not.toBe(42);
  expect(exitCode).not.toBe(0);
  expect(proc.signalCode).not.toBeNull();
});

// Re-adding a listener after all were removed should reinstall the handler.
test.skipIf(isWindows)("re-adding a listener after removing all reinstalls the handler", async () => {
  const script = /*js*/ `
    const { promise, resolve } = Promise.withResolvers();

    function handlerA() {}
    function handlerB() {
      console.log("handlerB fired");
      resolve();
    }

    process.on("SIGUSR2", handlerA);
    process.off("SIGUSR2", handlerA);
    process.on("SIGUSR2", handlerB);

    process.kill(process.pid, "SIGUSR2");
    await promise;
    console.log("done");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
"handlerB fired
done"
`);
  expect(exitCode).toBe(0);
});

// On Linux, JSC suspends and resumes threads with SIGPWR and keeps the sigaction for the process
// lifetime. Every other SIGPWR is an ordinary signal: it runs the listeners or terminates.
describe.skipIf(!isLinux)("SIGPWR", () => {
  const SIGPWR = constants.signals.SIGPWR;

  // The serial tests keep the concurrent groups small: several debug builds that start at once
  // starve each other. A test that times out inside a concurrent group does not dispose its child.
  const children: Subprocess[] = [];
  afterAll(() => {
    for (const child of children) child.kill("SIGKILL");
  });

  function spawn(script: string, env: Record<string, string> = {}) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    children.push(proc);
    return proc;
  }

  async function run(script: string, env?: Record<string, string>) {
    await using proc = spawn(script, env);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  const exitedCleanly = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signalCode: null });
  const killedBySIGPWR = { stdout: "", stderr: "", exitCode: 128 + SIGPWR, signalCode: "SIGPWR" };

  test.concurrent.each([SIGPWR, "SIGPWR"])("process.kill(process.pid, %p) runs the listener", async signal => {
    const script = /*js*/ `
      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGPWR", (name, number) => {
        console.log("listener", name, number);
        resolve();
      });
      process.kill(process.pid, ${JSON.stringify(signal)});
      await promise;
      console.log("alive");
    `;
    expect(await run(script)).toEqual(exitedCleanly(`listener SIGPWR ${SIGPWR}\nalive\n`));
  });

  test("SIGPWR without a listener terminates the process, as in Node", async () => {
    const script = /*js*/ `
      process.kill(process.pid, ${SIGPWR});
      await new Promise(() => {});
    `;
    expect(await run(script)).toEqual(killedBySIGPWR);
  });

  // The main thread's tid is the pid.
  function tgkill(pid: number, signal: number) {
    const libc = dlopen(libcPathForDlopen(), { syscall: { args: ["i64", "i32", "i32", "i32"], returns: "i64" } });
    try {
      const SYS_tgkill = process.arch === "x64" ? 234 : 131;
      expect(libc.symbols.syscall(SYS_tgkill, pid, pid, signal)).toBe(0n);
    } finally {
      libc.close();
    }
  }

  test.concurrent.each([
    ["process.kill(pid, SIGPWR)", (proc: Subprocess) => void process.kill(proc.pid, SIGPWR)],
    ['subprocess.kill("SIGPWR")', (proc: Subprocess) => proc.kill("SIGPWR")],
    // SI_TKILL, like JSC's own pthread_kill. Only si_pid shows that JSC did not send it.
    ["tgkill(2)", (proc: Subprocess) => tgkill(proc.pid, SIGPWR)],
  ])("%s from another process runs the listener", async (_, send) => {
    const script = /*js*/ `
      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGPWR", (name, number) => {
        console.log("listener", name, number);
        resolve();
      });
      console.log("ready");
      await promise;
      console.log("alive");
    `;
    await using proc = spawn(script);
    const stderrText = proc.stderr.text();
    const decoder = new TextDecoder();
    let stdout = "";
    let sent = false;
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      if (!sent && stdout.includes("ready\n")) {
        sent = true;
        send(proc);
      }
    }
    const [stderr, exitCode] = await Promise.all([stderrText, proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual(
      exitedCleanly(`ready\nlistener SIGPWR ${SIGPWR}\nalive\n`),
    );
  });

  test("a listener does not change the sigaction that JSC depends on", async () => {
    const script = /*js*/ `
      import { dlopen, ptr } from "bun:ffi";
      const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, {
        sigaction: { args: ["i32", "ptr", "ptr"], returns: "i32" },
      });
      // glibc and musl: the handler is at 0, sa_mask at 8 (the kernel fills 8 bytes), sa_flags at 136.
      function sigaction() {
        const action = Buffer.alloc(256);
        if (libc.symbols.sigaction(${SIGPWR}, null, ptr(action)) !== 0) throw new Error("sigaction failed");
        return action.toString("hex", 0, 16) + action.toString("hex", 136, 140);
      }
      const initial = sigaction();
      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGPWR", resolve);
      const withListener = sigaction();
      process.kill(process.pid, ${SIGPWR});
      await promise;
      process.off("SIGPWR", resolve);
      const withoutListener = sigaction();
      console.log(JSON.stringify({ withListener: withListener === initial, withoutListener: withoutListener === initial }));
    `;
    expect(await run(script)).toEqual(exitedCleanly(`{"withListener":true,"withoutListener":true}\n`));
  });

  test.concurrent.each([
    [
      "process.off",
      /*js*/ `
        const listener = () => {};
        process.on("SIGPWR", listener);
        process.off("SIGPWR", listener);
        process.kill(process.pid, ${SIGPWR});
        await new Promise(() => {});
      `,
      "",
    ],
    [
      // What signal-exit does. The write is synchronous because the process dies in the listener.
      "a once listener that sends the signal again",
      /*js*/ `
        import { writeSync } from "node:fs";
        process.once("SIGPWR", () => {
          writeSync(1, "listener\\n");
          process.kill(process.pid, ${SIGPWR});
        });
        process.kill(process.pid, ${SIGPWR});
        await new Promise(() => {});
      `,
      "listener\n",
    ],
  ])("the default action applies again after %s", async (_, script, stdout) => {
    expect(await run(script)).toEqual({ ...killedBySIGPWR, stdout });
  });

  // BUN_JSC_collectContinuously keeps JSC's own SIGPWR deliveries going (which threads it suspends
  // depends on the build). The loop cannot finish unless those still reach JSC while the ones from
  // kill(2) reach the listener.
  test("JSC still suspends and resumes threads while a listener is installed", async () => {
    const iterations = isDebug || isASAN ? 5 : 50;
    const script = /*js*/ `
      let calls = 0;
      let onCall;
      process.on("SIGPWR", () => {
        calls++;
        onCall();
      });
      for (let i = 0; i < ${iterations}; i++) {
        const garbage = [];
        for (let j = 0; j < 200; j++) garbage.push({ j, text: Buffer.alloc(64, "a").toString() });
        Bun.gc(true);
        const { promise, resolve } = Promise.withResolvers();
        onCall = resolve;
        process.kill(process.pid, ${SIGPWR});
        await promise;
      }
      console.log(calls);
    `;
    expect(await run(script, { BUN_JSC_collectContinuously: "1" })).toEqual(exitedCleanly(`${iterations}\n`));
  });
});
