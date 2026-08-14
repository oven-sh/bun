// Scheduling domains and scoped event-loop runs.
//
// A scoped run turns Bun's one event loop from inside a synchronous frame while
// admitting only the work that frame caused; everything else that surfaces is
// parked and handed back, in order, when the run exits. These tests pin the two
// invariants from both vantage points:
//
//   inner: everything the run's domain schedules (transitively) executes before
//          the run returns;
//   outer: code that did not start the run observes none of its own callbacks
//          during the run, and observes them afterwards in the same relative
//          order and with unchanged deadlines.
//
// Driven through bun:jsc testing hooks; skipped on builds whose JSC lacks
// domain drains.
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const jsc = require("bun:jsc");
const hasDomains = typeof jsc.runInDomainForTesting === "function";
const { runInDomainForTesting, runUntilInDomainForTesting, currentDomainForTesting } = jsc as {
  runInDomainForTesting: <T>(thunk: () => T) => [number, T];
  runUntilInDomainForTesting: <T>(thunk: () => Promise<T>) => Promise<T>;
  currentDomainForTesting: () => [number, number];
};

/** Turn the loop for a fresh domain until `thunk`'s promise settles; returns it settled. */
function runUntil<T>(thunk: () => Promise<T>): Promise<T> {
  const p = runUntilInDomainForTesting(thunk);
  // The run only returns once the promise is no longer pending.
  expect(Bun.peek.status(p)).not.toBe("pending");
  return p;
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const immediate = () => new Promise<void>(r => setImmediate(r));

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe.skipIf(!hasDomains)("microtask domains", () => {
  test("inner: everything the domain queues runs before the drain returns", () => {
    const log: string[] = [];
    const [domain] = runInDomainForTesting(() => {
      log.push("thunk");
      queueMicrotask(() => {
        log.push("qm1");
        queueMicrotask(() => log.push("qm1.1"));
      });
      Promise.resolve()
        .then(() => log.push("then1"))
        .then(() => log.push("then2"));
      (async () => {
        await null;
        log.push("await1");
        await new Promise<void>(r => queueMicrotask(r));
        log.push("await2");
        // Pass-through hops (no handler on the fired side) must not stall the chain.
        await Promise.resolve(1).catch(() => {});
        log.push("await3");
        await Promise.reject(new Error("x")).then(() => {}).catch(() => {});
        log.push("await4");
        // Combinators resolve through context-less internal jobs.
        await Promise.all([Promise.resolve(1), (async () => 2)()]);
        log.push("all");
        await Promise.race([new Promise(r => queueMicrotask(() => r(1)))]);
        log.push("race");
        await Promise.allSettled([Promise.reject(1), Promise.resolve(2)]);
        log.push("allSettled");
        await Promise.any([Promise.reject(1), Promise.resolve(2)]);
        log.push("any");
        try {
          await Promise.resolve().finally(() => {});
        } finally {
          log.push("finally");
        }
      })();
    });
    expect(domain).toBeGreaterThan(0);
    // Nothing above is pending: the drain ran it all synchronously.
    expect(log).toEqual([
      "thunk",
      "qm1",
      "then1",
      "await1",
      "qm1.1",
      "then2",
      "await2",
      "await3",
      "await4",
      "all",
      "race",
      "allSettled",
      "any",
      "finally",
    ]);
  });

  test("outer: reactions queued before the drain do not run inside it, and run FIFO afterwards", async () => {
    const log: string[] = [];
    queueMicrotask(() => log.push("outer-qm1"));
    Promise.resolve().then(() => {
      log.push("outer-then1");
      queueMicrotask(() => log.push("outer-then1.qm"));
    });
    let resolveOuter!: () => void;
    const outerPromise = new Promise<void>(r => (resolveOuter = r));
    outerPromise.then(() => log.push("outer-resolved-by-inner"));

    runInDomainForTesting(() => {
      queueMicrotask(() => log.push("inner-qm"));
      Promise.resolve().then(() => {
        log.push("inner-then");
        // Settling an outer promise from inside is allowed; its (outer) reaction still waits.
        resolveOuter();
      });
    });
    log.push("after-drain");
    expect(log).toEqual(["inner-qm", "inner-then", "after-drain"]);

    await tick();
    expect(log).toEqual([
      "inner-qm",
      "inner-then",
      "after-drain",
      "outer-qm1",
      "outer-then1",
      "outer-resolved-by-inner",
      "outer-then1.qm",
    ]);
  });

  test("nothing is lost: an inner await on something the outer world settles later resumes later", async () => {
    const log: string[] = [];
    let resolveLater!: (v: string) => void;
    const settledLater = new Promise<string>(r => (resolveLater = r));
    let innerDone!: Promise<void>;

    runInDomainForTesting(() => {
      innerDone = (async () => {
        log.push("inner-start");
        const v = await settledLater;
        log.push("inner-resumed:" + v);
      })();
    });
    // The drain returned with the inner function still suspended on an unsettled promise.
    expect(log).toEqual(["inner-start"]);

    resolveLater("ok");
    await innerDone;
    expect(log).toEqual(["inner-start", "inner-resumed:ok"]);
  });

  test("nested drains defer to the innermost domain and unwind in order", async () => {
    const log: string[] = [];
    queueMicrotask(() => log.push("root"));
    const [outer] = runInDomainForTesting(() => {
      queueMicrotask(() => log.push("outer-1"));
      const [inner] = runInDomainForTesting(() => {
        queueMicrotask(() => {
          log.push("inner-1");
          queueMicrotask(() => log.push("inner-1.1"));
        });
      });
      // The inner drain ran only inner work; outer-1 is still queued.
      log.push("inner-drained:" + (inner > 0));
      queueMicrotask(() => log.push("outer-2"));
    });
    log.push("outer-drained:" + (outer > 0));
    expect(log).toEqual(["inner-1", "inner-1.1", "inner-drained:true", "outer-1", "outer-2", "outer-drained:true"]);
    await tick();
    expect(log.at(-1)).toBe("root");
  });

  test("the context domain follows entry and restore", () => {
    expect(currentDomainForTesting()).toEqual([0, 0]);
    let inside!: [number, number];
    let insideMicrotask!: [number, number];
    const [domain] = runInDomainForTesting(() => {
      inside = currentDomainForTesting();
      queueMicrotask(() => (insideMicrotask = currentDomainForTesting()));
    });
    expect(inside).toEqual([domain, 0]);
    expect(insideMicrotask).toEqual([domain, 0]);
    expect(currentDomainForTesting()).toEqual([0, 0]);
  });

  test("AsyncLocalStorage values are unaffected by the domain pair", async () => {
    const als = new AsyncLocalStorage<string>();
    const seen: Array<string | undefined> = [];

    als.run("outer", () => {
      runInDomainForTesting(() => {
        // Inherited into the domain...
        seen.push(als.getStore());
        queueMicrotask(() => seen.push(als.getStore()));
        // ...and nestable inside it.
        als.run("inner", () => {
          seen.push(als.getStore());
          Promise.resolve().then(() => seen.push(als.getStore()));
        });
        seen.push(als.getStore());
      });
      // Restored on exit.
      seen.push(als.getStore());
    });
    // sync: inherited, nested, restored; drained: microtask (outer), reaction (inner); after exit.
    expect(seen).toEqual(["outer", "inner", "outer", "outer", "inner", "outer"]);
    expect(als.getStore()).toBeUndefined();

    // enterWith inside a domain does not leak the domain pair out of it.
    const als2 = new AsyncLocalStorage<number>();
    runInDomainForTesting(() => {
      als2.enterWith(1);
      expect(als2.getStore()).toBe(1);
    });
    expect(currentDomainForTesting()).toEqual([0, 0]);
    await tick();
    expect(currentDomainForTesting()).toEqual([0, 0]);
  });

  test("an exception thrown by an inner microtask is reported, not swallowed, and the drain continues", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { runInDomainForTesting } = require("bun:jsc");
        process.on("uncaughtException", err => console.log("uncaught:" + err.message));
        runInDomainForTesting(() => {
          queueMicrotask(() => {
            console.log("a");
            throw new Error("boom");
          });
          queueMicrotask(() => console.log("b"));
        });
        console.log("after");
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("a\nuncaught:boom\nb\nafter\n");
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!hasDomains)("scoped runs: timers and immediates", () => {
  test("inner: the domain's timers, immediates and sleeps complete inside the run", () => {
    const log: string[] = [];
    const result = runUntil(async () => {
      log.push("start");
      await sleep(1);
      log.push("slept");
      await immediate();
      log.push("immediate");
      await Bun.sleep(1);
      log.push("bun.sleep");
      await new Promise<void>(r => {
        const t = setInterval(() => {
          log.push("interval");
          if (log.filter(x => x === "interval").length === 2) {
            clearInterval(t);
            r();
          }
        }, 1);
      });
      setImmediate(() => log.push("trailing-immediate"));
      return 42;
    });
    // Settled synchronously from the caller's point of view, including what the
    // final step made ready (the trailing immediate).
    expect(Bun.peek(result)).toBe(42);
    expect(log).toEqual(["start", "slept", "immediate", "bun.sleep", "interval", "interval", "trailing-immediate"]);
  });

  test("outer: due timers, immediates and microtasks do not run during the run, and all run afterwards", async () => {
    const log: string[] = [];
    const outerTimer = new Promise<void>(r =>
      setTimeout(() => {
        log.push("outer-timeout");
        r();
      }, 0),
    );
    const outerImmediate = new Promise<void>(r =>
      setImmediate(() => {
        log.push("outer-immediate");
        r();
      }),
    );
    queueMicrotask(() => log.push("outer-microtask"));
    process.nextTick(() => log.push("outer-nexttick"));

    runUntil(async () => {
      // Long enough for the outer 0ms timer to be well overdue.
      await sleep(20);
      log.push("inner-slept");
      await immediate();
      log.push("inner-immediate");
    });
    log.push("after-run");
    expect(log).toEqual(["inner-slept", "inner-immediate", "after-run"]);

    await Promise.all([outerTimer, outerImmediate]);
    expect(log.slice(3).sort()).toEqual(["outer-immediate", "outer-microtask", "outer-nexttick", "outer-timeout"]);
    // Ticks and microtasks queued before the run keep their usual precedence.
    expect(log.indexOf("outer-nexttick")).toBeLessThan(log.indexOf("outer-microtask"));
    expect(log.indexOf("outer-microtask")).toBeLessThan(log.indexOf("outer-timeout"));
  });

  test("outer timers keep their relative order and deadlines after being deferred", async () => {
    const fired: Array<[string, number]> = [];
    const t0 = performance.now();
    const mk = (name: string, ms: number) =>
      new Promise<void>(r =>
        setTimeout(() => {
          fired.push([name, performance.now() - t0]);
          r();
        }, ms),
      );
    // a and b become due during the run; c is due only after it.
    const a = mk("a", 1);
    const b = mk("b", 5);
    const b2 = mk("b2", 5);
    const c = mk("c", 80);

    runUntil(() => sleep(30));
    expect(fired).toEqual([]);

    await Promise.all([a, b, b2, c]);
    expect(fired.map(f => f[0])).toEqual(["a", "b", "b2", "c"]);
    // c was not made early by the run, nor pushed late by the deferred ones.
    expect(fired[3][1]).toBeGreaterThanOrEqual(79);
  });

  test("clearTimeout on a deferred outer timer during the run is honored", async () => {
    const log: string[] = [];
    const outer = setTimeout(() => log.push("outer-should-not-fire"), 1);
    const later = new Promise<void>(r => setTimeout(r, 40));

    runUntil(async () => {
      await sleep(20); // outer is overdue → deferred by the run
      clearTimeout(outer);
      log.push("cleared");
    });
    await later;
    expect(log).toEqual(["cleared"]);
  });

  test("nested runs: the inner run completes its own work; the middle run's timer waits for it", () => {
    const log: string[] = [];
    runUntil(async () => {
      const middleTimer = sleep(5).then(() => log.push("middle-timer"));
      await sleep(1);
      log.push("middle-before-inner");
      runUntil(async () => {
        await sleep(20); // middle's 5ms timer is overdue in here, but foreign
        log.push("inner-done");
      });
      log.push("middle-after-inner");
      await middleTimer;
      log.push("middle-done");
    });
    expect(log).toEqual(["middle-before-inner", "inner-done", "middle-after-inner", "middle-timer", "middle-done"]);
  });

  test("the domain's nextTicks run inside; outer nextTicks queued before wait, in order", async () => {
    const log: string[] = [];
    process.nextTick(() => log.push("outer-1"));
    process.nextTick(() => {
      log.push("outer-2");
      process.nextTick(() => log.push("outer-2.1"));
    });
    runUntil(async () => {
      process.nextTick(() => log.push("inner-tick-1"));
      await sleep(1);
      await new Promise<void>(r => process.nextTick(r));
      log.push("inner-after-tick");
      process.nextTick(() => log.push("inner-tick-2"));
    });
    log.push("after-run");
    expect(log).toEqual(["inner-tick-1", "inner-after-tick", "inner-tick-2", "after-run"]);
    await immediate();
    expect(log.slice(4)).toEqual(["outer-1", "outer-2", "outer-2.1"]);
  });

  test("the active run domain is visible inside and cleared after", () => {
    let inside!: [number, number];
    let insideTimer!: [number, number];
    runUntil(async () => {
      inside = currentDomainForTesting();
      await sleep(1);
      insideTimer = currentDomainForTesting();
    });
    expect(inside[0]).toBeGreaterThan(0);
    expect(inside).toEqual([inside[0], inside[0]]);
    expect(insideTimer).toEqual(inside);
    expect(currentDomainForTesting()).toEqual([0, 0]);
  });

  test("a run whose condition is met by an immediate does not sit through a poll", async () => {
    // A listener keeps the loop active with nothing to wake it: if the run polled
    // after the immediate settled its promise it would block indefinitely.
    using server = Bun.serve({ port: 0, fetch: () => new Response("unused") });
    const t0 = performance.now();
    runUntil(async () => {
      await immediate();
      await immediate();
    });
    runUntil(() => new Promise<void>(r => process.nextTick(r)));
    runUntil(() => Promise.resolve().then(() => {}));
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
