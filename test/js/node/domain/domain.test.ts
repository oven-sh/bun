// Bun-specific node:domain tests that are not upstream Node tests.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function run(
  src: string,
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number | null; signalCode: string | null }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...extraArgs, "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test("a non-Domain process.domain does not mask the original error in the fatal path", async () => {
  // Regression: fatalErrorDispatch pushed the raw process.domain value and
  // called .listenerCount on it, so `require('domain'); process.domain = {};
  // throw err` exited 7 with a TypeError instead of 1 with the original.
  const r = await run(`require("domain"); process.domain = {}; setTimeout(() => { throw new Error("boom") }, 0)`);
  expect(r.stderr).toContain("boom");
  expect(r.stderr).not.toContain("listenerCount");
  expect(r.exitCode).toBe(1);
});

test("patching AsyncLocalStorage.prototype.getStore after loading node:domain does not hijack domain error routing", async () => {
  const r = await run(`
    const domain = require("domain");
    const { AsyncLocalStorage } = require("async_hooks");
    const d = domain.create();
    d.on("error", er => { console.log("caught:" + er.message); });
    AsyncLocalStorage.prototype.getStore = function () { throw new Error("hijacked"); };
    d.run(() => setTimeout(() => { throw new Error("boom") }, 0));
  `);
  expect(r.stdout.trim()).toBe("caught:boom");
  expect(r.exitCode).toBe(0);
});

test("child domain added to a parent routes error to the parent's listener without falling through to uncaughtException", async () => {
  const r = await run(`
    const domain = require("domain");
    const parent = domain.create();
    parent.on("error", e => console.log("parent-handled:" + e.message));
    const child = domain.create();
    parent.add(child);
    process.on("uncaughtException", e => console.log("UNCAUGHT:" + e.message));
    parent.run(() => child.run(() => { throw new Error("boom"); }));
  `);
  expect(r.stdout.trim()).toBe("parent-handled:boom");
  expect(r.exitCode).toBe(0);
});

test("process.domain accessor is configurable (matches Node)", async () => {
  const r = await run(
    `require("domain"); console.log(Object.getOwnPropertyDescriptor(process, "domain").configurable)`,
  );
  expect(r.stdout.trim()).toBe("true");
  expect(r.exitCode).toBe(0);
});

test("Worker: throwing domain error handler emits parent 'error' and exits 1", async () => {
  // Node's workerOnGlobalUncaughtException catches, posts the handler's
  // error to the parent, and exits with kGenericUserError (1) — not 7.
  const r = await run(`
    const { Worker } = require("worker_threads");
    const w = new Worker(
      \`const d = require("domain").create();
       d.on("error", () => { throw new Error("from handler") });
       d.run(() => process.nextTick(() => { throw new Error("original") }));\`,
      { eval: true },
    );
    let sawError = false;
    w.on("error", e => { sawError = true; console.log("error:" + e.message); });
    w.on("exit", code => { console.log("exit:" + code + ":" + sawError); });
  `);
  expect(r.stdout.trim().split("\n")).toEqual(["error:from handler", "exit:1:true"]);
  expect(r.exitCode).toBe(0);
});

test("Worker: throwing capture callback emits parent 'error' and exits 1", async () => {
  const r = await run(`
    const { Worker } = require("worker_threads");
    const w = new Worker(
      \`process.setUncaughtExceptionCaptureCallback(() => { throw new Error("from capture") });
       process.nextTick(() => { throw new Error("original") });\`,
      { eval: true },
    );
    let sawError = false;
    w.on("error", e => { sawError = true; console.log("error:" + e.message); });
    w.on("exit", code => { console.log("exit:" + code + ":" + sawError); });
  `);
  expect(r.stdout.trim().split("\n")).toEqual(["error:from capture", "exit:1:true"]);
  expect(r.exitCode).toBe(0);
});

test("EventEmitter constructed with captureRejections has no own emit property", async () => {
  // events.ts previously installed an own-property emit for
  // captureRejections; that shadowed domain's prototype override and forced
  // per-instance re-wrapping in domain.ts. Now init only flips kCapture.
  const r = await run(`
    const EE = require("events");
    const e = new EE({ captureRejections: true });
    console.log("own-emit=" + Object.hasOwn(e, "emit"));
    e.on("x", async () => { throw new Error("boom") });
    e.on("error", er => console.log("caught:" + er.message));
    e.emit("x");
    setTimeout(() => {}, 10);
  `);
  expect(r.stdout.trim().split("\n")).toEqual(["own-emit=false", "caught:boom"]);
  expect(r.exitCode).toBe(0);
});

// Node routes unhandled rejections to domain 'error' via promiseInfo.domain
// (captured at reject time in lib/internal/process/promises.js), independent
// of the uncaught-exception capture callback. Bun does not implement this
// yet — the .todo tests below make the gap visible in CI and pin the target
// behaviour once it lands.
describe("unhandled-rejections × domain (promiseInfo.domain)", () => {
  for (const mode of ["strict", "throw", "warn", "warn-with-error-code", "none"] as const) {
    test.todo(`--unhandled-rejections=${mode}: rejection inside d.run() is delivered to domain 'error'`, async () => {
      const r = await run(
        `
        const d = require("domain").create();
        d.on("error", er => { console.log("domain:" + er.message); process.exit(0); });
        d.run(() => Promise.reject(new Error("boom")));
      `,
        [`--unhandled-rejections=${mode}`],
      );
      expect(r.stdout.trim()).toBe("domain:boom");
      expect(r.exitCode).toBe(0);
    });
  }
});
