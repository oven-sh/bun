import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/29194
//
// `signal-exit` (and other libraries) monkey-patch `process.emit` to
// observe lifecycle events. Node dispatches the `exit` and `beforeExit`
// events by looking up `emit` on the process object at call time, so
// any user override is honored. Bun previously walked its internal
// listener list directly, bypassing patched `process.emit` and leaving
// those libraries silent during shutdown.
//
// These tests spawn a child that monkey-patches `process.emit` before
// installing listeners and asserts the monkey-patch observes both
// `beforeExit` and `exit`.

test("process.emit override is invoked for natural shutdown 'exit'", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const origEmit = process.emit;
        const seen = [];
        process.emit = function (event, ...args) {
          seen.push(event);
          return origEmit.call(this, event, ...args);
        };
        process.on("exit", () => {
          console.log(JSON.stringify(seen));
        });
      `,
    ],
    env: bunEnv,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const seen = JSON.parse(stdout.trim());
  expect(seen).toContain("exit");
  expect(seen).toContain("beforeExit");
  expect(exitCode).toBe(0);
});

test("process.emit override is invoked for explicit process.exit(code)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const origEmit = process.emit;
        const seen = [];
        process.emit = function (event, ...args) {
          seen.push({ event, args });
          return origEmit.call(this, event, ...args);
        };
        process.on("exit", (code) => {
          process.stdout.write(JSON.stringify(seen.filter(x => x.event === "exit")) + "\\n");
        });
        process.exit(7);
      `,
    ],
    env: bunEnv,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual([{ event: "exit", args: [7] }]);
  expect(exitCode).toBe(7);
});

test("signal-exit-style wrapper observes exit event", async () => {
  // Mirrors signal-exit's approach: replace process.emit with a wrapper
  // that intercepts 'exit', forwards to the original emit, and runs a
  // callback. This is exactly the pattern the bug breaks.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let ranOnExit = false;
        const origEmit = process.emit;
        process.emit = function (event, ...args) {
          if (event === "exit") {
            ranOnExit = true;
          }
          return origEmit.call(this, event, ...args);
        };
        process.on("exit", () => {
          process.stdout.write("ranOnExit=" + ranOnExit + "\\n");
        });
      `,
    ],
    env: bunEnv,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ranOnExit=true");
  expect(exitCode).toBe(0);
});
