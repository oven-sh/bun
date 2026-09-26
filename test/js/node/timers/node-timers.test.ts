import jsc from "bun:jsc";
import { describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import net, { type AddressInfo } from "node:net";
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

// Node's loop runs the poll (I/O callbacks), then the check phase
// (setImmediate), then the timers. The caller of the loop checks its own
// condition (a promise, an unhandled rejection, whether the loop is alive)
// after the timers, before the next poll.
describe.concurrent("event loop phases", () => {
  async function run(cmd: string[], env: Record<string, string | undefined> = bunEnv, cwd?: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // A connected loopback pair. `onData` runs in the client's first I/O callback.
  const pair = `
    const net = require("net");
    function pair(onData) {
      let serverSocket;
      const server = net.createServer(socket => {
        serverSocket = socket;
        socket.write("go");
      });
      server.listen(0, () => {
        const client = net.connect(server.address().port);
        client.once("data", () => onData(client, server, serverSocket));
      });
    }
    function busy(ms) {
      const end = performance.now() + ms;
      while (performance.now() < end) {}
    }
  `;

  // On Windows, libuv runs the timers inside its poll, so the timer fires first there.
  test.skipIf(isWindows)("an immediate queued by an I/O callback runs before a timer that came due in it", async () => {
    const script = `${pair}
      pair((client, server) => {
        const order = [];
        const done = () => order.length === 2 && (console.log(order.join(",")), client.destroy(), server.close());
        setTimeout(() => (order.push("timeout"), done()), 1);
        busy(5);
        setImmediate(() => (order.push("immediate"), done()));
      });
    `;
    expect(await run(["-e", script])).toEqual({ stdout: "immediate,timeout\n", stderr: "", exitCode: 0 });
  });

  test("a timer that came due in an I/O callback runs before a thread pool callback", async () => {
    const script = `${pair}
      const crypto = require("crypto");
      pair((client, server) => {
        const order = [];
        const done = () => order.length === 2 && (console.log(order.join(",")), client.destroy(), server.close());
        crypto.pbkdf2("a", "b", 1, 8, "sha256", () => (order.push("pool"), done()));
        setTimeout(() => (order.push("timeout"), done()), 1);
        busy(20);
      });
    `;
    expect(await run(["-e", script])).toEqual({ stdout: "timeout,pool\n", stderr: "", exitCode: 0 });
  });

  // Node runs a thread pool callback in the poll phase, so the connect it
  // starts completes in a later poll, after the check phase.
  test("an immediate queued by a thread pool callback runs before the connect that callback started", async () => {
    const script = `
      const fs = require("fs");
      const net = require("net");
      const server = net.createServer(socket => socket.end());
      server.listen(0, () => {
        fs.stat(".", () => {
          const order = [];
          const client = net.connect(server.address().port, "127.0.0.1");
          client.on("connect", () => order.push("connect"));
          setImmediate(() => order.push("immediate"));
          client.on("close", () => (console.log(order.join(",")), server.close()));
        });
      });
    `;
    expect(await run(["-e", script])).toEqual({ stdout: "immediate,connect\n", stderr: "", exitCode: 0 });
  });

  test("a due unref'd timer runs after an I/O callback unrefs the last handle", async () => {
    const script = `${pair}
      const order = [];
      process.on("exit", () => console.log(order.join(",")));
      pair((client, server, serverSocket) => {
        setTimeout(() => order.push("timeout"), 1).unref();
        busy(5);
        client.unref();
        serverSocket.unref();
        server.unref();
        order.push("unref");
      });
    `;
    expect(await run(["-e", script])).toEqual({ stdout: "unref,timeout\n", stderr: "", exitCode: 0 });
  });

  // The 'unhandledRejection' listener runs only if the rejection is still
  // unhandled when it is reported. The process then closes its sockets and exits.
  test("a rejection in a timer is reported before the next I/O callback can handle it", async () => {
    const script = `${pair}
      const order = [];
      process.on("unhandledRejection", error => order.push("unhandled: " + error.message));
      process.on("exit", () => console.log(order.join(",")));
      let rejected;
      pair((client, server, serverSocket) => {
        serverSocket.on("data", () => {
          order.push("data");
          rejected.catch(() => {});
          client.destroy();
          server.close();
        });
        setTimeout(() => {
          client.write("x");
          rejected = Promise.reject(new Error("rejected in a timer"));
        }, 1);
      });
    `;
    const { stdout, exitCode } = await run(["-e", script]);
    expect(stdout).toBe("unhandled: rejected in a timer,data\n");
    expect(exitCode).toBe(0);
  });

  // `expect(promise).resolves` waits for a pending promise in a nested loop.
  // There, an I/O callback does not drain the nextTick queue when it returns.
  test("in a nested loop, a nextTick queued by an I/O callback runs before an immediate it queued", async () => {
    const order: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    const server = net.createServer(socket => socket.end("x"));
    server.listen(0, () => {
      const client = net.connect((server.address() as AddressInfo).port);
      client.on("data", () => {
        setImmediate(() => {
          order.push("immediate");
          client.destroy();
          server.close();
          resolve();
        });
        process.nextTick(() => order.push("tick"));
      });
    });
    await expect(promise).resolves.toBeUndefined();
    expect(order).toEqual(["tick", "immediate"]);
  });

  // A preload's promise is awaited by the loop's caller. The listening server
  // keeps the loop active and the GC timer is off, so a poll that waited after
  // the promise settled would not return before the test times out.
  const preloadTest = (what: string, awaited: string) =>
    test(`a preload that awaits ${what} does not wait for I/O before the entry point runs`, async () => {
      using dir = tempDir("timers-phase-preload", {
        "preload.mjs": `
          import net from "node:net";
          globalThis.server = net.createServer();
          await new Promise(resolve => globalThis.server.listen(0, resolve));
          await new Promise(resolve => ${awaited});
        `,
        "main.mjs": `
          console.log("main");
          globalThis.server.close();
        `,
      });
      const env = { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" };
      expect(await run(["--preload", "./preload.mjs", "./main.mjs"], env, String(dir))).toEqual({
        stdout: "main\n",
        stderr: "",
        exitCode: 0,
      });
    });
  preloadTest("a timer", "setTimeout(resolve, 1)");
  // On Windows the check phase runs before the poll, so this wait still parks there.
  if (!isWindows) preloadTest("an immediate", "setImmediate(resolve)");
});
