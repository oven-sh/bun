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

test.concurrent("a non-Domain process.domain does not mask the original error in the fatal path", async () => {
  const r = await run(`require("domain"); process.domain = {}; setTimeout(() => { throw new Error("boom") }, 0)`);
  expect(r.stderr).toContain("boom");
  expect(r.stderr).not.toContain("listenerCount");
  expect(r.exitCode).toBe(1);
});

test.concurrent("a non-Domain process.domain is never pushed onto the stack by an async pairing", async () => {
  const r = await run(`
    const domain = require("domain");
    process.domain = { foo: 1 };
    setTimeout(() => {
      const d = domain.create();
      d.on("error", () => { throw new Error("from handler"); });
      d.run(() => { throw new Error("boom"); });
    }, 0);
  `);
  expect(r.stderr).toContain("from handler");
  expect(r.stderr).not.toContain("_errorHandler is not a function");
  expect(r.exitCode).toBe(7);
});

test.concurrent("a non-Domain process.domain is never assigned to a new EventEmitter by init", async () => {
  const r = await run(`
    require("domain");
    process.domain = { foo: 1 };
    const ee = new (require("events"))();
    ee.on("data", () => console.log("ok"));
    ee.emit("data");
    ee.emit("error", new Error("boom"));
  `);
  expect(r.stdout.trim()).toBe("ok");
  expect(r.stderr).toContain("boom");
  expect(r.stderr).not.toContain("enter is not a function");
  expect(r.stderr).not.toContain("emit is not a function");
  expect(r.exitCode).toBe(1);
});

test.concurrent("a null entry in a userland-assigned _stack does not mask the original error", async () => {
  const r = await run(`
    const domain = require("domain");
    const d = domain.create();
    d.on("error", e => console.log("caught:" + e.message));
    d.enter();
    domain._stack = [null, d];
    setTimeout(() => { throw new Error("boom") }, 0);
  `);
  expect(r.stdout.trim()).toBe("caught:boom");
  expect(r.stderr).not.toContain("listenerCount");
  expect(r.exitCode).toBe(0);
});

test.concurrent(
  "patching AsyncLocalStorage.prototype.getStore after loading node:domain does not hijack domain error routing",
  async () => {
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
  },
);

test.concurrent("an unbalanced enter() does not leak the previous stack into later callbacks", async () => {
  const r = await run(`
    const domain = require("domain");
    const d1 = domain.create(); const d2 = domain.create();
    d1.on("error", e => console.log("d1-handled:" + e.message));
    d1.run(() => setTimeout(function A() {
      d2.enter();
      setTimeout(function B() {
        console.log("stack:" + domain._stack.map(d => d === d1 ? "d1" : "d2").join(","));
        throw new Error("boom");
      }, 1);
    }, 1));
  `);
  expect(r.stdout.trim()).toBe("stack:d2");
  expect(r.stderr).toContain("boom");
  expect(r.exitCode).toBe(1);
});

test.concurrent("_errorHandler terminates when the domain is active via the process.domain setter only", async () => {
  // The setter activates d without pushing it, so exit() is a no-op; the
  // unwind loop in _errorHandler used to spin forever here. Node emits and
  // returns true.
  const r = await run(`
    const domain = require("domain");
    const d = domain.create();
    d.on("error", e => console.log("error-listener:" + e.message));
    process.domain = d;
    console.log("result:" + d._errorHandler(new Error("boom")));
  `);
  expect(r.stdout.trim().split("\n")).toEqual(["error-listener:boom", "result:true"]);
  expect(r.exitCode).toBe(0);
});

test.concurrent(
  "child domain added to a parent routes error to the parent's listener without falling through to uncaughtException",
  async () => {
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
  },
);

test.concurrent(
  "process.domain / exports._stack / exports.active accessors are configurable (matches Node)",
  async () => {
    const r = await run(
      `const d = require("domain");
     console.log(
       Object.getOwnPropertyDescriptor(process, "domain").configurable,
       Object.getOwnPropertyDescriptor(d, "_stack").configurable,
       Object.getOwnPropertyDescriptor(d, "active").configurable,
     );`,
    );
    expect(r.stdout.trim()).toBe("true true true");
    expect(r.exitCode).toBe(0);
  },
);

test.concurrent(
  "a domain with an 'error' listener claims the error while a capture callback is installed",
  async () => {
    const r = await run(`
    const domain = require("domain");
    process.setUncaughtExceptionCaptureCallback(er => console.log("captureFn:" + er.message));
    const d = domain.create();
    d.on("error", er => console.log("domain:" + er.message));
    d.run(() => { process.nextTick(() => { throw new Error("boom"); }); });
  `);
    expect(r.stdout.trim()).toBe("domain:boom");
    expect(r.exitCode).toBe(0);
  },
);

test.concurrent("Worker: throwing domain error handler emits parent 'error' and exits 1", async () => {
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

test.concurrent("Worker: throwing capture callback emits parent 'error' and exits 1", async () => {
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

test.concurrent("EventEmitter constructed with captureRejections has no own emit property", async () => {
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
