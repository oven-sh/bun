import jsc from "bun:jsc";
import { describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { writeFileSync } from "node:fs";
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

// Node.js runs every queued immediate in one pass of its check phase, ref'ed or not (`processImmediate` in
// lib/internal/timers.js). Only a ref'ed one makes the loop take the turn that has that phase.
describe("an unref'ed immediate", () => {
  async function run(args: string[], options: { cwd?: string; env?: typeof bunEnv } = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      ...options,
      stdout: "pipe",
      stderr: "pipe",
      // A child that never ends must not outlive the test.
      timeout: 10_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, signalCode: proc.signalCode, exitCode };
  }

  // Each script ends by itself and prints what Node.js prints.
  it.concurrent.each([
    [
      "behind a ref'ed one",
      `setImmediate(() => console.log("ref'ed"));
       setImmediate(() => console.log("unref'ed")).unref();`,
      "ref'ed\nunref'ed\n",
    ],
    [
      "between ref'ed ones and behind the last one",
      `for (const name of ["unref'ed 1", "ref'ed 1", "unref'ed 2", "ref'ed 2", "unref'ed 3"]) {
         const immediate = setImmediate(() => console.log(name));
         if (name.startsWith("unref'ed")) immediate.unref();
       }`,
      "unref'ed 1\nref'ed 1\nunref'ed 2\nref'ed 2\nunref'ed 3\n",
    ],
    [
      "of timers/promises and of util.promisify, with ref: false",
      `setImmediate(() => console.log("ref'ed"));
       require("node:timers/promises").setImmediate("timers/promises", { ref: false }).then(console.log);
       require("node:util").promisify(setImmediate)("util.promisify", { ref: false }).then(console.log);`,
      "ref'ed\ntimers/promises\nutil.promisify\n",
    ],
    [
      "behind one that cleared the timer that held the loop",
      `const timer = setTimeout(() => console.log("timer"), 1000);
       setImmediate(() => {
         console.log("first");
         clearTimeout(timer);
       }).unref();
       setImmediate(() => console.log("second")).unref();`,
      "first\nsecond\n",
    ],
    [
      "that a microtask of the main script queued",
      `Promise.resolve().then(() => setImmediate(() => console.log("unref'ed")).unref());
       setImmediate(() => console.log("ref'ed"));`,
      "ref'ed\nunref'ed\n",
    ],
    [
      "that an earlier callback of the same batch unref'ed",
      `setImmediate(() => {
         console.log("first");
         second.unref();
       });
       const second = setImmediate(() => console.log("second"));`,
      "first\nsecond\n",
    ],
    [
      "behind one that throws to an uncaughtException listener",
      `process.on("uncaughtException", error => console.log("caught", error.message));
       setImmediate(() => {
         throw new Error("thrown");
       });
       setImmediate(() => console.log("unref'ed")).unref();`,
      "caught thrown\nunref'ed\n",
    ],
    [
      "behind a ref'ed one, in a Worker",
      `const { Worker } = require("node:worker_threads");
       const worker = new Worker(
         \`const { parentPort } = require("node:worker_threads");
          setImmediate(() => parentPort.postMessage("ref'ed"));
          setImmediate(() => parentPort.postMessage("unref'ed")).unref();\`,
         { eval: true },
       );
       worker.on("message", message => console.log(message));
       worker.on("exit", code => console.log("exit", code));`,
      "ref'ed\nunref'ed\nexit 0\n",
    ],
    [
      "that the top level of an ES module awaits, behind a ref'ed one",
      `import { setImmediate as immediate } from "node:timers/promises";
       setImmediate(() => console.log("ref'ed"));
       console.log(await immediate("resolved", { ref: false }));`,
      "ref'ed\nresolved\n",
    ],
    [
      "that the callback of fs.stat() or zlib.gzip() queued, when that call was the last to hold the loop",
      `setTimeout(() => {
         require("node:fs").stat(process.execPath, () => {
           console.log("stat");
           setImmediate(() => {
             console.log("unref'ed 1");
             require("node:zlib").gzip("text", () => {
               console.log("gzip");
               setImmediate(() => console.log("unref'ed 2")).unref();
             });
           }).unref();
         });
       }, 1);`,
      "stat\nunref'ed 1\ngzip\nunref'ed 2\n",
    ],
    [
      "that a beforeExit listener ref'ed again, and beforeExit is emitted a second time",
      `const immediate = setImmediate(() => console.log("callback", immediate.hasRef()));
       immediate.unref();
       let emitted = 0;
       process.on("beforeExit", () => {
         console.log("beforeExit", ++emitted, immediate.hasRef(), immediate._destroyed);
         if (emitted > 1) return;
         immediate.ref();
         console.log("ref", immediate.hasRef(), immediate._destroyed);
       });`,
      "beforeExit 1 false false\nref true false\ncallback false\nbeforeExit 2 false true\n",
    ],
    [
      "ahead of the ref'ed one that a beforeExit listener queued",
      `setImmediate(() => console.log("unref'ed")).unref();
       process.once("beforeExit", () => {
         console.log("beforeExit");
         setImmediate(() => console.log("ref'ed"));
       });`,
      "beforeExit\nunref'ed\nref'ed\n",
    ],
  ])("runs %s", async (_, script, stdout) => {
    expect(await run(["-e", script])).toEqual({ stdout, stderr: "", signalCode: null, exitCode: 0 });
  });

  // For a pending promise, `--print` takes a loop turn without asking whether anything holds the loop.
  it("does not run under --print while nothing holds the loop", async () => {
    const script = `require("node:timers/promises").setImmediate("resolved", { ref: false })`;
    expect(await run(["-p", script])).toEqual({
      stdout: "Promise { <pending> }\n",
      stderr: "",
      signalCode: null,
      exitCode: 0,
    });
  });

  // Each script ends by itself and prints what Node.js prints. A process.exit(1) is a listener that ran too often.
  it.concurrent.each([
    [
      "does not run while nothing holds the loop",
      `setImmediate(() => console.log("callback")).unref();
       process.on("exit", code => console.log("exit", code));`,
      "exit 0\n",
    ],
    [
      "does not run when the last ref'ed one queued it",
      `setImmediate(() => {
         console.log("ref'ed");
         setImmediate(() => console.log("callback")).unref();
       });
       process.on("exit", code => console.log("exit", code));`,
      "ref'ed\nexit 0\n",
    ],
    [
      "does not make the loop take a turn, in which a due unref'ed timer would fire",
      `setTimeout(() => console.log("timer"), 1).unref();
       setImmediate(() => console.log("callback")).unref();
       const due = performance.now() + 5;
       while (performance.now() < due);
       process.on("exit", code => console.log("exit", code));`,
      "exit 0\n",
    ],
    [
      "does not make the loop take a turn when it is a cleared one",
      `setTimeout(() => console.log("timer"), 1).unref();
       clearImmediate(setImmediate(() => console.log("callback")));
       const due = performance.now() + 5;
       while (performance.now() < due);
       process.on("exit", code => console.log("exit", code));`,
      "exit 0\n",
    ],
    [
      "does not make beforeExit fire again when a beforeExit listener queued it",
      `let emitted = 0;
       process.on("beforeExit", () => {
         console.log("beforeExit", ++emitted);
         if (emitted === 3) process.exit(1);
         setImmediate(() => console.log("callback")).unref();
       });`,
      "beforeExit 1\n",
    ],
    [
      "does not make beforeExit fire again when a beforeExit listener queued and cleared it",
      `let emitted = 0;
       process.on("beforeExit", () => {
         console.log("beforeExit", ++emitted);
         if (emitted === 3) process.exit(1);
         clearImmediate(setImmediate(() => console.log("callback")));
       });`,
      "beforeExit 1\n",
    ],
  ])("%s", async (_, script, stdout) => {
    expect(await run(["-e", script])).toEqual({ stdout, stderr: "", signalCode: null, exitCode: 0 });
  });

  it("does not keep the process alive after an uncaught error, when each one queues the next", async () => {
    const { stdout, stderr, signalCode, exitCode } = await run([
      "-e",
      `const again = () => setImmediate(again).unref();
       again();
       setImmediate(() => {
         throw new Error("thrown");
       });
       process.on("exit", code => console.log("exit", code));`,
    ]);
    expect(stderr).toContain("error: thrown");
    expect({ stdout, signalCode, exitCode }).toEqual({ stdout: "exit 1\n", signalCode: null, exitCode: 1 });
  });

  // What `bun test` printed: the lines of the test files, and a line for each test without the time it took.
  const testOutput = ({ stdout, stderr }: { stdout: string; stderr: string }) => ({
    stdout: stdout.replace(/^bun test v.*\r?\n/, ""),
    tests: stderr
      .split(/\r?\n/)
      .filter(line => /^\((pass|fail)\)/.test(line))
      .map(line => line.replace(/ \[[^\]]*\]$/, "")),
  });

  // The runner waits for what script can still do, so it runs the immediates that nothing holds the loop for.
  it("settles what a test file and a test await in `bun test`", async () => {
    using dir = tempDir("unrefed-immediate-awaited", {
      "awaited.test.js": `
        import { test } from "bun:test";
        import { setImmediate as immediate } from "node:timers/promises";

        console.log(await immediate("while the file loads", { ref: false }));
        console.log(await immediate("and again", { ref: false }));
        test("awaits one", async () => {
          console.log(await immediate("in a test", { ref: false }));
        });
      `,
    });
    // Without the idle collection timer, nothing wakes a loop that sleeps once the last of them ran.
    const { signalCode, exitCode, ...output } = await run(["test", "awaited.test.js"], {
      cwd: String(dir),
      env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
    });
    expect({ ...testOutput(output), signalCode, exitCode }).toEqual({
      stdout: "while the file loads\nand again\nin a test\n",
      tests: ["(pass) awaits one"],
      signalCode: null,
      exitCode: 0,
    });
  });

  // A test file ends as a program exits: the runner lets go of the ones that nothing holds the loop for.
  it("does not run in the next file of `bun test`, where ref() does not hold the loop", async () => {
    using dir = tempDir("unrefed-immediate-leftover", {
      "a.test.js": `
        import { test } from "bun:test";

        test("leaves one queued", () => {
          globalThis.leftover = setImmediate(() => console.log("callback")).unref();
        });
      `,
      "b.test.js": `
        import { test } from "bun:test";

        test("holds the loop with a timer", async () => {
          const { leftover } = globalThis;
          console.log("next file", leftover._destroyed, leftover.hasRef());
          leftover.ref();
          console.log("ref", leftover._destroyed, leftover.hasRef());
          await new Promise(resolve => setTimeout(resolve, 1));
        });
      `,
    });
    const { signalCode, exitCode, ...output } = await run(["test", "a.test.js", "b.test.js"], {
      cwd: String(dir),
    });
    expect({ ...testOutput(output), signalCode, exitCode }).toEqual({
      stdout: "next file true false\nref true false\n",
      tests: ["(pass) leaves one queued", "(pass) holds the loop with a timer"],
      signalCode: null,
      exitCode: 0,
    });
  });

  // `--hot` keeps the process: a run that ended would leave its queue to the next run.
  it("does not run in a later run of --hot, after the run that queued it ended", async () => {
    using dir = tempDir("unrefed-immediate-hot", {
      "main.js": `
        setImmediate(() => console.log("immediate of run 1")).unref();
        process.once("beforeExit", () => console.log("run 1 ended"));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
      // A child that never ends must not outlive the test.
      timeout: 10_000,
    });
    const reader = proc.stdout.getReader();
    let stdout = "";
    // Resolves once stdout has `wanted`, or at its end.
    const printed = async (wanted: string) => {
      while (!stdout.includes(wanted)) {
        const { value, done } = await reader.read();
        if (done) break;
        stdout += Buffer.from(value).toString();
      }
    };
    await printed("run 1 ended\n");
    expect(stdout).toBe("run 1 ended\n");

    // The timer of run 2 holds the loop, and a turn of a loop that something holds runs every queued immediate.
    writeFileSync(
      path.join(String(dir), "main.js"),
      `setTimeout(() => {\n  console.log("timer of run 2");\n  process.exit(0);\n}, 1);\n`,
    );
    await printed("immediate of run 1");
    expect({ stdout, exitCode: await proc.exited, signalCode: proc.signalCode }).toEqual({
      stdout: "run 1 ended\ntimer of run 2\n",
      exitCode: 0,
      signalCode: null,
    });
  });
});
