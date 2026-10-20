import { describe, expect, test } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows, libcPathForDlopen, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";

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

// The last listener of a signal goes away while another handler has the signal: here the one
// that `Bun.openInEditor` installs to send signals on to the editor. That disposition is not
// ours, so it must stay as it is. It used to be installed again with signal(), which drops the
// flags of the handler (SA_SIGINFO).
test.skipIf(!isLinux && !isMacOS)(
  "removing the last signal listener leaves a disposition that is not ours as it is",
  async () => {
    using dir = tempDir("signal-disposition-not-ours", {
      // The editor. It ends when its stdin does.
      "bin/subl": "#!/bin/sh\nexec cat\n",
      "main.js": /*js*/ `
        const { dlopen, ptr } = require("bun:ffi");
        const libc = dlopen(process.env.LIBC_PATH, { sigaction: { args: ["i32", "ptr", "ptr"], returns: "i32" } });
        const SIGINT = 2;
        // struct sigaction: the handler is first, sa_flags is at this offset.
        const flagsOffset = process.platform === "linux" ? 136 : 12;
        function disposition() {
          const action = new Uint8Array(256);
          if (libc.symbols.sigaction(SIGINT, null, ptr(action)) !== 0) throw new Error("sigaction failed");
          const view = new DataView(action.buffer);
          return view.getBigUint64(0, true).toString(16) + " flags " + view.getUint32(flagsOffset, true).toString(16);
        }

        const listener = () => {};
        process.on("SIGINT", listener);
        const ours = disposition();
        Bun.openInEditor(__filename, { editor: "subl" });
        // The editor starts on another thread.
        while (disposition() === ours) await Bun.sleep(1);
        const theirs = disposition();
        process.off("SIGINT", listener);
        console.log(disposition() === theirs ? "unchanged" : "changed");
        process.exit(0);
      `,
    });
    chmodSync(join(String(dir), "bin", "subl"), 0o755);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`, LIBC_PATH: libcPathForDlopen() },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    proc.stdin.end();

    expect(stderr).toBe("");
    expect(stdout).toBe("unchanged\n");
    expect(exitCode).toBe(0);
  },
);
