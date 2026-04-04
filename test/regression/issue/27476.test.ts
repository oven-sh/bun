import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/27476
// `typeof self` should be "undefined" on the main thread (Node.js compat).
// Many libraries use `typeof self !== "undefined"` to detect a browser environment.

test("typeof self is undefined on the main thread", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof self)"],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("self is not in globalThis on the main thread", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'console.log("self" in globalThis)'],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("false");
  expect(exitCode).toBe(0);
});

test("browser detection pattern returns false on the main thread", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const isBrowser = typeof window < "u" || typeof self < "u"; console.log(isBrowser);`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("false");
  expect(exitCode).toBe(0);
});

test("self is defined in a Worker context", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const worker = new Worker(new URL("data:text/javascript," + encodeURIComponent('postMessage(typeof self)')), { type: "module" });
      worker.onmessage = (e) => {
        console.log(e.data);
        worker.terminate();
      };
      `,
    ],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("object");
  expect(exitCode).toBe(0);
});

test("self equals globalThis in a Worker context", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const worker = new Worker(new URL("data:text/javascript," + encodeURIComponent('postMessage(self === globalThis)')), { type: "module" });
      worker.onmessage = (e) => {
        console.log(e.data);
        worker.terminate();
      };
      `,
    ],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("true");
  expect(exitCode).toBe(0);
});
