import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("PromiseRejectionEvent", () => {
  test("is a global constructor", () => {
    expect(typeof PromiseRejectionEvent).toBe("function");
    expect(PromiseRejectionEvent.name).toBe("PromiseRejectionEvent");
    expect(PromiseRejectionEvent.length).toBe(2);
    expect(Object.getPrototypeOf(PromiseRejectionEvent.prototype)).toBe(Event.prototype);
    expect(Object.prototype.toString.call(new PromiseRejectionEvent("x", { promise: Promise.resolve() }))).toBe(
      "[object PromiseRejectionEvent]",
    );
  });

  test("constructor", () => {
    const p = Promise.resolve(1);
    const err = new Error("boom");
    const e = new PromiseRejectionEvent("unhandledrejection", { promise: p, reason: err, cancelable: true });
    expect(e).toBeInstanceOf(Event);
    expect(e).toBeInstanceOf(PromiseRejectionEvent);
    expect({
      type: e.type,
      cancelable: e.cancelable,
      bubbles: e.bubbles,
      isTrusted: e.isTrusted,
      promise: e.promise === p,
      reason: e.reason === err,
    }).toEqual({
      type: "unhandledrejection",
      cancelable: true,
      bubbles: false,
      isTrusted: false,
      promise: true,
      reason: true,
    });
  });

  test("constructor defaults reason to undefined and cancelable to false", () => {
    const e = new PromiseRejectionEvent("rejectionhandled", { promise: Promise.resolve(1) });
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
    // @ts-expect-error
    expect(() => new PromiseRejectionEvent("x")).toThrow(TypeError);
    // @ts-expect-error
    expect(() => new PromiseRejectionEvent("x", {})).toThrow(TypeError);
    // @ts-expect-error
    expect(() => new PromiseRejectionEvent("x", { reason: 1 })).toThrow(TypeError);
  });

  test("promise and reason are prototype getters", () => {
    const desc = Object.getOwnPropertyDescriptor(PromiseRejectionEvent.prototype, "promise");
    expect(typeof desc?.get).toBe("function");
    expect(desc?.set).toBeUndefined();
    expect(Object.getOwnPropertyNames(PromiseRejectionEvent.prototype).sort()).toEqual(
      ["constructor", "promise", "reason"].sort(),
    );
  });

  test.each(["onunhandledrejection", "onrejectionhandled"] as const)(
    "globalThis.%s is an event handler attribute",
    name => {
      const eventName = name.slice(2) as "unhandledrejection" | "rejectionhandled";
      expect(name in globalThis).toBe(true);
      expect(globalThis[name]).toBeNull();
      const seen: PromiseRejectionEvent[] = [];
      const handler = (e: PromiseRejectionEvent) => {
        seen.push(e);
      };
      try {
        globalThis[name] = handler;
        expect(globalThis[name]).toBe(handler);
        const p = Promise.resolve();
        dispatchEvent(new PromiseRejectionEvent(eventName, { promise: p, reason: "r" }));
        expect(seen.length).toBe(1);
        expect(seen[0].promise).toBe(p);
        expect(seen[0].reason).toBe("r");
      } finally {
        globalThis[name] = null;
      }
      expect(globalThis[name]).toBeNull();
      dispatchEvent(new PromiseRejectionEvent(eventName, { promise: Promise.resolve() }));
      expect(seen.length).toBe(1);
    },
  );

  test("assignment through a Proxy of globalThis", () => {
    const handler = () => {};
    try {
      new Proxy(globalThis, {}).onunhandledrejection = handler;
      expect(globalThis.onunhandledrejection).toBe(handler);
      new Proxy(globalThis, {}).onrejectionhandled = handler;
      expect(globalThis.onrejectionhandled).toBe(handler);
    } finally {
      new Proxy(globalThis, {}).onunhandledrejection = null;
      new Proxy(globalThis, {}).onrejectionhandled = null;
    }
    expect(globalThis.onunhandledrejection).toBeNull();
    expect(globalThis.onrejectionhandled).toBeNull();
  });
});

async function run(code: string, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("unhandledrejection on the main thread", () => {
  test.concurrent("a listener that calls preventDefault() marks the rejection handled", async () => {
    const { stdout, stderr, exitCode } = await run(`
      let fired;
      addEventListener("unhandledrejection", e => {
        fired = {
          ctor: e.constructor.name,
          type: e.type,
          cancelable: e.cancelable,
          isTrusted: e.isTrusted,
          reason: e.reason.message,
          samePromise: e.promise === p,
        };
        e.preventDefault();
      });
      const p = Promise.reject(new Error("boom"));
      setTimeout(() => console.log(JSON.stringify(fired)), 0);
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ctor: "PromiseRejectionEvent",
      type: "unhandledrejection",
      cancelable: true,
      isTrusted: true,
      reason: "boom",
      samePromise: true,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("onunhandledrejection returning false marks the rejection handled", async () => {
    const { stdout, stderr, exitCode } = await run(`
      globalThis.onunhandledrejection = e => { console.log(e.constructor.name, e.reason); return false; };
      Promise.reject("hello");
      setTimeout(() => console.log("alive"), 0);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("PromiseRejectionEvent hello\nalive\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("without preventDefault() the default report still runs", async () => {
    const { stdout, stderr, exitCode } = await run(`
      addEventListener("unhandledrejection", e => console.log("listener ran", e.reason.message));
      Promise.reject(new Error("oops"));
    `);
    expect(stdout).toBe("listener ran oops\n");
    expect(stderr).toContain("error: oops");
    expect(exitCode).toBe(1);
  });

  test.concurrent("the process listener runs after the web listener, with or without preventDefault()", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const order = [];
      addEventListener("unhandledrejection", e => { order.push("web"); e.preventDefault(); });
      process.on("unhandledRejection", (reason, promise) => order.push("process:" + (promise === p)));
      const p = Promise.reject(new Error("x"));
      setTimeout(() => console.log(order.join(",")), 0);
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("web,process:true\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("a listener added after the rejection but before the checkpoint still fires", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const p = Promise.reject("r");
      addEventListener("unhandledrejection", e => { console.log("late", e.promise === p); e.preventDefault(); });
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("late true\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("rejectionhandled fires when a handler attaches later", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const keepAlive = setInterval(() => {}, 1000);
      addEventListener("unhandledrejection", e => e.preventDefault());
      addEventListener("rejectionhandled", e => {
        console.log(JSON.stringify({
          ctor: e.constructor.name,
          type: e.type,
          cancelable: e.cancelable,
          isTrusted: e.isTrusted,
          samePromise: e.promise === p,
          reason: e.reason.message,
        }));
        clearInterval(keepAlive);
      });
      const p = Promise.reject(new Error("boom"));
      setTimeout(() => p.catch(() => {}), 0);
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ctor: "PromiseRejectionEvent",
      type: "rejectionhandled",
      cancelable: false,
      isTrusted: true,
      samePromise: true,
      reason: "boom",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a listener that throws reports its own error and the rejection", async () => {
    const { stdout, stderr, exitCode } = await run(`
      addEventListener("unhandledrejection", e => { throw new Error("from listener"); });
      Promise.reject(new Error("orig"));
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain("error: from listener");
    expect(stderr).toContain("error: orig");
    expect(exitCode).toBe(1);
  });

  test.concurrent("process.exit() inside the listener exits with that code", async () => {
    const { exitCode } = await run(`
      addEventListener("unhandledrejection", () => process.exit(3));
      Promise.reject("r");
      setTimeout(() => console.log("not reached"), 0);
    `);
    expect(exitCode).toBe(3);
  });

  test.concurrent("--unhandled-rejections=strict raises before the listener runs", async () => {
    const { stdout, stderr, exitCode } = await run(
      `
      addEventListener("unhandledrejection", e => { console.log("web"); e.preventDefault(); });
      Promise.reject(new Error("strict"));
    `,
      ["--unhandled-rejections=strict"],
    );
    expect(stdout).toBe("web\n");
    expect(stderr).toContain("error: strict");
    expect(exitCode).toBe(1);
  });

  test.concurrent.each(["none", "warn", "warn-with-error-code", "throw"])(
    "--unhandled-rejections=%s honours preventDefault()",
    async mode => {
      const { stdout, exitCode } = await run(
        `
        addEventListener("unhandledrejection", e => { console.log("web"); e.preventDefault(); });
        process.on("unhandledRejection", () => console.log("process"));
        Promise.reject(new Error("x"));
      `,
        [`--unhandled-rejections=${mode}`],
      );
      expect(stdout).toBe("web\nprocess\n");
      expect(exitCode).toBe(0);
    },
  );
});

describe("unhandledrejection in a Worker", () => {
  test.concurrent("self.addEventListener with preventDefault() keeps the worker alive", async () => {
    using dir = tempDir("pre-worker", {
      "worker.js": `
        const log = m => postMessage(m);
        self.addEventListener("unhandledrejection", e => { log("self: " + e.reason.message); e.preventDefault(); });
        globalThis.addEventListener("unhandledrejection", e => { log("globalThis: " + e.reason.message); });
        globalThis.onunhandledrejection = e => log("onunhandledrejection: " + e.constructor.name);
        Promise.reject(new Error("boom"));
        setTimeout(() => log("worker still alive"), 0);
      `,
      "main.js": `
        const w = new Worker(new URL("./worker.js", import.meta.url).href);
        w.onmessage = e => {
          console.log("[main]", e.data);
          if (e.data === "worker still alive") w.terminate();
        };
        w.onerror = e => { console.log("[main] worker error event"); e.preventDefault(); };
        w.addEventListener("close", e => console.log("[main] worker closed, code", e.code));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        "[main] self: boom",
        "[main] globalThis: boom",
        "[main] onunhandledrejection: PromiseRejectionEvent",
        "[main] worker still alive",
        "[main] worker closed, code 0",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(0);
  });

  test.concurrent("a worker with only an unhandledrejection listener still exits on its own", async () => {
    using dir = tempDir("pre-worker-idle", {
      "worker.js": `
        self.addEventListener("unhandledrejection", () => {});
        self.onrejectionhandled = () => {};
        postMessage("ready");
      `,
      "main.js": `
        const w = new Worker(new URL("./worker.js", import.meta.url).href);
        w.onmessage = e => console.log(e.data);
        w.addEventListener("close", e => console.log("closed", e.code));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ready\nclosed 0\n");
    expect(exitCode).toBe(0);
  });
});
