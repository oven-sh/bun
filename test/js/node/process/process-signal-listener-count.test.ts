import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot } from "harness";

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

// Like node:events, every on() / once() call adds a registration, also for a function that is already registered.
test.skipIf(isWindows)("removing one registration of a function keeps its other registrations", async () => {
  const script = /*js*/ `
    const { promise, resolve } = Promise.withResolvers();
    let calls = 0;
    function handler() {
      console.log("handled", ++calls, "listeners", process.listenerCount("SIGUSR2"));
      if (calls === 2) process.kill(process.pid, "SIGUSR2");
      if (calls === 3) resolve();
    }

    process.once("SIGUSR2", handler);
    process.on("SIGUSR2", handler);
    process.on("SIGUSR2", handler);
    process.off("SIGUSR2", handler);
    console.log("listeners", process.listenerCount("SIGUSR2"));

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
"listeners 2
handled 1 listeners 1
handled 2 listeners 1
handled 3 listeners 1
done"
`);
  expect(exitCode).toBe(0);
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

// Node's watcher for a signal name is an async resource, made with the name's first listener and closed
// with its last. Which store a listener then runs in is in async_hooks/async-context/async-context-process-signal.js,
// which runs under Node too. This is the part only Bun can check: how long the name keeps that store.
test.skipIf(isWindows)(
  "a signal name keeps the AsyncLocalStorage store of its first listener until its last listener is removed",
  async () => {
    const script = /*js*/ `
      const { AsyncLocalStorage } = require("node:async_hooks");
      const als = new AsyncLocalStorage();
      const keepAlive = setInterval(() => {}, 1000);
      let seen = [];
      let wake;
      const record = label => {
        seen.push(label + ":" + als.getStore()?.id);
        wake?.();
      };
      async function deliver(count) {
        seen = [];
        process.kill(process.pid, "SIGUSR2");
        while (seen.length < count) await new Promise(resolve => (wake = resolve));
        return seen;
      }
      function listenUnderFreshStore(id, method = "on") {
        const store = { id };
        const listener = () => record("listener");
        als.run(store, () => process[method]("SIGUSR2", listener));
        return { store: new WeakRef(store), listener };
      }
      const alive = stores => stores.filter(ref => ref.deref() !== undefined).length;
      const out = {};

      const kept = listenUnderFreshStore("kept");
      Bun.gc(true);
      out.whileListening = { alive: alive([kept.store]), seen: await deliver(1) };

      // Every way of removing the name's last listener releases the store.
      const released = [kept.store];
      process.removeListener("SIGUSR2", kept.listener);
      for (const remove of [() => process.removeAllListeners("SIGUSR2"), () => process.removeAllListeners()]) {
        released.push(listenUnderFreshStore("removed").store);
        remove();
      }
      released.push(listenUnderFreshStore("once", "once").store);
      out.once = await deliver(1);
      for (let i = 0; i < 50 && alive(released) > 0; i++) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      out.aliveAfterRemoval = alive(released);

      // A realm that has a Bun.ModuleGraph keeps no store: one delivery runs the listeners of every graph.
      const graph = new Bun.ModuleGraph();
      graph.run(() => als.run({ id: "graph" }, () => process.on("SIGUSR2", () => record("graph"))));
      als.run({ id: "host" }, () => process.on("SIGUSR2", () => record("host")));
      out.withModuleGraph = await deliver(2);
      graph.dispose();

      console.log(JSON.stringify(out));
      process.exit(0);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      whileListening: { alive: 1, seen: ["listener:kept"] },
      once: ["listener:once"],
      aliveAfterRemoval: 0,
      withModuleGraph: ["graph:undefined", "host:undefined"],
    });
    expect(exitCode).toBe(0);
  },
);

// SIGIOT is an alias for SIGABRT. Node starts one watcher per event name, so one signal runs the listeners
// for both names, and the OS handler is only removed once both names have no listeners.
// On Windows, no signal number has two names.
describe.concurrent.skipIf(isWindows)("SIGABRT and SIGIOT", () => {
  // The child adds a listener for each of `events` and sends `sent` to itself.
  // It prints every listener call as [event, name argument, number argument].
  // It also adds a listener for `removed` and removes it before sending the signal.
  async function run({ sent, events, removed }: { sent: string; events: string[]; removed?: string }) {
    const script = /*js*/ `
      const calls = [];
      for (const event of ${JSON.stringify(events)}) {
        process.on(event, (name, number) => calls.push([event, name, number]));
      }
      const removed = ${JSON.stringify(removed)};
      if (removed) {
        const listener = () => calls.push([removed, "removed"]);
        process.on(removed, listener);
        process.off(removed, listener);
      }

      const keepAlive = setTimeout(() => {}, 60_000);
      process.on("SIGUSR2", () => {
        clearTimeout(keepAlive);
        console.log(JSON.stringify(calls.sort()));
      });
      process.kill(process.pid, ${JSON.stringify(sent)});
      // The event loop runs the pending signal's listeners before the immediate.
      setImmediate(() => process.kill(process.pid, "SIGUSR2"));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  const listenersRan = (events: string[]) => ({
    stdout: JSON.stringify(events.map(event => [event, event, 6]).sort()) + "\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });

  test.each([
    ["SIGABRT", ["SIGIOT"]],
    ["SIGIOT", ["SIGABRT"]],
    ["SIGABRT", ["SIGABRT", "SIGIOT"]],
  ])("sending %s runs the listeners for %p", async (sent, events) => {
    expect(await run({ sent, events })).toEqual(listenersRan(events));
  });

  test.each([
    ["SIGABRT", "SIGIOT"],
    ["SIGIOT", "SIGABRT"],
  ])("removing the %s listener keeps the handler for the %s listener", async (removed, kept) => {
    expect(await run({ sent: removed, events: [kept], removed })).toEqual(listenersRan([kept]));
  });
});
