import jsc from "bun:jsc";
import { describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { clearInterval, clearTimeout, promises, setImmediate, setInterval, setTimeout } from "node:timers";
import { promisify } from "util";

for (const fn of [setTimeout, setInterval]) {
  describe(fn.name, () => {
    test("unref is possible", done => {
      const timer = fn(() => {
        done(new Error("should not be called"));
      }, 1).unref();
      const other = fn(() => {
        clearInterval(other);
        done();
      }, 2);
      if (fn === setTimeout) clearTimeout(timer);
      if (fn === setInterval) clearInterval(timer);
    });
  });
}

it("node.js util.promisify(setTimeout) works", async () => {
  const setTimeout = promisify(globalThis.setTimeout);
  await setTimeout(1);

  expect(async () => {
    await setTimeout(1).then(a => {
      throw new Error("TestPassed");
    });
  }).toThrow("TestPassed");
});

it("node.js util.promisify(setInterval) works", async () => {
  const setInterval = promisify(globalThis.setInterval) as unknown as typeof promises.setInterval;
  var runCount = 0;
  const start = performance.now();
  for await (const run of setInterval(1)) {
    if (runCount++ === 9) break;
  }
  const end = performance.now();

  expect(runCount).toBe(10);
  expect(end - start).toBeGreaterThan(9);
});

it("timers expose util.promisify.custom as a lazy accessor without loading node:util first", async () => {
  // Matches Node's lib/timers.js: an enumerable, non-configurable, getter-only accessor that resolves to
  // the timers/promises export of the same realm. A strict-mode write and Object.assign throw, a sloppy-mode
  // write is a no-op. The same probe runs in the main thread and in a worker, before either loads a module.
  const probe = `const probe = () => {
    const sym = Symbol.for("nodejs.util.promisify.custom");
    const timers = [setTimeout, setInterval, setImmediate];
    const shape = fn => {
      const d = Object.getOwnPropertyDescriptor(fn, sym);
      return d && { get: typeof d.get, set: typeof d.set, enumerable: d.enumerable, configurable: d.configurable };
    };
    const before = timers.map(shape);
    // new Function so that the directive is compiled as written, instead of going through the transpiler.
    const write = (fn, body) => { try { new Function("fn", "sym", body)(fn, sym); return "no throw"; } catch (e) { return e.constructor.name; } };
    const writes = timers.map(fn => ({
      strict: write(fn, '"use strict"; fn[sym] = 1;'),
      sloppy: write(fn, 'fn[sym] = 1;'),
      assign: write(fn, 'Object.assign(fn, { [sym]: 1 });'),
    }));
    // Read after the writes, so this also proves they changed nothing.
    const tp = require("node:timers/promises");
    const same = [setTimeout[sym] === tp.setTimeout, setInterval[sym] === tp.setInterval, setImmediate[sym] === tp.setImmediate];
    return { before, writes, same };
  };`;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `${probe}
       const main = probe();
       const { Worker } = require("node:worker_threads");
       const worker = new Worker(${JSON.stringify(probe)} + 'require("node:worker_threads").parentPort.postMessage(probe());', {
         eval: true,
       });
       let inWorker;
       worker.once("message", result => { inWorker = result; });
       worker.once("exit", workerExitCode => {
         console.log(JSON.stringify({ main, inWorker, workerExitCode }));
       });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const accessor = { get: "function", set: "undefined", enumerable: true, configurable: false };
  const rejected = { strict: "TypeError", sloppy: "no throw", assign: "TypeError" };
  const expected = {
    before: [accessor, accessor, accessor],
    writes: [rejected, rejected, rejected],
    same: [true, true, true],
  };
  expect(JSON.parse(stdout)).toEqual({ main: expected, inWorker: expected, workerExitCode: 0 });
  expect(exitCode).toBe(0);
});

it("node.js util.promisify(setImmediate) works", async () => {
  const setImmediate = promisify(globalThis.setImmediate);
  await setImmediate();

  expect(async () => {
    await setImmediate().then(a => {
      throw new Error("TestPassed");
    });
  }).toThrow("TestPassed");
});

it("timers.promises === timers/promises", async () => {
  const ns = await import("node:timers/promises");
  expect(ns.default).toBe(promises);
});

type TimerWithDestroyed = NodeJS.Timeout & NodeJS.Immediate & { _destroyed: boolean };

describe("_destroyed", () => {
  it("is false by default", () => {
    const timers = [
      setTimeout(() => {}, 0),
      setInterval(() => {}, 0),
      setImmediate(() => {}),
    ] as Array<TimerWithDestroyed>;
    for (const t of timers) {
      expect(t._destroyed).toBeFalse();
    }
    clearTimeout(timers[0]);
    clearInterval(timers[1]);
    clearImmediate(timers[2]);
  });

  it("is false during the callback", async () => {
    for (const fn of [setTimeout, setInterval, setImmediate]) {
      const { promise: done, resolve } = Promise.withResolvers();
      const timer = fn(() => {
        try {
          expect(timer._destroyed).toBeFalse();
        } finally {
          resolve();
          // make sure we don't make an interval that runs forever
          clearInterval(timer);
        }
      }, 1) as TimerWithDestroyed;
      await done;
    }
  });

  it("is true after clearing", () => {
    const timeout = setTimeout(() => {}, 0) as TimerWithDestroyed;
    clearTimeout(timeout);
    expect(timeout._destroyed).toBeTrue();

    const interval = setInterval(() => {}, 0) as TimerWithDestroyed;
    clearInterval(interval);
    expect(interval._destroyed).toBeTrue();

    const immediate = setImmediate(() => {}) as TimerWithDestroyed;
    clearImmediate(immediate);
    expect(immediate._destroyed).toBeTrue();
  });

  it("is true after clearing during the callback", async () => {
    for (const [setFn, clearFn] of [
      [setTimeout, clearTimeout],
      [setInterval, clearInterval],
      [setImmediate, clearImmediate],
    ] as unknown as Array<
      [(cb: () => void, time: number) => TimerWithDestroyed, (timer: TimerWithDestroyed) => void]
    >) {
      const { promise: done, resolve } = Promise.withResolvers();
      const timer = setFn(() => {
        try {
          clearFn(timer);
          expect(timer._destroyed).toBeTrue();
        } finally {
          resolve();
        }
      }, 1);
      await done;
    }
  });

  it("is true after firing", async () => {
    let calls = 0;
    const timeout = setTimeout(() => calls++, 0) as TimerWithDestroyed;
    const immediate = setImmediate(() => calls++) as TimerWithDestroyed;
    while (calls < 2) await Bun.sleep(1);
    expect(timeout._destroyed).toBeTrue();
    expect(immediate._destroyed).toBeTrue();
  });

  it("is false when timer refreshes", async () => {
    let refreshed = false;
    const { promise: done, resolve } = Promise.withResolvers();
    const timeout = setTimeout(() => {
      if (!refreshed) {
        refreshed = true;
        timeout.refresh();
        setImmediate(() => expect(timeout._destroyed).toBeFalse());
      } else {
        resolve();
      }
    }, 2) as TimerWithDestroyed;
    await done;
    expect(timeout._destroyed).toBeTrue();
  });
});

describe("clear", () => {
  it("can clear the other kind of timer", async () => {
    const timeout1 = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1);
    const interval1 = setInterval(() => {
      throw new Error("interval not cleared");
    }, 1);
    clearInterval(timeout1);
    clearTimeout(interval1);
  });

  it("interval/timeout do not affect immediates", async () => {
    const mockedCb = mock();
    const immediate = setImmediate(mockedCb);
    clearTimeout(immediate as any);
    clearInterval(immediate as any);

    await Bun.sleep(1);
    expect(mockedCb).toHaveBeenCalledTimes(1);
  });

  it("accepts a string", async () => {
    const timeout = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1);
    clearTimeout((+timeout).toString());
  });

  it("rejects malformed strings", async () => {
    const mockedCb = mock();
    const timeout = setTimeout(mockedCb, 1);
    const stringId = (+timeout).toString();

    for (const badString of [" " + stringId, stringId + " ", "0" + stringId, "+" + stringId]) {
      clearTimeout(badString);
    }

    // make sure we can't cause integer overflow
    clearTimeout((2 ** 64).toString());

    // none of the above strings should cause the timeout to be cleared
    await Bun.sleep(2);
    expect(mockedCb).toHaveBeenCalled();
  });

  it("accepts UTF-16 strings", async () => {
    const timeout = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1);
    const stringId = (+timeout).toString();
    // make a version of stringId that has the same text content, but is encoded as UTF-16
    // instead of Latin-1
    const codeUnits = new DataView(new ArrayBuffer(2 * stringId.length));
    for (let i = 0; i < stringId.length; i++) {
      codeUnits.setUint16(2 * i, stringId.charCodeAt(i), true);
    }
    const decoder = new TextDecoder("utf-16le");
    const stringIdUtf16 = decoder.decode(codeUnits);
    // make sure we succeeded in making a UTF-16 string
    expect(jsc.jscDescribe(stringIdUtf16)).toContain("8Bit:(0)");
    clearTimeout(stringIdUtf16);
  });
});

describe("_idleStart", () => {
  // https://github.com/oven-sh/bun/issues/26508
  // Next.js 16 Cache Components writes `t2._idleStart = t1._idleStart` so two
  // `setTimeout(fn)` calls share a deadline and both fire before any
  // `setImmediate` scheduled from `t1`'s callback.
  it("reschedules the timer when written (Next.js pattern)", async () => {
    const script = `
      async function once() {
        let immediateRan = false;
        let order = [];
        const t1 = setTimeout(() => {
          order.push("t1");
          setImmediate(() => { immediateRan = true; });
        });
        // Force the monotonic clock past a millisecond boundary so t2 would
        // land in a later event-loop turn without the _idleStart assignment.
        { const s = performance.now(); while (performance.now() - s < 2) {} }
        const { promise, resolve } = Promise.withResolvers();
        const t2 = setTimeout(() => {
          order.push("t2");
          resolve({ immediateRan, order: order.join(",") });
        });
        t2._idleStart = t1._idleStart;
        return promise;
      }
      for (let i = 0; i < 50; i++) {
        const { immediateRan, order } = await once();
        if (immediateRan) {
          console.log("FAIL: immediate ran before t2 on iteration " + i);
          process.exit(1);
        }
        if (order !== "t1,t2") {
          console.log("FAIL: wrong order " + order + " on iteration " + i);
          process.exit(1);
        }
      }
      console.log("ok");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  it("ignores non-finite values and cleared timers", async () => {
    const t1 = setTimeout(() => {}, 10) as any;
    t1._idleStart = "not a number";
    expect(t1._idleStart).toBe("not a number");
    t1._idleStart = NaN;
    expect(Number.isNaN(t1._idleStart)).toBeTrue();
    t1._idleStart = Infinity;
    expect(t1._idleStart).toBe(Infinity);
    clearTimeout(t1);
    t1._idleStart = 0;
    expect(t1._idleStart).toBe(0);
  });

  it("does not overflow for extreme finite values", () => {
    const t1 = setTimeout(() => {}, 10) as any;
    t1._idleStart = Number.MAX_VALUE;
    expect(t1._idleStart).toBe(Number.MAX_VALUE);
    t1._idleStart = -Number.MAX_VALUE;
    expect(t1._idleStart).toBe(-Number.MAX_VALUE);
    clearTimeout(t1);
  });
});

it.each([
  ["Timeout", () => setTimeout(() => {}, 1000)],
  ["Immediate", () => setImmediate(() => {})],
] as const)("new %s() throws", (name, create) => {
  using timer = create();
  expect(timer.constructor.name).toBe(name);
  // @ts-expect-error
  expect(() => new timer.constructor()).toThrow(
    expect.objectContaining({ name: "TypeError", code: "ERR_ILLEGAL_CONSTRUCTOR", message: "Illegal constructor" }),
  );
});

describe("symbol-keyed methods", () => {
  const timeout = setTimeout(() => {}, 1000);
  const immediate = setImmediate(() => {});
  clearTimeout(timeout);
  clearImmediate(immediate);

  it.each([
    ["Timeout", Symbol.dispose, timeout],
    ["Timeout", Symbol.toPrimitive, timeout],
    ["Immediate", Symbol.dispose, immediate],
    // Not in Node.
    ["Immediate", Symbol.toPrimitive, immediate],
  ] as const)(
    "%s.prototype[%p] has no name and no parameters, and is writable, configurable and not enumerable",
    (name, symbol, timer) => {
      const { value, ...attributes } = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(timer), symbol)!;
      expect({ name: value.name, length: value.length, ...attributes }).toEqual({
        name: "",
        length: 0,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    },
  );
});

describe.each(["with", "without"])("setImmediate %s timers running", mode => {
  // TODO(@190n) #17901 did not fix this for Windows
  it.todoIf(isWindows && mode == "with")(
    "has reasonable performance when nested",
    async () => {
      const process = Bun.spawn({
        cmd: [bunExe(), path.join(__dirname, "setImmediate-fixture.ts"), mode + "-interval"],
        stdout: "pipe",
        env: bunEnv,
      });

      await process.exited;
      const out = await process.stdout.text();
      expect(process.exitCode).toBe(0);
      // if this fails, there will be a nicer error than printing out the entire string
      expect((out.match(/\n/g) ?? []).length).toBe(5000);
      expect(out).toBe("callback\n".repeat(5000));
    },
    5000,
  );
});

it("should defer microtasks when an exception is thrown in an immediate", async () => {
  expect(await bunRun(["run", path.join(import.meta.dir, "timers-immediate-exception-fixture.js")])).toSpawn();
});

it("a promise assigned to _onTimeout resolves to undefined, not the timer's arguments", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const results = [];
        const thenable = { get then() { results.push("then was read"); } };
        for (const args of [[], [1], [thenable], [1, 2], [1, 2, 3]]) {
          const { promise } = Promise.withResolvers();
          setTimeout(() => {}, 1, ...args)._onTimeout = promise;
          const value = await promise;
          results.push(Object.prototype.toString.call(value));
        }
        console.log(results.join());
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: Array(5).fill("[object Undefined]").join() + "\n",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

it("_onTimeout is the callback inside AsyncLocalStorage.run()", () => {
  const callback = () => {};
  const timer = new AsyncLocalStorage().run(1, () => setTimeout(callback, 100_000, 1, 2));
  try {
    expect((timer as any)._onTimeout).toBe(callback);
  } finally {
    clearTimeout(timer);
  }
});

it("timers/promises clears its timers with the globals that were there when it set them", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const live = new Set();
        const set = () => {
          const timer = { ref: () => timer, unref: () => timer, hasRef: () => true };
          live.add(timer);
          return timer;
        };
        const clear = timer => void live.delete(timer);
        Object.assign(globalThis, { setTimeout: set, setInterval: set, setImmediate: set });
        Object.assign(globalThis, { clearTimeout: clear, clearInterval: clear, clearImmediate: clear });

        const promises = require("node:timers/promises");
        const counts = [];
        for (const start of [promises.setTimeout, promises.setImmediate]) {
          const controller = new AbortController();
          const options = { signal: controller.signal };
          const aborted = (start === promises.setTimeout ? start(1000, null, options) : start(null, options)).catch(() => {});
          counts.push(live.size);
          controller.abort();
          await aborted;
          counts.push(live.size);
        }
        const iterator = promises.setInterval(1000)[Symbol.asyncIterator]();
        iterator.next();
        counts.push(live.size);
        await iterator.return();
        counts.push(live.size);
        console.log(counts.join());
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1,0,1,0,1,0\n", stderr: "", exitCode: 0 });
});

describe.concurrent("a task that queues its successor each time it runs", () => {
  async function run(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: options.cwd,
      env: { ...bunEnv, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }
  const prints = (stdout: string, exitCode = 0) => ({ stdout, stderr: "", exitCode, signalCode: null });

  // Every link of an endless chain calls link(). No timer can end a chain that starves the timers, so link() counts
  // and reads the clock: a starved fixture fails after 1000 links and 3 s, and does not hang.
  const link = `
    const giveUpAt = Date.now() + 3000;
    let linksRun = 0;
    function link() {
      if (++linksRun < 1000 || Date.now() < giveUpAt) return;
      console.log("starved");
      process.exit(1);
    }
  `;
  const chains: [name: string, chain: string, unixSocket?: true][] = [
    [
      "a PerformanceObserver calls performance.mark()",
      `new PerformanceObserver(() => { link(); performance.mark("again"); }).observe({ entryTypes: ["mark"] });
       performance.mark("first");`,
    ],
    [
      "a PerformanceObserver calls performance.measure()",
      `new PerformanceObserver(() => { link(); performance.measure("again"); }).observe({ entryTypes: ["measure"] });
       performance.measure("first");`,
    ],
    [
      "dns.promises.resolve4() is called again each time it rejects",
      `import dns from "node:dns";
       const retry = () => dns.promises.resolve4("a..b").catch(() => { link(); retry(); });
       retry();`,
    ],
    [
      "dns.resolve4() is called again from its callback",
      `import dns from "node:dns";
       const retry = () => dns.resolve4("a..b", () => { link(); retry(); });
       retry();`,
    ],
    [
      "a WebSocket connects again from its close event",
      `const connect = () => {
         const ws = new WebSocket("ws+unix://" + process.env.MISSING_SOCKET);
         ws.onerror = () => {};
         ws.onclose = () => { link(); connect(); };
       };
       connect();`,
      true,
    ],
    [
      "a WebSocket that is closed while it connects dials again from its close event",
      `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
       const dial = () => {
         const ws = new WebSocket("ws://127.0.0.1:" + server.port);
         ws.onerror = () => {};
         ws.onclose = () => { link(); dial(); };
         ws.close();
       };
       dial();`,
    ],
    [
      "a RedisClient connects again each time connect() rejects",
      `const connect = () =>
         new Bun.RedisClient("redis+unix://" + process.env.MISSING_SOCKET, { autoReconnect: false })
           .connect()
           .catch(() => { link(); connect(); });
       connect();`,
      true,
    ],
    [
      "Bun.serve() starts again each time stop() resolves",
      `const restart = () =>
         Bun.serve({ port: 0, fetch: () => new Response() }).stop().then(() => { link(); restart(); });
       restart();`,
    ],
    [
      "a MessagePort opens a channel from its close event",
      `const open = () => {
         const { port1 } = new MessageChannel();
         port1.addEventListener("close", () => { link(); open(); });
         port1.start();
         port1.close();
       };
       open();`,
    ],
  ];
  const observerChain = chains[0][1];

  for (const [name, chain, unixSocket] of chains) {
    test.skipIf(isWindows && !!unixSocket)(`a timer fires while ${name}`, async () => {
      using dir = tempDir("task-chain", {});
      const fixture = `${link}${chain}
        setTimeout(() => { console.log("timer"); process.exit(0); }, 1);`;
      const env = { MISSING_SOCKET: path.join(String(dir), "missing.sock") };
      expect(await run(["-e", fixture], { env })).toEqual(prints("timer\n"));
    });
  }

  test.each([
    [
      "an immediate, a timer and an fs callback run while the chain runs",
      `import { stat } from "node:fs";
       ${observerChain}
       const seen = new Set();
       function done(what) {
         seen.add(what);
         if (seen.size < 3) return;
         console.log([...seen].sort().join());
         process.exit(0);
       }
       setImmediate(() => done("immediate"));
       setTimeout(() => done("timer"), 1);
       stat(".", () => done("fs"));`,
      "fs,immediate,timer\n",
    ],
    [
      "an unref'd timer fires while the chain runs",
      `let stop = false;
       new PerformanceObserver(() => { link(); if (!stop) performance.mark("again"); }).observe({ entryTypes: ["mark"] });
       performance.mark("first");
       setTimeout(() => { stop = true; console.log("timer"); }, 1).unref();`,
      "timer\n",
    ],
    [
      "a timer fires while a chain that a timer started runs",
      `setTimeout(() => {
         ${observerChain}
         setTimeout(() => { console.log("timer"); process.exit(0); }, 1);
       }, 1);`,
      "timer\n",
    ],
    [
      "a top-level await on a timer resumes while the chain runs",
      `${observerChain}
       await new Promise(resolve => setTimeout(resolve, 1));
       console.log("resumed");
       process.exit(0);`,
      "resumed\n",
    ],
    [
      "a socket receives data while the chain runs",
      `${observerChain}
       const server = Bun.listen({
         hostname: "127.0.0.1",
         port: 0,
         socket: { data(socket, data) { socket.write(data); } },
       });
       await Bun.connect({
         hostname: "127.0.0.1",
         port: server.port,
         socket: {
           open(socket) { socket.write("echo"); },
           data(socket, data) {
             console.log(data.toString());
             process.exit(0);
           },
         },
       });`,
      "echo\n",
    ],
    [
      "a rejection that nothing handles is reported while the chain runs",
      `let links = 0;
       process.on("unhandledRejection", error => {
         console.log(error.message);
         process.exit(0);
       });
       new PerformanceObserver(() => {
         link();
         if (++links === 5) Promise.reject(new Error("rejected by link 5"));
         performance.mark("again");
       }).observe({ entryTypes: ["mark"] });
       performance.mark("first");`,
      "rejected by link 5\n",
    ],
  ])("%s", async (_, fixture, stdout) => {
    expect(await run(["-e", link + fixture])).toEqual(prints(stdout));
  });

  test.skipIf(isWindows)("a SIGTERM listener runs while the chain runs", async () => {
    const fixture = `${link}
      process.on("SIGTERM", () => {
        console.log("SIGTERM");
        process.exit(0);
      });
      let links = 0;
      new PerformanceObserver(() => {
        link();
        // The signal arrives while the chain runs.
        if (++links === 1) process.kill(process.pid, "SIGTERM");
        performance.mark("again");
      }).observe({ entryTypes: ["mark"] });
      performance.mark("first");`;
    expect(await run(["-e", fixture])).toEqual(prints("SIGTERM\n"));
  });

  // A Worker and a macro each drive a loop of their own. Serial: a debug build is slow to start them.
  test.serial("a Worker that runs the chain receives a message and runs its timer", async () => {
    const worker = `
      const { parentPort } = require("node:worker_threads");
      ${link}
      let links = 0;
      new PerformanceObserver(() => {
        link();
        if (++links === 1) parentPort.postMessage("started");
        performance.mark("again");
      }).observe({ entryTypes: ["mark"] });
      performance.mark("first");
      setTimeout(() => parentPort.postMessage("timer"), 1);
      parentPort.on("message", message => parentPort.postMessage("got " + message));
    `;
    const fixture = `
      import { Worker } from "node:worker_threads";
      const worker = new Worker(${JSON.stringify(worker)}, { eval: true });
      const seen = new Set();
      worker.on("message", async message => {
        if (message === "started") return worker.postMessage("ping");
        seen.add(message);
        if (seen.size < 2) return;
        await worker.terminate();
        console.log([...seen].sort().join());
      });
    `;
    expect(await run(["-e", fixture])).toEqual(prints("got ping,timer\n"));
  });

  // The worker reports a rejection from the wait for its entry module, or from its loop after that.
  test.serial.each([
    [
      "a link of the chain's first drain",
      `let links = 0;
       new PerformanceObserver(() => {
         if (++links === 3) Promise.reject(new Error("rejected in the worker"));
         if (links < 30) performance.mark("again");
       }).observe({ entryTypes: ["mark"] });
       performance.mark("first");`,
    ],
    [
      "a link after the chain's first drain",
      `let links = 0;
       new PerformanceObserver(() => {
         if (++links === 12) Promise.reject(new Error("rejected in the worker"));
         if (links < 30) performance.mark("again");
       }).observe({ entryTypes: ["mark"] });
       performance.mark("first");`,
    ],
    [
      "an immediate",
      `new PerformanceObserver(() => {}).observe({ entryTypes: ["mark"] });
       setImmediate(() => {
         Promise.reject(new Error("rejected in the worker"));
         // A task keeps the worker's loop running for the turn that reports the rejection.
         performance.mark("one more task");
       });`,
    ],
  ])("a Worker exits with code 1 when %s rejects a promise that nothing handles", async (_, worker) => {
    const fixture = `
      import { Worker } from "node:worker_threads";
      const worker = new Worker(${JSON.stringify(worker)}, { eval: true });
      const errors = [];
      worker.on("error", error => errors.push(error.message));
      worker.on("exit", code => console.log(JSON.stringify({ errors, code })));
    `;
    expect(await run(["-e", fixture])).toEqual(prints('{"errors":["rejected in the worker"],"code":1}\n'));
  });

  test.serial.each([
    ["after a timer while the chain runs", "afterTimer", "resumed after a timer\n"],
    ["after 30 tasks in a row", "afterTasks", "resumed after 30 tasks\n"],
  ])("a macro resumes %s", async (_, macro, expected) => {
    using dir = tempDir("task-chain-macro", {
      "macro.ts": `
        import dns from "node:dns";
        export async function afterTimer() {
          ${link}${observerChain}
          await new Promise(resolve => setTimeout(resolve, 1));
          return "resumed after a timer";
        }
        export async function afterTasks() {
          for (let i = 0; i < 30; i++) await dns.promises.resolve4("a..b").catch(() => {});
          return "resumed after 30 tasks";
        }
      `,
      "main.ts": `
        import { ${macro} } from "./macro.ts" with { type: "macro" };
        console.log(${macro}());
        // The resolver keeps the process alive for a second after a query.
        process.exit(0);
      `,
    });
    const { stdout, ...rest } = await run(["main.ts"], { cwd: String(dir) });
    // Debug builds print "[macro] call <name>" to stdout before the script's own output.
    expect({ stdout: stdout.replace(/^\[macro\] .*\n/gm, ""), ...rest }).toEqual(prints(expected));
  });

  // Nothing runs the loop of a macro once the macro has settled, until the next call.
  test.serial("the task that a macro queues as its last step runs before the macro is over", async () => {
    const calls = Array.from({ length: 12 }, (_, awaited) => `lastStep(${awaited + 1})`);
    using dir = tempDir("task-chain-macro-last-step", {
      "ran.txt": "",
      "macro.ts": `
        import dns from "node:dns";
        import { appendFileSync, readFileSync } from "node:fs";
        import path from "node:path";
        const ran = path.join(import.meta.dir, "ran.txt");
        // Returns how many of the calls before it had run their last task when this call began.
        export async function lastStep(awaited: number) {
          const ranBefore = readFileSync(ran, "utf8").length;
          // Each query fails in a task of its own.
          for (let i = 0; i < awaited; i++) await dns.promises.resolve4("a..b").catch(() => {});
          dns.resolve4("a..b", () => appendFileSync(ran, "."));
          return ranBefore;
        }
      `,
      "main.ts": `
        import { lastStep } from "./macro.ts" with { type: "macro" };
        console.log([${calls.join(", ")}].join());
        // The resolver keeps the process alive for a second after a query.
        process.exit(0);
      `,
    });
    const { stdout, ...rest } = await run(["main.ts"], { cwd: String(dir) });
    expect({ stdout: stdout.replace(/^\[macro\] .*\n/gm, ""), ...rest }).toEqual(prints("0,1,2,3,4,5,6,7,8,9,10,11\n"));
  });

  test.serial("a chain of 12 tasks that the module of a macro starts is over before the macro is called", async () => {
    using dir = tempDir("task-chain-macro-module", {
      "macro.ts": `
        let links = 0;
        new PerformanceObserver(() => {
          if (++links < 12) performance.mark("again");
        }).observe({ entryTypes: ["mark"] });
        performance.mark("first");
        export function linksRun() {
          return links;
        }
      `,
      "main.ts": `
        import { linksRun } from "./macro.ts" with { type: "macro" };
        console.log(linksRun());
      `,
    });
    const { stdout, ...rest } = await run(["main.ts"], { cwd: String(dir) });
    expect({ stdout: stdout.replace(/^\[macro\] .*\n/gm, ""), ...rest }).toEqual(prints("12\n"));
  });

  test.serial("a rejection in a chain that a macro leaves behind fails the build", async () => {
    using dir = tempDir("task-chain-macro-left-behind", {
      "macro.ts": `
        export async function leavesAChain() {
          let links = 0;
          new PerformanceObserver(() => {
            // After the chain's first drain, so in the tick that runs once the macro has settled.
            if (++links === 12) Promise.reject(new Error("rejected by the chain of the macro"));
            if (links < 40) performance.mark("again");
          }).observe({ entryTypes: ["mark"] });
          performance.mark("first");
          await Promise.resolve();
          return "settled";
        }
      `,
      "main.ts": `
        import { leavesAChain } from "./macro.ts" with { type: "macro" };
        console.log(leavesAChain());
      `,
    });
    const { stdout, stderr, exitCode, signalCode } = await run(["main.ts"], { cwd: String(dir) });
    expect({
      stdout: stdout.replace(/^\[macro\] .*\n/gm, ""),
      reported: stderr.match(/error: rejected by the chain of the macro/g),
      exitCode,
      signalCode,
    }).toEqual({
      stdout: "settled\n",
      reported: ["error: rejected by the chain of the macro"],
      exitCode: 1,
      signalCode: null,
    });
  });

  // `bun test` drives the loop itself.
  test("a test times out while the chain runs", async () => {
    using dir = tempDir("task-chain-test-timeout", {
      "a.test.ts": `
        import { test } from "bun:test";
        test("never settles", async () => {
          ${link}${observerChain}
          await new Promise(() => {});
        }, 20);
        test("runs next", () => {});
      `,
    });
    const { stdout, stderr, exitCode } = await run(["test", "a.test.ts"], { cwd: String(dir) });
    expect({
      stdout,
      results: stderr.match(/^\((pass|fail)\) [\w ]+|this test timed out after \d+ms/gm)?.map(line => line.trimEnd()),
      exitCode,
    }).toEqual({
      stdout: expect.stringMatching(/^(bun test .*\n)?$/),
      results: ["(fail) never settles", "this test timed out after 20ms", "(pass) runs next"],
      exitCode: 1,
    });
  });

  // One drain of the task queue runs 9 generations. When the 9th ends the file, `bun test` runs the 10th before it
  // leaves the file.
  test.each([8, 9, 10, 18])(
    "`bun test` runs the task that the last test queues behind %d generations in its file",
    async generations => {
      using dir = tempDir("task-chain-test-file-end", {
        "a.test.ts": `
          import { test } from "bun:test";
          import dns from "node:dns";
          test("queues a task as its last step", async () => {
            // Each query fails in a task of its own.
            for (let i = 0; i < ${generations}; i++) await dns.promises.resolve4("a..b").catch(() => {});
            dns.resolve4("a..b", () => console.log("ran"));
          });
        `,
      });
      const { stdout, stderr, exitCode } = await run(["test", "a.test.ts"], { cwd: String(dir) });
      expect({ stdout, passed: stderr.includes("(pass) queues a task as its last step"), exitCode }).toEqual({
        stdout: expect.stringMatching(/^(bun test .*\n)?ran\n$/),
        passed: true,
        exitCode: 0,
      });
    },
  );

  // The chain's first drain ends before the rejection. `bun test` runs the next drain before it leaves the file.
  // Serial: `--parallel` starts a process per core.
  test.serial.each([
    ["in one process", []],
    ["--isolate", ["--isolate"]],
    ["--parallel", ["--parallel"]],
  ])(
    "`bun test` (%s) reports a rejection of a chain that a test leaves behind under that test's file",
    async (_, mode) => {
      using dir = tempDir("task-chain-test-left-behind", {
        "a.test.ts": `
          import { test } from "bun:test";
          test("leaves a chain behind", () => {
            let links = 0;
            new PerformanceObserver(() => {
              if (++links === 12) Promise.reject(new Error("rejected by the chain of file a"));
              if (links < 60) performance.mark("again");
            }).observe({ entryTypes: ["mark"] });
            performance.mark("first");
          });
        `,
        "b.test.ts": `
          import { test } from "bun:test";
          test("passes", () => {});
        `,
      });
      const { stderr, exitCode, signalCode } = await run(["test", ...mode, "a.test.ts", "b.test.ts"], {
        cwd: String(dir),
      });
      // What `bun test` prints for each file follows a line with the file's name.
      const reportedUnder = Object.fromEntries(
        stderr
          .split(/^(?=[ab]\.test\.ts:$)/m)
          .filter(section => /^[ab]\.test\.ts:/.test(section))
          .map(section => [
            section.slice(0, "a.test.ts".length),
            section.includes("error: rejected by the chain of file a"),
          ]),
      );
      expect({ reportedUnder, exitCode, signalCode }).toEqual({
        reportedUnder: { "a.test.ts": true, "b.test.ts": false },
        exitCode: 1,
        signalCode: null,
      });
    },
  );

  // A chain that ends runs as it did when one turn of the loop ran the whole queue.
  test.each([
    [
      "a chain of three runs before the immediates, each link with its ticks and microtasks",
      `const order = [];
       let links = 0;
       new PerformanceObserver(() => {
         const link = ++links;
         order.push("task " + link);
         process.nextTick(() => order.push("tick " + link));
         queueMicrotask(() => order.push("microtask " + link));
         if (link < 3) performance.mark("again");
       }).observe({ entryTypes: ["mark"] });
       performance.mark("first");
       setImmediate(() => order.push("immediate 1"));
       setImmediate(() => {
         order.push("immediate 2");
         console.log(order.join());
       });`,
      "task 1,tick 1,microtask 1,task 2,tick 2,microtask 2,task 3,tick 3,microtask 3,immediate 1,immediate 2\n",
    ],
    [
      "a dns.resolve4() that fails calls back before the immediates and the timers",
      `import dns from "node:dns";
       const order = [];
       setTimeout(() => {
         order.push("timer");
         console.log(order.join());
       }, 1);
       setImmediate(() => order.push("immediate"));
       dns.resolve4("a..b", () => order.push("dns"));
       process.nextTick(() => order.push("tick"));`,
      "tick,dns,immediate,timer\n",
    ],
    [
      // One drain runs 9 generations: the 8 pairs of a chain of 9 links are inside the first drain.
      "a rejection that the next link handles is not reported, in a chain of 8 such pairs",
      `let links = 0, rejected;
       new PerformanceObserver(() => {
         rejected?.catch(() => {});
         if (++links === 9) return console.log(links);
         rejected = Promise.reject(new Error("rejected by link " + links));
         performance.mark("again");
       }).observe({ entryTypes: ["mark"] });
       performance.mark("first");`,
      "9\n",
    ],
    [
      "a rejection that the next task handles is not reported while the thread pool posts tasks",
      `import { stat } from "node:fs";
       let unhandled = 0, started = 0, finished = 0, rejected = [];
       process.on("unhandledRejection", () => unhandled++);
       // The task that handles what the callbacks before it rejected.
       new PerformanceObserver(() => {
         for (const promise of rejected) promise.catch(() => {});
         rejected = [];
         if (finished === 300) console.log(unhandled);
       }).observe({ entryTypes: ["mark"] });
       function next() {
         if (started === 300) return;
         started++;
         stat(".", () => {
           finished++;
           rejected.push(Promise.reject(new Error("rejected by a callback")));
           performance.mark("handle");
           // This thread stays slower than the thread pool, so tick() takes in more results between the two tasks.
           const until = performance.now() + 0.05;
           while (performance.now() < until);
           next();
         });
       }
       for (let i = 0; i < 32; i++) next();`,
      "0\n",
    ],
    [
      "a chain of 1000 ends, and 'beforeExit' runs once after each chain",
      `let links = 0, beforeExits = 0;
       new PerformanceObserver(() => {
         if (++links % 1000 !== 0) performance.mark("again");
       }).observe({ entryTypes: ["mark"] });
       performance.mark("first");
       process.on("beforeExit", () => {
         // The first one starts the chain again.
         if (++beforeExits === 1) performance.mark("first again");
       });
       process.on("exit", code => console.log(links, beforeExits, code));`,
      "2000 2 0\n",
    ],
    [
      "a chain of 30 ends while a server is idle and no timer is set",
      `const server = Bun.serve({ port: 0, fetch: () => new Response() });
       let links = 0;
       new PerformanceObserver(() => {
         if (++links < 30) return performance.mark("again");
         console.log(links);
         server.stop();
       }).observe({ entryTypes: ["mark"] });
       performance.mark("first");`,
      "30\n",
    ],
  ])("%s", async (_, fixture, stdout) => {
    expect(await run(["-e", fixture])).toEqual(prints(stdout));
  });

  test("a chain of 100 ends after an uncaught error under --hot", async () => {
    using dir = tempDir("task-chain-hot", {
      "chain.js": `
        let links = 0;
        new PerformanceObserver(() => {
          if (++links < 100) return performance.mark("again");
          console.log(links);
          process.exit(0);
        }).observe({ entryTypes: ["mark"] });
        performance.mark("first");
        throw new Error("uncaught");
      `,
    });
    const { stdout, exitCode, signalCode } = await run(["--hot", "chain.js"], { cwd: String(dir) });
    expect({ stdout, exitCode, signalCode }).toEqual({ stdout: "100\n", exitCode: 0, signalCode: null });
  });

  test("in a longer chain a rejection that waits for the next link is reported, then 'rejectionHandled' follows", async () => {
    const fixture = `
      // Each link handles the promise that the link before it rejected, and rejects one of its own.
      let links = 0, rejected;
      const reported = new Set(), handledLater = new Set();
      process.on("unhandledRejection", (error, promise) => reported.add(promise));
      process.on("rejectionHandled", promise => handledLater.add(promise));
      new PerformanceObserver(() => {
        rejected?.catch(() => {});
        if (++links === 30) {
          return setImmediate(() => {
            const allHandledLater = reported.size === handledLater.size && [...reported].every(promise => handledLater.has(promise));
            console.log(JSON.stringify({ links, reported: reported.size > 0, allHandledLater }));
          });
        }
        rejected = Promise.reject(new Error("rejected by link " + links));
        performance.mark("again");
      }).observe({ entryTypes: ["mark"] });
      performance.mark("first");`;
    expect(await run(["-e", fixture])).toEqual(prints('{"links":30,"reported":true,"allHandledLater":true}\n'));
  });

  test("without a listener a chain ends at the first rejection that is reported", async () => {
    const fixture = `
      let links = 0, rejected;
      new PerformanceObserver(() => {
        rejected?.catch(() => {});
        if (++links === 30) return;
        rejected = Promise.reject(new Error("rejected by link " + links));
        performance.mark("again");
      }).observe({ entryTypes: ["mark"] });
      performance.mark("first");
      process.on("exit", () => console.log(links < 30 ? "ended before link 30" : "ran all 30 links"));`;
    const { stdout, stderr, exitCode, signalCode } = await run(["-e", fixture]);
    expect({ stdout, reported: stderr.match(/error: rejected by link \d+/g)?.length, exitCode, signalCode }).toEqual({
      stdout: "ended before link 30\n",
      reported: 1,
      exitCode: 1,
      signalCode: null,
    });
  });

  test("process.exit() in a link exits there", async () => {
    const fixture = `
      let links = 0;
      new PerformanceObserver(() => {
        if (++links === 5) process.exit(3);
        performance.mark("again");
      }).observe({ entryTypes: ["mark"] });
      performance.mark("first");
      process.on("exit", code => console.log(links, code));`;
    expect(await run(["-e", fixture])).toEqual(prints("5 3\n", 3));
  });
});
