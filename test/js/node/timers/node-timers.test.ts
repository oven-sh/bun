import jsc from "bun:jsc";
import { describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
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
  const setInterval = promisify(globalThis.setInterval);
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
  // Matches Node's lib/timers.js: an enumerable, non-configurable getter that resolves to timers/promises.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const sym = Symbol.for("nodejs.util.promisify.custom");
       const shape = fn => { const d = Object.getOwnPropertyDescriptor(fn, sym); return d && { get: typeof d.get, set: typeof d.set, enumerable: d.enumerable, configurable: d.configurable }; };
       const before = [setTimeout, setInterval, setImmediate].map(shape);
       const tp = require("node:timers/promises");
       const same = [setTimeout[sym] === tp.setTimeout, setInterval[sym] === tp.setInterval, setImmediate[sym] === tp.setImmediate];
       console.log(JSON.stringify({ before, same }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const accessor = { get: "function", set: "undefined", enumerable: true, configurable: false };
  expect(JSON.parse(stdout)).toEqual({ before: [accessor, accessor, accessor], same: [true, true, true] });
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

type TimerWithDestroyed = Timer & { _destroyed: boolean };

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
    clearTimeout(immediate);
    clearInterval(immediate);

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

// A callback that throws leaves without its nextTick and promise job checkpoint. The
// checkpoint runs once the error has been reported. A native call made from one of its
// jobs that dispatches a callback of its own must return before the rest of the queue
// runs, as it does in the checkpoint after a callback that returned, and in Node.
describe.concurrent("a native call in the checkpoint after a callback that threw", () => {
  const fixture = /* js */ `
    import { once } from "node:events";
    import fs from "node:fs";
    import http from "node:http";
    import net from "node:net";
    import os from "node:os";
    const [thrower, queuedBy, job] = process.argv.slice(1);

    const server = net.createServer(serverSocket => {
      serverSocket.unref();
      serverSocket.on("error", () => {});
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const connect = async () => {
      const socket = net.connect(server.address().port, "127.0.0.1");
      await once(socket, "connect");
      socket.unref();
      socket.on("error", () => {});
      return socket;
    };
    const order = [];
    const socket = await connect();
    const watcher = fs.watch(os.tmpdir()).unref();
    // terminate() calls this close handler before it returns, and the output shows it. So these
    // tests cannot pass only because the native calls stopped dispatching a callback.
    const bunSocket = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.address().port,
      socket: { data() {}, error() {}, close: () => void order.push("bunSocket close handler") },
    });
    bunSocket.unref();
    server.unref();

    function probe() {
      for (const [name, nativeCall] of [
        ["fs.watch().close()", () => watcher.close()],
        ["socket.destroy()", () => socket.destroy()],
        ["bunSocket.terminate()", () => bunSocket.terminate()],
      ]) {
        Promise.resolve().then(() => order.push("promise job"));
        process.nextTick(() => order.push("nextTick"));
        order.push("before " + name);
        nativeCall();
        order.push("after " + name);
      }
      // First line: what ran before the native calls returned.
      console.log(JSON.stringify(order));
      // The checkpoint does not keep the event loop entered: a later callback has its own again.
      setImmediate(() => {
        order.push("immediate 1");
        process.nextTick(() => order.push("nextTick of immediate 1"));
        Promise.resolve().then(() => order.push("promise job of immediate 1"));
      });
      setImmediate(() => order.push("immediate 2"));
    }
    // Second line: the final order.
    process.on("exit", () => console.log(JSON.stringify(order)));

    const queueProbe = () => (job === "nextTick" ? process.nextTick(probe) : Promise.resolve().then(probe));
    const callback = () => {
      if (queuedBy === "the callback, before it threw") queueProbe();
      throw new Error("thrown");
    };
    process.once("uncaughtException", () => {
      if (queuedBy === "the 'uncaughtException' listener") queueProbe();
    });

    switch (thrower) {
      case "a setImmediate callback":
        setImmediate(callback);
        break;
      case "a net.Socket 'close' listener": {
        // node:net emits 'close' from a setImmediate callback.
        const other = await connect();
        other.once("close", callback);
        other.destroy();
        break;
      }
      case "an http.Server 'connection' listener": {
        // Native code calls this listener, and reports what it threw after its own exit.
        const httpServer = http.createServer(() => {});
        httpServer.once("connection", connection => {
          connection.on("error", () => {});
          setImmediate(() => {
            client.destroy();
            httpServer.close();
            httpServer.closeAllConnections();
          });
          callback();
        });
        await once(httpServer.listen(0, "127.0.0.1"), "listening");
        const client = net.connect(httpServer.address().port, "127.0.0.1");
        client.on("error", () => {});
        break;
      }
      default:
        throw new Error("unknown thrower: " + thrower);
    }
  `;
  const beforeTheCallsReturn = [
    "before fs.watch().close()",
    "after fs.watch().close()",
    "before socket.destroy()",
    "after socket.destroy()",
    "before bunSocket.terminate()",
    "bunSocket close handler",
    "after bunSocket.terminate()",
  ];
  const laterCallbacks = ["immediate 1", "nextTick of immediate 1", "promise job of immediate 1", "immediate 2"];

  describe.each(["a setImmediate callback", "a net.Socket 'close' listener", "an http.Server 'connection' listener"])(
    "%s threw",
    thrower => {
      it.each([
        ["the 'uncaughtException' listener", "nextTick"],
        ["the 'uncaughtException' listener", "promise job"],
        ["the callback, before it threw", "nextTick"],
        ["the callback, before it threw", "promise job"],
      ])("returns before the queue runs when %s queued a %s", async (queuedBy, job) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", fixture, thrower, queuedBy, job],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // The queue that runs probe() runs what probe() added to it first.
        const afterProbe =
          job === "nextTick"
            ? ["nextTick", "nextTick", "nextTick", "promise job", "promise job", "promise job"]
            : ["promise job", "promise job", "promise job", "nextTick", "nextTick", "nextTick"];
        expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
          stdout: [
            JSON.stringify(beforeTheCallsReturn),
            JSON.stringify([...beforeTheCallsReturn, ...afterProbe, ...laterCallbacks]),
          ],
          stderr: "",
          exitCode: 0,
        });
      });
    },
  );

  // A Bun.ModuleGraph takes the error, so the runner does not end the test.
  it("returns before the queue runs in a test that is still running under bun test", async () => {
    using dir = tempDir("checkpoint-after-throw-bun-test", {
      "package.json": "{}",
      "fixture.test.js": /* js */ `
        import { expect, test } from "bun:test";
        import fs from "node:fs";
        import os from "node:os";

        test("the probe", async () => {
          const order = [];
          const watcher = fs.watch(os.tmpdir());
          using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
          const bunSocket = await Bun.connect({
            hostname: "127.0.0.1",
            port: listener.port,
            socket: { data() {}, error() {}, close: () => void order.push("bunSocket close handler") },
          });
          let beforeTheCallsReturn;
          const { promise: done, resolve } = Promise.withResolvers();
          function probe() {
            for (const [name, nativeCall] of [
              ["fs.watch().close()", () => watcher.close()],
              ["bunSocket.terminate()", () => bunSocket.terminate()],
            ]) {
              Promise.resolve().then(() => order.push("promise job"));
              process.nextTick(() => order.push("nextTick"));
              order.push("before " + name);
              nativeCall();
              order.push("after " + name);
            }
            beforeTheCallsReturn = order.slice();
            setImmediate(() => {
              order.push("immediate 1");
              process.nextTick(() => order.push("nextTick of immediate 1"));
              Promise.resolve().then(() => order.push("promise job of immediate 1"));
            });
            setImmediate(() => {
              order.push("immediate 2");
              resolve();
            });
          }
          const graph = new Bun.ModuleGraph({ onError: () => process.nextTick(probe) });
          graph.run(() =>
            setImmediate(() => {
              throw new Error("thrown");
            }),
          );
          await done;
          graph.dispose();
          const expected = [
            "before fs.watch().close()",
            "after fs.watch().close()",
            "before bunSocket.terminate()",
            "bunSocket close handler",
            "after bunSocket.terminate()",
          ];
          expect(beforeTheCallsReturn).toEqual(expected);
          expect(order).toEqual([
            ...expected,
            "nextTick",
            "nextTick",
            "promise job",
            "promise job",
            "immediate 1",
            "nextTick of immediate 1",
            "promise job of immediate 1",
            "immediate 2",
          ]);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "fixture.test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});
