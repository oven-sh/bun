import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

it("process.nextTick() runs its callback, before the promise jobs", async () => {
  const order = [];
  const schedule = new ShadowRealm().evaluate(`log => {
    Promise.resolve().then(() => log("job"));
    process.nextTick((a, b) => log("tick " + a + b), 1, 2);
  }`);
  schedule(entry => void order.push(entry));
  await new Promise(resolve => setImmediate(resolve));
  expect(order).toEqual(["tick 12", "job"]);
});

it("process.nextTick() throws a TypeError of the realm for what is not a function", () => {
  const thrown = new ShadowRealm().evaluate(`
    try {
      process.nextTick(1);
    } catch (error) {
      [error instanceof TypeError, error.code].join();
    }`);
  expect(thrown).toBe("true,ERR_INVALID_ARG_TYPE");
});

async function run(script) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

it.concurrent("an error thrown by a process.nextTick() callback is uncaught", async () => {
  expect(
    await run(`
      process.on("uncaughtException", error => console.log("uncaughtException:", error.message));
      new ShadowRealm().evaluate('process.nextTick(() => { throw new Error("from the realm"); })');`),
  ).toEqual({ stdout: "uncaughtException: from the realm\n", stderr: "", exitCode: 0 });
});

it.concurrent("an unhandled rejection reaches process.on('unhandledRejection')", async () => {
  expect(
    await run(`
      process.on("unhandledRejection", reason => console.log("unhandledRejection:", reason.message));
      new ShadowRealm().evaluate('Promise.reject(new Error("from the realm")); 0');`),
  ).toEqual({ stdout: "unhandledRejection: from the realm\n", stderr: "", exitCode: 0 });
});

it.concurrent("an unhandled rejection ends the process", async () => {
  const { stdout, stderr, exitCode } = await run(`
    new ShadowRealm().evaluate('Promise.reject(new Error("from the realm")); 0');
    setTimeout(() => console.log("still running"), 0);`);
  expect(stderr).toContain("error: from the realm");
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

it.concurrent("rejected promises are collected", async () => {
  expect(
    await run(`
      const { heapStats } = require("bun:jsc");
      const promises = () => (Bun.gc(true), heapStats().objectTypeCounts.Promise ?? 0);
      process.on("unhandledRejection", () => {});
      const reject = new ShadowRealm().evaluate("() => { for (let i = 0; i < 1000; i++) Promise.reject(i); }");
      setImmediate(() => {
        const before = promises();
        reject();
        setImmediate(() => console.log(promises() - before));
      });`),
  ).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
});

it("Bun.isMainThread and node:worker_threads say which thread the realm is on", async () => {
  expect(new ShadowRealm().evaluate("Bun.isMainThread")).toBe(true);
  expect(await new ShadowRealm().importValue("node:worker_threads", "isMainThread")).toBe(true);

  const url = URL.createObjectURL(new Blob([`postMessage(new ShadowRealm().evaluate("Bun.isMainThread"));`]));
  const worker = new Worker(url);
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    worker.onmessage = event => resolve(event.data);
    worker.onerror = reject;
    expect(await promise).toBe(false);
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});
