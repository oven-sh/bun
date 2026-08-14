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
const { runInDomainForTesting, currentDomainForTesting } = jsc as {
  runInDomainForTesting: <T>(thunk: () => T) => [number, T];
  currentDomainForTesting: () => [number, number];
};

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
