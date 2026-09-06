import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";
import { EventEmitter } from "node:events";

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

// Node's EventEmitter registers the same function again on every on()/once()
// call. One removeListener() then drops one registration, so the signal stays
// handled until the count really reaches zero.
test.concurrent.skipIf(isWindows)("the same function registered twice keeps the handler after one removeListener", async () => {
  const script = /*js*/ `
    const { promise, resolve } = Promise.withResolvers();
    let n = 0;
    function handler() {
      n++;
      console.log("handled", n, "lc=" + process.listenerCount("SIGUSR2"));
      if (n === 2) resolve();
      else process.kill(process.pid, "SIGUSR2");
    }

    process.on("SIGUSR2", handler);
    process.on("SIGUSR2", handler);
    console.log("lc=" + process.listenerCount("SIGUSR2"));
    process.removeListener("SIGUSR2", handler);
    console.log("lc=" + process.listenerCount("SIGUSR2"));

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
"lc=2
lc=1
handled 1 lc=1
handled 2 lc=1
done"
`);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

// once() followed by on() with the same function: the once() registration goes
// away when it fires, the on() registration stays and handles later signals.
test.concurrent.skipIf(isWindows)("once() then on() with the same function survives the first signal", async () => {
  const script = /*js*/ `
    const { promise, resolve } = Promise.withResolvers();
    let n = 0;
    function handler() {
      n++;
      console.log("handled", n, "lc=" + process.listenerCount("SIGUSR2"));
      if (n === 3) resolve();
      else if (n === 2) process.kill(process.pid, "SIGUSR2");
    }

    process.once("SIGUSR2", handler);
    process.on("SIGUSR2", handler);
    console.log("ready lc=" + process.listenerCount("SIGUSR2"));

    process.kill(process.pid, "SIGUSR2");
    await promise;
    console.log("done lc=" + process.listenerCount("SIGUSR2"));
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
"ready lc=2
handled 1 lc=1
handled 2 lc=1
handled 3 lc=1
done lc=1"
`);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

describe("process counts listener registrations like node:events", () => {
  const event = "process-signal-listener-count-test-event";

  test("on() twice with one function registers it twice", () => {
    let calls = 0;
    const fn = () => calls++;
    try {
      process.on(event, fn);
      process.on(event, fn);
      expect(process.listenerCount(event)).toBe(2);
      process.emit(event);
      expect(calls).toBe(2);
      process.removeListener(event, fn);
      expect(process.listenerCount(event)).toBe(1);
      process.emit(event);
      expect(calls).toBe(3);
    } finally {
      process.removeAllListeners(event);
    }
  });

  test("prependListener() and once() do not dedupe against an existing registration", () => {
    let calls = 0;
    const fn = () => calls++;
    try {
      process.on(event, fn);
      process.prependListener(event, fn);
      process.once(event, fn);
      process.prependOnceListener(event, fn);
      expect(process.listenerCount(event)).toBe(4);
      process.emit(event);
      expect(calls).toBe(4);
      expect(process.listenerCount(event)).toBe(2);
      process.emit(event);
      expect(calls).toBe(6);
    } finally {
      process.removeAllListeners(event);
    }
  });

  test("once() twice with one function runs it twice, then nothing is left", () => {
    let calls = 0;
    const fn = () => calls++;
    try {
      process.once(event, fn);
      process.once(event, fn);
      expect(process.listenerCount(event)).toBe(2);
      process.emit(event);
      expect(calls).toBe(2);
      expect(process.listenerCount(event)).toBe(0);
      expect(process.emit(event)).toBe(false);
      expect(calls).toBe(2);
    } finally {
      process.removeAllListeners(event);
    }
  });

  test("removeListener() removes the most recently added matching registration", () => {
    const order: string[] = [];
    const fn = () => order.push("fn");
    const other = () => order.push("other");
    try {
      process.once(event, fn);
      process.on(event, other);
      process.on(event, fn);
      // Drops the trailing on(fn); the leading once(fn) stays and fires first.
      process.removeListener(event, fn);
      expect(process.listenerCount(event)).toBe(2);
      process.emit(event);
      expect(order).toEqual(["fn", "other"]);
      expect(process.listenerCount(event)).toBe(1);
      process.emit(event);
      expect(order).toEqual(["fn", "other", "other"]);
    } finally {
      process.removeAllListeners(event);
    }
  });

  test("listenerCount(event, fn) counts only that function", () => {
    const a = () => {};
    const b = () => {};
    try {
      process.on(event, a);
      process.on(event, a);
      process.on(event, b);
      expect([
        process.listenerCount(event),
        process.listenerCount(event, b),
        process.listenerCount(event, a),
        process.listenerCount(event, () => {}),
        process.listenerCount(event, undefined),
        process.listenerCount(event, null),
      ]).toEqual([3, 1, 2, 0, 3, 3]);

      const ee = new EventEmitter();
      ee.on(event, a);
      ee.on(event, a);
      ee.on(event, b);
      expect([ee.listenerCount(event), ee.listenerCount(event, b), ee.listenerCount(event, a)]).toEqual([3, 1, 2]);
    } finally {
      process.removeAllListeners(event);
    }
  });

  test("'exit' listener added twice runs twice", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /*js*/ `
          const onExit = code => console.log("exit listener", code);
          process.on("exit", onExit);
          process.on("exit", onExit);
          console.log("lc=" + process.listenerCount("exit"));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
"lc=2
exit listener 0
exit listener 0"
`);
    expect(exitCode).toBe(0);
  });
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
