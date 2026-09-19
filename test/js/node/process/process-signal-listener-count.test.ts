import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, normalizeBunSnapshot } from "harness";
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

// A signal number can have several names: SIGIOT is SIGABRT, and on Linux SIGPOLL is SIGIO.
// Node starts one watcher per event name. One delivery runs the listeners of every name of the number,
// and the number keeps its OS handler until no name has a listener.
describe.concurrent("signal names", () => {
  type Scenario = { sent: string; events: string[]; removed?: string[]; late?: string[] };

  // The child adds a listener for each of `events` and sends `sent` to itself.
  // It prints every listener call as [event, name argument, number argument].
  // `removed`: names that get a listener which is removed again before the signal.
  // `late`: names that get a listener from inside the listeners of `events`.
  async function run({ sent, events, removed = [], late = [] }: Scenario) {
    const script = /*js*/ `
      const calls = [];
      for (const event of ${JSON.stringify(events)}) {
        process.on(event, (name, number) => {
          calls.push([event, name, number]);
          for (const lateEvent of ${JSON.stringify(late)}) process.on(lateEvent, () => calls.push([lateEvent, "late"]));
        });
      }
      const removed = ${JSON.stringify(removed)}.map(event => {
        const listener = () => calls.push([event, "removed"]);
        process.on(event, listener);
        return [event, listener];
      });
      for (const [event, listener] of removed) process.off(event, listener);

      // Node exits with a signal pending when nothing else keeps the loop alive.
      // The timer also ends a child whose SIGUSR2 listener never runs.
      const keepAlive = setTimeout(() => {}, 60_000);
      // process.kill on the own pid runs the OS handler before it returns, and the numbers queue in order.
      // So the SIGUSR2 listener runs after the listeners of the signal under test.
      process.on("SIGUSR2", () => {
        clearTimeout(keepAlive);
        console.log(JSON.stringify(calls.sort()));
      });
      process.kill(process.pid, ${JSON.stringify(sent)});
      process.kill(process.pid, "SIGUSR2");
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

  const listenersRan = (events: string[], number: number) => ({
    stdout: JSON.stringify(events.map(event => [event, event, number]).sort()) + "\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });

  const linuxOnlySignals: [name: string, number: number][] = [
    ["SIGSTKFLT", 16],
    ["SIGPOLL", 29],
  ];
  const signalAliases: [signal: string, alias: string, number: number][] = [["SIGABRT", "SIGIOT", 6]];
  if (isLinux) signalAliases.push(["SIGIO", "SIGPOLL", 29]);
  // glibc has no SIGUNUSED. On musl and bionic it is another name for SIGSYS.
  if ("SIGUNUSED" in constants.signals) {
    linuxOnlySignals.push(["SIGUNUSED", 31]);
    signalAliases.push(["SIGSYS", "SIGUNUSED", 31]);
  }
  const linuxOnlyNames = linuxOnlySignals.map(([name]) => name);

  test.skipIf(!isLinux)(`process.kill knows ${linuxOnlyNames.join(", ")}`, () => {
    // Linux pids stay below 2 ** 22, so kill(2) fails with ESRCH.
    // An unknown name throws ERR_UNKNOWN_SIGNAL before kill(2).
    const codes = linuxOnlyNames.map(name => {
      try {
        process.kill(2147483640, name);
        return [name, null];
      } catch (e: any) {
        return [name, e.code];
      }
    });
    expect(codes).toEqual(linuxOnlyNames.map(name => [name, "ESRCH"]));
  });

  test.skipIf(!isLinux).each(linuxOnlySignals)("process.on(%p) listens for signal %d", async (name, number) => {
    expect(await run({ sent: name, events: [name] })).toEqual(listenersRan([name], number));
  });

  // Windows has no signal number with two names.
  describe.skipIf(isWindows).each(signalAliases)("%s and %s", (signal, alias, number) => {
    test.each([
      [signal, [alias]],
      [alias, [signal]],
      [signal, [signal, alias]],
    ])("sending %s runs the listeners of %p", async (sent, events) => {
      expect(await run({ sent, events })).toEqual(listenersRan(events, number));
    });

    test.each([
      [signal, alias],
      [alias, signal],
    ])("removing the %s listener keeps the handler for the %s listener", async (removed, kept) => {
      expect(await run({ sent: removed, events: [kept], removed: [removed] })).toEqual(listenersRan([kept], number));
    });

    // Node has no watcher for the second name when the signal arrives.
    test(`a ${alias} listener that a ${signal} listener adds does not run for that delivery`, async () => {
      expect(await run({ sent: signal, events: [signal], late: [alias] })).toEqual(listenersRan([signal], number));
    });
  });

  // SIGPOLL exists on Linux only. SIGIO, unlike SIGABRT, terminates without a core dump, which CI reports as a crash.
  test.skipIf(!isLinux)("removing the SIGIO and SIGPOLL listeners restores the default action", async () => {
    expect(await run({ sent: "SIGPOLL", events: [], removed: ["SIGIO", "SIGPOLL"] })).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 128 + 29,
      signalCode: "SIGIO",
    });
  });
});
