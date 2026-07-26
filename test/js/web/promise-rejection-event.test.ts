import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("PromiseRejectionEvent", () => {
  test("is a global constructor", () => {
    expect(typeof PromiseRejectionEvent).toBe("function");
    expect(PromiseRejectionEvent.name).toBe("PromiseRejectionEvent");
    expect(Object.getPrototypeOf(PromiseRejectionEvent.prototype)).toBe(Event.prototype);
  });

  test("global on* event handler attributes exist", () => {
    expect("onunhandledrejection" in globalThis).toBe(true);
    expect("onrejectionhandled" in globalThis).toBe(true);
  });

  test("constructor", () => {
    const p = Promise.resolve(1);
    const err = new Error("boom");
    const e = new PromiseRejectionEvent("unhandledrejection", {
      promise: p,
      reason: err,
      cancelable: true,
    });
    expect(e instanceof Event).toBe(true);
    expect(e instanceof PromiseRejectionEvent).toBe(true);
    expect(e.type).toBe("unhandledrejection");
    expect(e.cancelable).toBe(true);
    expect(e.bubbles).toBe(false);
    expect(e.promise).toBe(p);
    expect(e.reason).toBe(err);
    expect(e.isTrusted).toBe(false);
  });

  test("constructor defaults reason to undefined", () => {
    const p = Promise.resolve(1);
    const e = new PromiseRejectionEvent("rejectionhandled", { promise: p });
    expect(e.reason).toBeUndefined();
    expect(e.cancelable).toBe(false);
  });

  test("constructor wraps a non-Promise promise member in a Promise", async () => {
    // @ts-expect-error
    const e = new PromiseRejectionEvent("x", { promise: 42 });
    expect(e.promise).toBeInstanceOf(Promise);
    expect(await e.promise).toBe(42);
  });

  test("constructor requires promise", () => {
    expect(() => new PromiseRejectionEvent("x")).toThrow(TypeError);
    // @ts-expect-error
    expect(() => new PromiseRejectionEvent("x", {})).toThrow(TypeError);
    // @ts-expect-error
    expect(() => new PromiseRejectionEvent("x", { reason: 1 })).toThrow(TypeError);
  });

  test("dispatched via globalThis.dispatchEvent", () => {
    let received: PromiseRejectionEvent | undefined;
    const listener = (e: PromiseRejectionEvent) => (received = e);
    addEventListener("unhandledrejection", listener);
    try {
      const p = Promise.resolve(1);
      globalThis.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: p, reason: "r" }));
      expect(received).toBeInstanceOf(PromiseRejectionEvent);
      expect(received!.promise).toBe(p);
      expect(received!.reason).toBe("r");
    } finally {
      removeEventListener("unhandledrejection", listener);
    }
  });
});

describe("unhandledrejection / rejectionhandled dispatch", () => {
  test.concurrent("addEventListener('unhandledrejection') fires with preventDefault", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
let fired;
addEventListener("unhandledrejection", (e) => {
  fired = { ctor: e.constructor.name, type: e.type, cancelable: e.cancelable, trusted: e.isTrusted, reason: e.reason.message, same: e.promise === p };
  e.preventDefault();
});
const p = Promise.reject(new Error("boom"));
setTimeout(() => console.log(JSON.stringify(fired)), 0);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      ctor: "PromiseRejectionEvent",
      type: "unhandledrejection",
      cancelable: true,
      trusted: true,
      reason: "boom",
      same: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("globalThis.onunhandledrejection fires", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
globalThis.onunhandledrejection = (e) => { console.log(e.constructor.name, e.reason); e.preventDefault(); };
Promise.reject("hello");
setTimeout(() => {}, 0);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PromiseRejectionEvent hello");
    expect(exitCode).toBe(0);
  });

  test.concurrent("without preventDefault, the default handler still runs", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
addEventListener("unhandledrejection", (e) => console.log("listener ran"));
Promise.reject(new Error("oops"));
setTimeout(() => {}, 0);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("listener ran");
    expect(stderr).toContain("oops");
    expect(exitCode).toBe(1);
  });

  test.concurrent("web listener fires before process.on('unhandledRejection')", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const order = [];
addEventListener("unhandledrejection", (e) => order.push("web"));
process.on("unhandledRejection", () => order.push("node"));
Promise.reject(new Error("x"));
setTimeout(() => console.log(order.join(",")), 0);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("web,node");
    expect(exitCode).toBe(0);
  });

  test.concurrent("preventDefault skips process.on('unhandledRejection')", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const order = [];
addEventListener("unhandledrejection", (e) => { order.push("web"); e.preventDefault(); });
process.on("unhandledRejection", () => order.push("node"));
Promise.reject(new Error("x"));
setTimeout(() => console.log(order.join(",")), 0);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("web");
    expect(exitCode).toBe(0);
  });

  test.concurrent("addEventListener('rejectionhandled') fires", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const keepAlive = setInterval(() => {}, 1000);
addEventListener("unhandledrejection", (e) => e.preventDefault());
addEventListener("rejectionhandled", (e) => {
  console.log(JSON.stringify({ ctor: e.constructor.name, type: e.type, same: e.promise === p, reason: e.reason.message }));
  clearInterval(keepAlive);
});
const p = Promise.reject(new Error("boom"));
setTimeout(() => p.catch(() => {}), 0);
`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      ctor: "PromiseRejectionEvent",
      type: "rejectionhandled",
      same: true,
      reason: "boom",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("fires inside a Worker", async () => {
    using dir = tempDir("pre-worker", {
      "worker.js": `
self.addEventListener("unhandledrejection", (e) => {
  self.postMessage({ ctor: e.constructor.name, type: e.type, reason: e.reason, has: "onunhandledrejection" in self });
  e.preventDefault();
});
Promise.reject("from-worker");
`,
      "main.js": `
const w = new Worker(new URL("./worker.js", import.meta.url));
w.onmessage = (e) => {
  console.log(JSON.stringify(e.data));
  w.terminate();
};
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      ctor: "PromiseRejectionEvent",
      type: "unhandledrejection",
      reason: "from-worker",
      has: true,
    });
    expect(exitCode).toBe(0);
  });
});
