import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";
import { Worker } from "node:worker_threads";

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

// SIGKILL and SIGSTOP cannot be caught, so Node rejects them at registration
// time with the EINVAL that uv_signal_start() returns, and adds no listener.
test.skipIf(isWindows)("listening for SIGKILL or SIGSTOP throws EINVAL and registers nothing", async () => {
  const script = /*js*/ `
    const probe = (sig, method) => {
      try {
        process[method](sig, () => {});
        return { registered: true, listenerCount: process.listenerCount(sig) };
      } catch (e) {
        return {
          name: e.name,
          message: e.message,
          code: e.code,
          errno: e.errno,
          syscall: e.syscall,
          listenerCount: process.listenerCount(sig),
        };
      } finally {
        process.removeAllListeners(sig);
      }
    };

    const result = {};
    for (const sig of ["SIGKILL", "SIGSTOP"]) {
      for (const method of ["on", "addListener", "once", "prependListener", "prependOnceListener"]) {
        result[sig + "." + method] = probe(sig, method);
      }
    }
    result["SIGUSR2.on"] = probe("SIGUSR2", "on");

    // A Symbol is never a signal name, even when its description reads like one.
    result["Symbol(SIGKILL).on"] = probe(Symbol("SIGKILL"), "on");
    result["Symbol(SIGSTOP).on"] = probe(Symbol("SIGSTOP"), "on");

    console.log(JSON.stringify(result));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // EINVAL is 22 on every platform Bun builds for; libuv reports it negated.
  const einval = {
    name: "Error",
    message: "uv_signal_start EINVAL",
    code: "EINVAL",
    errno: -22,
    syscall: "uv_signal_start",
    listenerCount: 0,
  };
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "SIGKILL.on": einval,
    "SIGKILL.addListener": einval,
    "SIGKILL.once": einval,
    "SIGKILL.prependListener": einval,
    "SIGKILL.prependOnceListener": einval,
    "SIGSTOP.on": einval,
    "SIGSTOP.addListener": einval,
    "SIGSTOP.once": einval,
    "SIGSTOP.prependListener": einval,
    "SIGSTOP.prependOnceListener": einval,
    "SIGUSR2.on": { registered: true, listenerCount: 1 },
    "Symbol(SIGKILL).on": { registered: true, listenerCount: 1 },
    "Symbol(SIGSTOP).on": { registered: true, listenerCount: 1 },
  });
  expect(exitCode).toBe(0);
});

// An Identifier for a Symbol hashes and compares by its description, so
// Symbol("SIGUSR2") used to match the signal-name map and install a real OS
// handler. Node treats it as an ordinary event and lets SIGUSR2 kill us.
test.skipIf(isWindows)("a Symbol whose description is a signal name installs no handler", async () => {
  const script = /*js*/ `
    process.on(Symbol("SIGUSR2"), () => {});

    // Never reached: the default SIGUSR2 action terminates the process. Exists
    // only so a missing handler-install shows up as 42 rather than a clean exit.
    setTimeout(() => process.exit(42), 1000);

    process.kill(process.pid, "SIGUSR2");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
  expect(proc.signalCode).toBe("SIGUSR2");
  expect(exitCode).not.toBe(42);
});

// Node only starts signal watchers on the main thread, so inside a worker
// process.on("SIGKILL") is an ordinary event listener and does not throw.
test.skipIf(isWindows)("listening for SIGKILL inside a worker does not throw", async () => {
  const source = /*js*/ `
    const { parentPort } = require("node:worker_threads");
    try {
      process.on("SIGKILL", () => {});
      parentPort.postMessage({ registered: true, listenerCount: process.listenerCount("SIGKILL") });
    } catch (e) {
      parentPort.postMessage({ threw: e.message });
    }
  `;

  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const worker = new Worker(source, { eval: true });
  worker.on("message", resolve);
  worker.on("error", reject);
  worker.on("exit", code => reject(new Error(`worker exited with code ${code} before posting a message`)));

  try {
    expect(await promise).toEqual({ registered: true, listenerCount: 1 });
  } finally {
    await worker.terminate();
  }
});
