// `async` Rust on the JS event loop: src/async, src/jsc/future.rs, src/runtime/future.rs.
// The bodies under test are in src/runtime/future_testing.rs.
import { futures } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function run(script: string, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args, "-e", `const { futures } = require("bun:internal-for-testing");\n${script}`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Collects until every future of this file is gone. */
async function untilNoneAlive() {
  while (futures.alive() > 0) {
    Bun.gc(true);
    await new Promise(resolve => setImmediate(resolve));
  }
}

describe("what a future can await", () => {
  test("the work pool", async () => {
    expect(await futures.add(40, 2)).toBe(42);
    expect(await futures.add(2147483647, 1)).toBe(-2147483648);
  });

  test("many pool tasks at once", async () => {
    expect(await futures.fanOut(0)).toBe(0);
    expect(await futures.fanOut(500)).toBe((499 * 500) / 2);
  });

  test("the work pool, reading a buffer in place", async () => {
    expect(await futures.sumBytes(new Uint8Array([1, 2, 3, 250]), 0)).toBe(256);
    expect(await futures.sumBytes("not a buffer", 0)).toBe(null);
    // Nothing but the job keeps the buffer alive while the pool reads it.
    const sum = futures.sumBytes(new Uint8Array(1 << 16).fill(1), 20);
    Bun.gc(true);
    expect(await sum).toBe(1 << 16);
    // Storage that can be freed while it is pinned is copied.
    const memory = new Uint8Array(new WebAssembly.Memory({ initial: 1 }).buffer, 0, 16).fill(2);
    expect(await futures.sumBytes(memory, 0)).toBe(32);
  });

  test("and make its result through the bindings API", async () => {
    expect(await futures.shout("héllo")).toBe("HéLLO");
  });

  test("another future that it spawned", async () => {
    expect(await futures.nested(21)).toBe(42);
    expect(futures.alive()).toBe(0);
  });

  test("nothing", async () => {
    const value = { a: 1 };
    const promise = futures.ready(value);
    expect(Bun.peek.status(promise)).toBe("fulfilled");
    expect(await promise).toBe(value);
  });

  test("a timer", async () => {
    const start = performance.now();
    await futures.sleep(20);
    expect(performance.now() - start).toBeGreaterThanOrEqual(19);
  });

  test("timers fire in order of their deadlines", async () => {
    const order: number[] = [];
    await Promise.all([150, 50, 100].map(ms => futures.sleep(ms).then(() => order.push(ms))));
    expect(order).toEqual([50, 100, 150]);
  });

  test("a promise", async () => {
    expect(await futures.settled(Promise.resolve(1))).toEqual(["fulfilled", 1]);
    expect(await futures.settled(Promise.reject(2))).toEqual(["rejected", 2]);
    const { promise, resolve } = Promise.withResolvers();
    const settled = futures.settled(promise);
    expect(Bun.peek.status(settled)).toBe("pending");
    resolve("later");
    expect(await settled).toEqual(["fulfilled", "later"]);
  });

  test("what is not a promise", async () => {
    expect(await futures.settled(3)).toEqual(["fulfilled", 3]);
    expect(await futures.settled(undefined)).toEqual(["fulfilled", undefined]);
    const object = {};
    expect((await futures.settled(object))[1]).toBe(object);
  });

  test("a thenable", async () => {
    expect(await futures.settled({ then: (ok: (value: string) => void) => ok("thenable") })).toEqual([
      "fulfilled",
      "thenable",
    ]);
    expect(
      await futures.settled({
        get then() {
          throw "getter";
        },
      }),
    ).toEqual(["rejected", "getter"]);
  });

  test("a promise whose then() script can observe", async () => {
    let calls = 0;
    class Counted<T> extends Promise<T> {
      then<A, B>(onFulfilled?: (value: T) => A, onRejected?: (reason: unknown) => B) {
        calls++;
        return super.then(onFulfilled, onRejected);
      }
    }
    expect(await futures.settled(Counted.resolve("subclass"))).toEqual(["fulfilled", "subclass"]);
    expect(calls).toBe(1);

    const own = Promise.resolve("ignored");
    own.then = ((ok: (value: string) => void) => ok("own property")) as typeof own.then;
    expect(await futures.settled(own)).toEqual(["fulfilled", "own property"]);
  });

  test("one thing after another, in a loop", async () => {
    const seen: number[] = [];
    const sum = await futures.sequence(async (i: number) => {
      seen.push(i);
      await Bun.sleep(1);
      return i * 2;
    }, 5);
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(sum).toBe(20);
  });

  test("whichever of two comes first", async () => {
    expect(await futures.withTimeout(new Promise(() => {}), 5)).toBe("timed out");
    expect(await futures.withTimeout(Promise.resolve("fast"), 60_000)).toBe("fast");
    await expect(futures.withTimeout(Promise.reject(new Error("no")), 60_000)).rejects.toThrow("no");
  });
});

describe("errors", () => {
  test("what the body throws rejects its promise", async () => {
    await expect(
      futures.callAfter(() => {
        throw new RangeError("after the await");
      }, 1),
    ).rejects.toThrow(new RangeError("after the await"));
    await expect(
      futures.sequence(() => {
        throw new RangeError("before the first await");
      }, 1),
    ).rejects.toThrow(new RangeError("before the first await"));
  });

  test("a rejection stops the loop", async () => {
    let calls = 0;
    await expect(
      futures.sequence(async (i: number) => {
        calls++;
        if (i === 1) throw new Error("second");
        return 0;
      }, 5),
    ).rejects.toThrow("second");
    await untilNoneAlive();
    expect(calls).toBe(2);
  });

  test("what a future without a promise throws is uncaught", async () => {
    const { stdout, exitCode } = await run(`
      process.on("uncaughtException", error => console.log("uncaught:", error.message));
      futures.detached(() => { throw new Error("detached"); }, 1);
    `);
    expect(stdout).toBe("uncaught: detached\n");
    expect(exitCode).toBe(0);
  });

  test("and ends the process if nothing handles it", async () => {
    const { stderr, exitCode } = await run(`futures.detached(() => { throw new Error("detached"); }, 1);`);
    expect(stderr).toContain("error: detached");
    expect(exitCode).toBe(1);
  });
});

describe("the event loop", () => {
  test("microtasks run after each poll, before the next task", async () => {
    const order: string[] = [];
    await Promise.all([
      futures.callAfter(() => {
        order.push("first");
        queueMicrotask(() => order.push("first's microtask"));
        process.nextTick(() => order.push("first's tick"));
      }, 5),
      futures.callAfter(() => void order.push("second"), 5),
    ]);
    expect(order).toEqual(["first", "first's tick", "first's microtask", "second"]);
  });

  test("a future continues where an async function awaiting the same promise would", async () => {
    const order: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    promise.then(() => order.push("then, registered before"));
    const done = futures.sequence((i: number) => {
      order.push("native " + i);
      return i === 0 ? promise : undefined;
    }, 2);
    (async () => {
      await promise;
      order.push("await, registered after");
    })();
    setImmediate(() => order.push("next task"));
    resolve();
    await done;
    await new Promise(resolve => setImmediate(resolve));
    expect(order).toEqual(["native 0", "then, registered before", "native 1", "await, registered after", "next task"]);
  });

  test("the body runs up to its first await inside the call", () => {
    let called = false;
    futures.sequence(() => void (called = true), 1);
    expect(called).toBe(true);
  });

  test.concurrent.each([
    ["a timer", `futures.sleep(30).then(() => console.log("done"));`, "done\n"],
    ["pool work", `futures.block(30).then(() => console.log("done"));`, "done\n"],
    ["not a promise nobody can settle", `futures.settled(new Promise(() => {})).then(() => console.log("done"));`, ""],
  ])("what keeps the process alive: %s", async (_, script, expected) => {
    const { stdout, exitCode } = await run(script);
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  });
});

describe("macros", () => {
  const files = {
    "macro.ts": `
      import { futures } from "bun:internal-for-testing";
      export async function awaited() {
        await futures.sleep(1);
        return (await futures.add(1, 2)) + (await futures.sequence(async () => 4, 1));
      }
      export function leftBehind() {
        futures.sleep(5).then(() => console.log("a timer"));
        futures.add(40, 2).then(sum => console.log("pool work:", sum));
        return "returned";
      }
    `,
    "main.ts": `
      import { awaited, leftBehind } from "./macro.ts" with { type: "macro" };
      console.log("awaited:", awaited());
      console.log("the macro", leftBehind());
    `,
  };

  test.concurrent(
    "a macro's futures run on its loop while it is waited on, and on the regular loop afterwards",
    async () => {
      using dir = tempDir("rust-future-macro", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.ts"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = stdout.split("\n").filter(line => line && !line.startsWith("[macro]"));
      expect({ first: lines.slice(0, 2), later: lines.slice(2).sort(), stderr }).toEqual({
        first: ["awaited: 7", "the macro returned"],
        later: ["a timer", "pool work: 42"],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
  );
});

describe("garbage collection", () => {
  test("what a future roots survives collections between its polls", async () => {
    const sum = await futures.sequence(async (i: number) => {
      Bun.gc(true);
      await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);
      return { valueOf: () => i };
    }, 10);
    expect(sum).toBe(45);
  });

  test("an outcome survives a collection between the reaction and the poll", async () => {
    const { promise, resolve } = Promise.withResolvers<object>();
    const settled = futures.settled(promise);
    promise.then(() => Bun.gc(true));
    resolve({ fresh: "object" });
    expect(await settled).toEqual(["fulfilled", { fresh: "object" }]);
  });

  test("a future that awaits a collected promise is dropped", async () => {
    await untilNoneAlive();
    (function () {
      for (let i = 0; i < 100; i++) futures.settled(new Promise(() => {}));
    })();
    expect(futures.alive()).toBe(100);
    await untilNoneAlive();
  });

  test("the loser of a race lets go of what it held", async () => {
    await untilNoneAlive();
    const { promise, resolve } = Promise.withResolvers();
    expect(await futures.withTimeout(promise, 1)).toBe("timed out");
    expect(futures.alive()).toBe(0);
    resolve("too late");
  });
});

describe("going away with futures in flight", () => {
  const inFlight = `
    futures.sleep(600_000);
    futures.block(50);
    futures.fanOut(64);
    futures.settled(new Promise(() => {}));
    futures.sequence(() => new Promise(resolve => setTimeout(resolve, 600_000)), 2);
    futures.withTimeout(new Promise(() => {}), 600_000);
  `;

  test.concurrent("process.exit()", async () => {
    const { stdout, stderr, exitCode } = await run(`${inFlight} console.log("exiting"); process.exit(7);`);
    expect({ stdout, stderr }).toEqual({ stdout: "exiting\n", stderr: "" });
    expect(exitCode).toBe(7);
  });

  test.concurrent("pool work outlives the future that started it, with what it reads", async () => {
    const { stdout, stderr, exitCode } = await run(`
      futures.sumBytesAbandoned(new Uint8Array(1 << 20).fill(1), 30);
      Bun.gc(true);
      console.log(futures.alive());
    `);
    expect({ stdout, stderr }).toEqual({ stdout: "0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("abandoned pool work does not keep the process alive", async () => {
    const start = performance.now();
    const { stdout, exitCode } = await run(`
      const graph = new Bun.ModuleGraph();
      graph.run(() => void futures.block(60_000));
      graph.dispose();
      console.log(futures.alive());
    `);
    expect(stdout).toBe("0\n");
    expect(exitCode).toBe(0);
    expect(performance.now() - start).toBeLessThan(30_000);
  });

  test.concurrent.each([
    ["in its first poll", "futures.sequence(stop, 1)"],
    ["in a later poll", "futures.callAfter(stop, 1)"],
  ])("a context that is stopped by its own future, %s", async (_, start) => {
    const { stdout, stderr, exitCode } = await run(`
      const graph = new Bun.ModuleGraph();
      const { promise, resolve } = Promise.withResolvers();
      const stop = () => { graph.dispose(); console.log("disposed"); resolve(); };
      graph.run(() => void ${start});
      await promise;
      await new Promise(resolve => setImmediate(resolve));
      console.log(futures.alive());
    `);
    expect({ stdout, stderr }).toEqual({ stdout: "disposed\n0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("process.exit() from inside a future, with the VM torn down", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `require("bun:internal-for-testing").futures.sequence(() => { console.log("exiting"); process.exit(3); }, 1);`,
      ],
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "exiting\n", stderr: "" });
    expect(exitCode).toBe(3);
  });

  test.concurrent("a worker that is terminated drops them", async () => {
    using dir = tempDir("rust-future-worker", {
      "worker.js": `
        const { futures } = require("bun:internal-for-testing");
        ${inFlight}
        postMessage(futures.alive());
      `,
      "main.js": `
        const { futures } = require("bun:internal-for-testing");
        const worker = new Worker(require.resolve("./worker.js"));
        const alive = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
        await worker.terminate();
        // Its thread is still tearing down.
        while (futures.alive() > 0) await new Promise(resolve => setImmediate(resolve));
        console.log(alive, futures.alive());
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
    expect({ stdout, stderr }).toEqual({ stdout: "6 0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("a worker that exits by itself drops them", async () => {
    using dir = tempDir("rust-future-worker-exit", {
      "worker.js": `
        const { futures } = require("bun:internal-for-testing");
        futures.settled(new Promise(() => {}));
        futures.sequence(() => new Promise(() => {}), 2);
      `,
      "main.js": `
        const { futures } = require("bun:internal-for-testing");
        const worker = new Worker(require.resolve("./worker.js"));
        await new Promise(resolve => worker.addEventListener("close", resolve));
        console.log(futures.alive());
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
    expect({ stdout, stderr }).toEqual({ stdout: "0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun test --isolate drops a file's futures with the file", async () => {
    using dir = tempDir("rust-future-isolate", {
      "a.test.js": `
        const { futures } = require("bun:internal-for-testing");
        test("leaves futures behind", () => {
          futures.sleep(600_000);
          futures.settled(new Promise(() => {}));
          futures.callAfter(() => console.log("called in the wrong file"), 1);
          expect(futures.alive()).toBe(3);
        });
      `,
      "b.test.js": `
        const { futures } = require("bun:internal-for-testing");
        test("finds none", async () => {
          expect(futures.alive()).toBe(0);
          // A later deadline on the same timer heap: one left over from a.test.js would fire first.
          await futures.sleep(2);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "a.test.js", "b.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).not.toContain("wrong file");
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });
});
