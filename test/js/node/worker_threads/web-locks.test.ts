// Web Locks API (navigator.locks / worker_threads.locks), matching Node.js.
// Port of node's test/parallel/test-web-locks.js, test-web-locks-query.js and
// test-diagnostics-channel-web-locks.js, plus coverage for bun-specific paths.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import dc from "node:diagnostics_channel";
import * as workerThreads from "node:worker_threads";
import { Worker, locks as workerThreadsLocks } from "node:worker_threads";

function nextMessage(worker: InstanceType<typeof Worker>): Promise<any> {
  return new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`worker exited with code ${code} before posting a message`)));
  });
}

describe("API surface", () => {
  test("navigator.locks and worker_threads.locks are the same LockManager", () => {
    expect(navigator.locks).toBeDefined();
    expect(workerThreadsLocks).toBe(navigator.locks);
    expect(Object.prototype.toString.call(navigator.locks)).toBe("[object LockManager]");
    expect(navigator.locks.constructor.name).toBe("LockManager");
  });

  test("worker_threads does not export Lock or LockManager", () => {
    expect((workerThreads as any).Lock).toBeUndefined();
    expect((workerThreads as any).LockManager).toBeUndefined();
  });

  test("no Lock/LockManager globals", () => {
    expect("Lock" in globalThis).toBe(false);
    expect("LockManager" in globalThis).toBe(false);
  });

  test("navigator.locks is an enumerable, configurable getter", () => {
    const desc = Object.getOwnPropertyDescriptor(navigator, "locks")!;
    expect(desc.enumerable).toBe(true);
    expect(desc.configurable).toBe(true);
    expect(typeof desc.get).toBe("function");
  });

  test("LockManager and Lock are illegal constructors", async () => {
    expect(() => new (navigator.locks.constructor as any)()).toThrow(TypeError);
    await navigator.locks.request("illegal-ctor", lock => {
      expect(() => new (lock!.constructor as any)()).toThrow(TypeError);
    });
  });

  test("LockManager.prototype methods are enumerable; Lock exposes name/mode", async () => {
    const proto = Object.getPrototypeOf(navigator.locks);
    expect(Object.getOwnPropertyDescriptor(proto, "request")!.enumerable).toBe(true);
    expect(Object.getOwnPropertyDescriptor(proto, "query")!.enumerable).toBe(true);
    await navigator.locks.request("lock-shape", lock => {
      expect(Object.prototype.toString.call(lock)).toBe("[object Lock]");
      const lockProto = Object.getPrototypeOf(lock);
      expect(Object.getOwnPropertyNames(lockProto).sort()).toEqual(["constructor", "mode", "name"]);
      expect(lock!.name).toBe("lock-shape");
      expect(lock!.mode).toBe("exclusive");
    });
  });

  test("query() and request() with wrong this reject with ERR_INVALID_THIS", async () => {
    await expect(navigator.locks.query.call({})).rejects.toMatchObject({
      code: "ERR_INVALID_THIS",
    });
    let callbackRan = false;
    await expect(
      navigator.locks.request.call({}, "wrong-this", () => {
        callbackRan = true;
      }),
    ).rejects.toMatchObject({ code: "ERR_INVALID_THIS" });
    expect(callbackRan).toBe(false);
  });
});

describe("request validation", () => {
  test("callback is required and must be a function", async () => {
    // @ts-expect-error missing arguments
    await expect(navigator.locks.request()).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    });
    // @ts-expect-error missing callback
    await expect(navigator.locks.request("a")).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
    await expect(navigator.locks.request("a", {}, 42 as any)).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
  });

  test("name is converted with ToString; symbols are rejected", async () => {
    await expect(navigator.locks.request(Symbol("s") as any, () => {})).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: "Value is a Symbol and cannot be converted to a string.",
    });
    await navigator.locks.request(123 as any, lock => {
      expect(lock!.name).toBe("123");
    });
    await navigator.locks.request(undefined as any, lock => {
      expect(lock!.name).toBe("undefined");
    });
  });

  test("hyphen-prefixed names are rejected with NotSupportedError", async () => {
    const promise = navigator.locks.request("-x", () => {});
    promise.catch(() => {});
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    await expect(promise).rejects.toMatchObject({
      name: "NotSupportedError",
      message: "Lock name may not start with hyphen",
    });
  });

  test("invalid option combinations are rejected with NotSupportedError", async () => {
    await expect(navigator.locks.request("a", { steal: true, ifAvailable: true }, () => {})).rejects.toMatchObject({
      name: "NotSupportedError",
      message: "ifAvailable and steal are mutually exclusive",
    });
    await expect(navigator.locks.request("a", { steal: true, mode: "shared" }, () => {})).rejects.toMatchObject({
      name: "NotSupportedError",
      message: 'mode: "shared" and steal are mutually exclusive',
    });
    const signal = new AbortController().signal;
    await expect(navigator.locks.request("a", { steal: true, signal }, () => {})).rejects.toMatchObject({
      name: "NotSupportedError",
      message: "signal cannot be used with steal or ifAvailable",
    });
    await expect(navigator.locks.request("a", { ifAvailable: true, signal }, () => {})).rejects.toMatchObject({
      name: "NotSupportedError",
      message: "signal cannot be used with steal or ifAvailable",
    });
  });

  test("mode must be a valid LockMode enum value", async () => {
    await expect(navigator.locks.request("a", { mode: "banana" as any }, () => {})).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
      message: "mode 'banana' is not a valid enum value of type LockMode.",
    });
  });

  test("options dictionary and signal member validation", async () => {
    await expect(navigator.locks.request("a", 42 as any, () => {})).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
      message: "Value cannot be converted to a dictionary",
    });
    await expect(navigator.locks.request("a", { signal: 42 as any }, () => {})).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
      message: "signal is not an object.",
    });
    await expect(navigator.locks.request("a", { signal: {} as any }, () => {})).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
    });
    // null options are treated as defaults
    await navigator.locks.request("a", null as any, lock => {
      expect(lock!.mode).toBe("exclusive");
    });
  });

  test("already-aborted signal rejects with the signal reason", async () => {
    await expect(navigator.locks.request("a", { signal: AbortSignal.abort() }, () => {})).rejects.toMatchObject({
      name: "AbortError",
    });
    const reason = new Error("custom-reason");
    let called = false;
    await expect(
      navigator.locks.request("a", { signal: AbortSignal.abort(reason) }, () => {
        called = true;
      }),
    ).rejects.toBe(reason);
    expect(called).toBe(false);
  });
});

describe("basic behavior", () => {
  test("callback runs synchronously when the lock is immediately available", async () => {
    const order: string[] = [];
    const promise = navigator.locks.request("sync-order", lock => {
      order.push(`callback:${lock!.name}:${lock!.mode}`);
      return "return-value";
    });
    order.push("after-request");
    expect(await promise).toBe("return-value");
    expect(order).toEqual(["callback:sync-order:exclusive", "after-request"]);
  });

  test("request() resolves with the callback's async result", async () => {
    const result = await navigator.locks.request("async-result", async () => {
      await Promise.resolve();
      return { ok: 1 };
    });
    expect(result).toEqual({ ok: 1 });
  });

  test("callback rejection propagates and releases the lock", async () => {
    const error = new Error("async-boom");
    await expect(
      navigator.locks.request("async-reject", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const available = await navigator.locks.request("async-reject", { ifAvailable: true }, lock => lock !== null);
    expect(available).toBe(true);
  });

  test("synchronously-throwing callback rejects and releases the lock", async () => {
    const error = new Error("sync-boom");
    await expect(
      navigator.locks.request("sync-throw", () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const available = await navigator.locks.request("sync-throw", { ifAvailable: true }, lock => lock !== null);
    expect(available).toBe(true);
  });

  test("exclusive requests for the same name run serially in FIFO order", async () => {
    const order: number[] = [];
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        navigator.locks.request("serial", async () => {
          order.push(i);
          await Promise.resolve();
        }),
      );
    }
    await Promise.all(promises);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  test("queued request resolves with its own callback value", async () => {
    const holderReleased = Promise.withResolvers<void>();
    const holder = navigator.locks.request("queued-value", () => holderReleased.promise);
    const queued = navigator.locks.request("queued-value", () => "plain-value");
    holderReleased.resolve();
    expect(await queued).toBe("plain-value");
    await holder;
  });

  test("a long queue of synchronous callbacks drains without exhausting the stack", async () => {
    const holderReleased = Promise.withResolvers<void>();
    const holder = navigator.locks.request("sync-drain", () => holderReleased.promise);
    let ran = 0;
    const waiters: Promise<unknown>[] = [];
    for (let i = 0; i < 5000; i++) {
      waiters.push(
        navigator.locks.request("sync-drain", () => {
          ran++;
        }),
      );
    }
    holderReleased.resolve();
    await Promise.all(waiters);
    await holder;
    expect(ran).toBe(5000);
  });

  test("thenable (non-promise) return releases the lock immediately", async () => {
    let settle!: () => void;
    const requestPromise = navigator.locks.request("thenable", () => {
      return {
        then(res: (v: string) => void) {
          settle = () => res("thenable-value");
        },
      };
    });
    // the lock is free even though the thenable has not settled
    const available = await navigator.locks.request("thenable", { ifAvailable: true }, lock => lock !== null);
    expect(available).toBe(true);
    settle();
    expect(await requestPromise).toBe("thenable-value");
  });

  test("shared locks coexist, exclusive waits for all of them", async () => {
    const order: string[] = [];
    const releaseA = Promise.withResolvers<void>();
    const releaseB = Promise.withResolvers<void>();
    const a = navigator.locks.request("shared-coexist", { mode: "shared" }, lock => {
      order.push(`a:${lock!.mode}`);
      return releaseA.promise;
    });
    const b = navigator.locks.request("shared-coexist", { mode: "shared" }, lock => {
      order.push(`b:${lock!.mode}`);
      return releaseB.promise;
    });
    const exclusive = navigator.locks.request("shared-coexist", lock => {
      order.push(`excl:${lock!.mode}`);
    });
    expect(order).toEqual(["a:shared", "b:shared"]);
    releaseA.resolve();
    releaseB.resolve();
    await Promise.all([a, b, exclusive]);
    expect(order).toEqual(["a:shared", "b:shared", "excl:exclusive"]);
  });

  test("a shared request queued behind an exclusive request waits for it", async () => {
    const order: string[] = [];
    const releaseShared = Promise.withResolvers<void>();
    const first = navigator.locks.request("fairness", { mode: "shared" }, () => releaseShared.promise);
    const excl = navigator.locks.request("fairness", () => {
      order.push("exclusive");
    });
    const lateShared = navigator.locks.request("fairness", { mode: "shared" }, () => {
      order.push("late-shared");
    });
    // the late shared request cannot join the held shared lock because an
    // exclusive request is ahead of it in the queue
    const joined = await navigator.locks.request(
      "fairness",
      { mode: "shared", ifAvailable: true },
      lock => lock !== null,
    );
    expect(joined).toBe(false);
    releaseShared.resolve();
    await Promise.all([first, excl, lateShared]);
    expect(order).toEqual(["exclusive", "late-shared"]);
  });

  test("many nested requests for different names resolve", async () => {
    // mirrors node's "should handle many concurrent locks without hanging"
    let callbackCount = 0;
    let resolveCount = 0;
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        navigator.locks.request(`many-${i}`, async lock => {
          callbackCount++;
          await navigator.locks.request(`many-inner-${i}`, async () => {
            resolveCount++;
          });
          return `completed-${lock!.name}`;
        }),
      );
    }
    await Promise.all(promises);
    expect(callbackCount).toBe(100);
    expect(resolveCount).toBe(100);
  });

  test("AsyncLocalStorage context is preserved across a synchronous grant", async () => {
    const als = new AsyncLocalStorage();
    const store = { id: "lock" };
    await als.run(store, () => {
      return navigator.locks.request("als-context", async () => {
        expect(als.getStore()).toBe(store);
      });
    });
  });

  test("AsyncLocalStorage context for deferred and queued grants matches Node", async () => {
    // Matches Node v26.3.0 in both async-context modes: a signal-deferred
    // immediate grant runs the callback under the requester's store, while a
    // queued grant's callback inherits the context active at grant dispatch,
    // which is the releaser's store, not the requester's.
    const als = new AsyncLocalStorage<{ id: string }>();
    const seen: string[] = [];
    const get = () => als.getStore()?.id ?? "none";

    await als.run({ id: "requester1" }, () =>
      navigator.locks.request("als-deferred", { signal: new AbortController().signal }, async () => {
        seen.push(`immediate+signal:${get()}`);
      }),
    );

    for (const [name, signal] of [
      ["als-queued", undefined],
      ["als-queued-signal", new AbortController().signal],
    ] as const) {
      const release = Promise.withResolvers<void>();
      const holder = als.run({ id: `releaser:${name}` }, () =>
        navigator.locks.request(name, async () => {
          await release.promise;
        }),
      );
      const waiter = als.run({ id: `requester:${name}` }, () =>
        navigator.locks.request(name, signal ? { signal } : {}, async () => {
          seen.push(`${name}:${get()}`);
        }),
      );
      release.resolve();
      await Promise.all([holder, waiter]);
    }

    expect(seen).toEqual([
      "immediate+signal:requester1",
      "als-queued:releaser:als-queued",
      "als-queued-signal:releaser:als-queued-signal",
    ]);
  });
});

describe("ifAvailable", () => {
  test("invokes the callback with null when the lock is busy", async () => {
    await navigator.locks.request("ifavailable", async () => {
      const result = await navigator.locks.request("ifavailable", { ifAvailable: true }, lock => {
        expect(lock).toBeNull();
        return "was-null";
      });
      expect(result).toBe("was-null");
      const other = await navigator.locks.request("ifavailable-other", { ifAvailable: true }, lock => lock !== null);
      expect(other).toBe(true);
    });
  });

  test("callback errors propagate on the miss path", async () => {
    const error = new Error("miss-boom");
    await navigator.locks.request("ifavailable-throw", async () => {
      await expect(
        navigator.locks.request("ifavailable-throw", { ifAvailable: true }, () => {
          throw error;
        }),
      ).rejects.toBe(error);
    });
  });
});

describe("steal", () => {
  test("steal with no existing holder grants normally", async () => {
    await navigator.locks.request("steal-simple", { steal: true }, lock => {
      expect(lock!.name).toBe("steal-simple");
      expect(lock!.mode).toBe("exclusive");
    });
  });

  test("steal rejects the original holder with AbortError", async () => {
    const granted = Promise.withResolvers<void>();
    const original = navigator.locks
      .request("steal-target", async () => {
        granted.resolve();
        await new Promise(() => {}); // held until stolen
        return "original-completed";
      })
      .catch(error => {
        expect(error).toBeInstanceOf(DOMException);
        expect(error.name).toBe("AbortError");
        expect(error.message).toBe("The operation was aborted");
        return "original-rejected";
      });
    await granted.promise;
    const stealResult = await navigator.locks.request("steal-target", { steal: true }, async lock => {
      expect(lock!.name).toBe("steal-target");
      expect(lock!.mode).toBe("exclusive");
      return "steal-completed";
    });
    expect(stealResult).toBe("steal-completed");
    expect(await original).toBe("original-rejected");
  });

  test("steal rejects every shared holder", async () => {
    const rejected: string[] = [];
    const a = navigator.locks
      .request("steal-shared", { mode: "shared" }, () => new Promise(() => {}))
      .catch(e => rejected.push("a:" + e.name));
    const b = navigator.locks
      .request("steal-shared", { mode: "shared" }, () => new Promise(() => {}))
      .catch(e => rejected.push("b:" + e.name));
    await navigator.locks.request("steal-shared", { steal: true }, () => {});
    await Promise.all([a, b]);
    expect(rejected.sort()).toEqual(["a:AbortError", "b:AbortError"]);
  });

  test("steal takes priority over earlier queued requests", async () => {
    const order: string[] = [];
    const holder = navigator.locks
      .request("steal-priority", () => new Promise(() => {}))
      .catch(e => order.push("holder:" + e.name));
    const pending = navigator.locks.request("steal-priority", () => {
      order.push("pending");
    });
    const stealer = navigator.locks.request("steal-priority", { steal: true }, () => {
      order.push("stealer");
    });
    await Promise.all([holder, pending, stealer]);
    expect(order[0]).toBe("stealer");
    expect(order).toContain("pending");
    expect(order).toContain("holder:AbortError");
  });

  test("a dc end subscriber stealing the same name re-entrantly rejects the outer steal", async () => {
    // The victim's locks.request.end event fires while the outer steal is
    // still being committed, so a subscriber stealing the same name from
    // there targets the outer request itself. The outer request must reject
    // with AbortError, and the registry must never report two exclusive
    // holders for the name.
    let reentered = false;
    const innerRelease = Promise.withResolvers<void>();
    let innerPromise: Promise<unknown> | undefined;
    const onEnd = () => {
      if (reentered) return;
      reentered = true;
      innerPromise = navigator.locks.request("steal-reenter", { steal: true }, async () => {
        await innerRelease.promise;
        return "inner";
      });
    };
    dc.subscribe("locks.request.end", onEnd);
    try {
      const victim = navigator.locks
        .request("steal-reenter", async () => {
          await new Promise(() => {});
        })
        .catch(e => e.name);
      const exclusiveCounts: number[] = [];
      const outer = navigator.locks
        .request("steal-reenter", { steal: true }, async () => {
          const q = await navigator.locks.query();
          exclusiveCounts.push(q.held.filter(h => h.name === "steal-reenter" && h.mode === "exclusive").length);
          return "outer";
        })
        .catch(e => e.name);
      expect(await outer).toBe("AbortError");
      expect(await victim).toBe("AbortError");
      // only the re-entrant stealer may hold the lock
      const q = await navigator.locks.query();
      expect(q.held.filter(h => h.name === "steal-reenter").map(h => h.mode)).toEqual(["exclusive"]);
      expect(exclusiveCounts.every(n => n <= 1)).toBe(true);
      innerRelease.resolve();
      expect(await innerPromise).toBe("inner");
    } finally {
      dc.unsubscribe("locks.request.end", onEnd);
    }
  });
});

describe("AbortSignal", () => {
  test("abort while pending rejects with the signal reason and skips the callback", async () => {
    const controller = new AbortController();
    const holderReleased = Promise.withResolvers<void>();
    const holder = navigator.locks.request("signal-pending", () => holderReleased.promise);
    let callbackRan = false;
    const reason = new Error("abort-reason");
    const aborted = navigator.locks.request("signal-pending", { signal: controller.signal }, () => {
      callbackRan = true;
    });
    controller.abort(reason);
    await expect(aborted).rejects.toBe(reason);
    holderReleased.resolve();
    await holder;
    // the aborted request is eventually granted internally and auto-released,
    // so the lock must be available again
    const available = await navigator.locks.request("signal-pending", { ifAvailable: true }, lock => lock !== null);
    expect(available).toBe(true);
    expect(callbackRan).toBe(false);
  });

  test("abort after grant does not reject the request", async () => {
    const controller = new AbortController();
    const result = await navigator.locks.request("signal-after-grant", { signal: controller.signal }, async () => {
      controller.abort();
      await Promise.resolve();
      return "completed successfully";
    });
    expect(result).toBe("completed successfully");
  });

  test("a signal whose aborted getter throws still releases the granted lock", async () => {
    // validateAbortSignal only checks that the property exists, so the
    // throw first fires inside the deferred-grant microtask, after the
    // grant was committed.
    const error = new Error("aborted-boom");
    await expect(
      navigator.locks.request(
        "aborted-getter-throws",
        {
          signal: {
            get aborted() {
              throw error;
            },
            throwIfAborted() {},
            addEventListener() {},
            removeEventListener() {},
          } as any,
        },
        () => "never",
      ),
    ).rejects.toBe(error);
    const available = await navigator.locks.request(
      "aborted-getter-throws",
      { ifAvailable: true },
      lock => lock !== null,
    );
    expect(available).toBe(true);
  });

  test("failed or orphaned abort listener registrations do not leak the request", async () => {
    // The request's Strong on the abort listener and the listener's captured
    // ref on the request form a cycle; every terminal path must disarm it:
    // a throwing addEventListener getter, a signal with no removeEventListener,
    // and a stolen holder whose callback never settles.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { heapStats } = require("bun:jsc");
        let rejections = 0;
        for (let i = 0; i < 1500; i++) {
          try {
            await navigator.locks.request("leak-add", { signal: {
              aborted: false,
              throwIfAborted() {},
              get addEventListener() { throw new Error("add-boom"); },
            } }, () => {});
          } catch {
            rejections++;
          }
        }
        for (let i = 0; i < 1500; i++) {
          await navigator.locks.request("leak-remove", { signal: {
            aborted: false,
            throwIfAborted() {},
            addEventListener() {},
          } }, () => {});
        }
        for (let i = 0; i < 500; i++) {
          const victim = navigator.locks
            .request("leak-steal", { signal: new AbortController().signal }, () => new Promise(() => {}))
            .catch(() => {});
          await Promise.resolve(); // let the deferred grant start the callback
          await navigator.locks.request("leak-steal", { steal: true }, () => {});
          await victim;
        }
        await new Promise(r => setTimeout(r, 0));
        Bun.gc(true);
        Bun.gc(true);
        const promises = heapStats().objectTypeCounts.Promise ?? 0;
        console.log("rejections:", rejections);
        console.log("promises:", promises < 1500 ? "collected" : "pinned: " + promises);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("rejections: 1500\npromises: collected\n");
    expect(exitCode).toBe(0);
  });
});

describe("query", () => {
  test("reports held and pending locks with clientId", async () => {
    const clientId = `node-${process.pid}-${workerThreads.threadId}`;
    const holderReleased = Promise.withResolvers<void>();
    const holder = navigator.locks.request("query-held", () => holderReleased.promise);
    const pendingRequest = navigator.locks.request("query-held", () => {});
    await navigator.locks.request("query-shared", { mode: "shared" }, async () => {
      const snapshot = await navigator.locks.query();
      expect(snapshot.held).toContainEqual({ name: "query-held", mode: "exclusive", clientId });
      expect(snapshot.held).toContainEqual({ name: "query-shared", mode: "shared", clientId });
      expect(snapshot.pending).toContainEqual({ name: "query-held", mode: "exclusive", clientId });
    });
    holderReleased.resolve();
    await Promise.all([holder, pendingRequest]);
    const finalSnapshot = await navigator.locks.query();
    expect(finalSnapshot.held.filter((l: any) => l.name.startsWith("query-"))).toEqual([]);
    expect(finalSnapshot.pending.filter((l: any) => l.name.startsWith("query-"))).toEqual([]);
  });

  test("query is per-thread: other threads' locks are not visible", async () => {
    await navigator.locks.request("query-main-held", async () => {
      const worker = new Worker(
        `
        const { parentPort, threadId } = require("worker_threads");
        navigator.locks.request("query-worker-held", async () => {
          const snapshot = await navigator.locks.query();
          parentPort.postMessage({ snapshot, threadId });
        });
        `,
        { eval: true },
      );
      try {
        const { snapshot, threadId } = await nextMessage(worker);
        expect(snapshot.held).toEqual([
          { name: "query-worker-held", mode: "exclusive", clientId: `node-${process.pid}-${threadId}` },
        ]);
        expect(snapshot.held.find((l: any) => l.name === "query-main-held")).toBeUndefined();
      } finally {
        await worker.terminate();
      }
    });
    const mainSnapshot = await navigator.locks.query();
    expect(mainSnapshot.held.find((l: any) => l.name === "query-worker-held")).toBeUndefined();
  });
});

describe("worker threads", () => {
  test("exclusive lock is held across threads and handed off on release", async () => {
    const sab = new SharedArrayBuffer(4);
    const flag = new Int32Array(sab);
    const workerResult = Promise.withResolvers<any>();
    await navigator.locks.request("xthread-handoff", async () => {
      const worker = new Worker(
        `
        const { parentPort, workerData } = require("worker_threads");
        const flag = new Int32Array(workerData);
        const granted = navigator.locks.request("xthread-handoff", async lock => {
          return { mode: lock.mode, flagAtGrant: Atomics.load(flag, 0) };
        });
        parentPort.postMessage("requesting");
        granted.then(result => parentPort.postMessage(result));
        `,
        { eval: true, workerData: sab },
      );
      const requesting = Promise.withResolvers<void>();
      worker.on("message", message => {
        if (message === "requesting") {
          requesting.resolve();
        } else {
          workerResult.resolve(message);
          worker.terminate();
        }
      });
      worker.once("error", error => {
        requesting.reject(error);
        workerResult.reject(error);
      });
      try {
        await requesting.promise;
        // the worker's request is already enqueued; record that the grant may
        // only happen after this point
        Atomics.store(flag, 0, 1);
      } catch (error) {
        await worker.terminate();
        throw error;
      }
    });
    const result = await workerResult.promise;
    expect(result).toEqual({ mode: "exclusive", flagAtGrant: 1 });
  });

  test("worker exit releases its held locks", async () => {
    const worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      navigator.locks.request("worker-exit-held", () => {
        parentPort.postMessage("held");
        // never settles; the lock is released when the worker exits
        return new Promise(() => {});
      });
      `,
      { eval: true },
    );
    try {
      expect(await nextMessage(worker)).toBe("held");
      // the worker's event loop is now empty aside from the never-settling
      // lock callback, so the worker exits and its lock must be cleaned up
      await navigator.locks.request("worker-exit-held", lock => {
        expect(lock!.name).toBe("worker-exit-held");
      });
    } finally {
      await worker.terminate();
    }
  });

  test("terminating a worker with a held lock releases it", async () => {
    const worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      navigator.locks.request("worker-terminate-held", () => {
        parentPort.postMessage("held");
        return new Promise(() => {});
      });
      // keep the worker alive
      setInterval(() => {}, 1000);
      `,
      { eval: true },
    );
    try {
      expect(await nextMessage(worker)).toBe("held");
      const waiter = navigator.locks.request("worker-terminate-held", lock => lock!.name);
      await worker.terminate();
      expect(await waiter).toBe("worker-terminate-held");
    } finally {
      await worker.terminate();
    }
  });

  test("terminating a worker with a pending request cleans it up", async () => {
    // port of node's "should clean up when worker is terminated with a pending lock"
    await navigator.locks.request("worker-terminate-pending", async () => {
      const worker = new Worker(
        `
        const { parentPort } = require("worker_threads");
        const request = navigator.locks.request("worker-terminate-pending", async () => "should-not-complete");
        parentPort.postMessage({ requesting: true });
        request.catch(() => {});
        setInterval(() => {}, 1000);
        `,
        { eval: true },
      );
      try {
        const message = await nextMessage(worker);
        expect(message).toEqual({ requesting: true });
      } finally {
        await worker.terminate();
      }
    });
    await navigator.locks.request("worker-terminate-pending", lock => {
      expect(lock!.name).toBe("worker-terminate-pending");
    });
  });

  test("a stolen holder rejects even if its callback settles before the steal notification arrives", async () => {
    const sab = new SharedArrayBuffer(4);
    const flag = new Int32Array(sab);
    const release = Promise.withResolvers<string>();
    const holder = navigator.locks.request("steal-settle-race", () => release.promise);
    const worker = new Worker(
      `
      const { workerData } = require("worker_threads");
      const flag = new Int32Array(workerData);
      navigator.locks.request("steal-settle-race", { steal: true }, () => {
        Atomics.store(flag, 0, 1);
        Atomics.notify(flag, 0);
        return new Promise(() => {});
      });
      setInterval(() => {}, 1000);
      `,
      { eval: true, workerData: sab },
    );
    try {
      // Busy-wait for the steal to commit, then settle the stolen holder's
      // callback immediately: its release usually runs before the stolen
      // notification task is processed, and the outcome must be AbortError in
      // either order.
      const deadline = Date.now() + 15_000;
      while (Atomics.load(flag, 0) === 0 && Date.now() < deadline) {}
      expect(Atomics.load(flag, 0)).toBe(1);
      release.resolve("finished-anyway");
      await expect(holder).rejects.toMatchObject({
        name: "AbortError",
        message: "The operation was aborted",
      });
    } finally {
      await worker.terminate();
    }
  });

  test("worker can steal a lock held by the main thread", async () => {
    const stolen = Promise.withResolvers<string>();
    const mainLock = navigator.locks
      .request("xthread-steal", () => new Promise(() => {}))
      .catch(e => stolen.resolve(e.name));
    const worker = new Worker(
      `
      const { parentPort } = require("worker_threads");
      navigator.locks
        .request("xthread-steal", { steal: true }, async lock => "worker-stole:" + lock.name)
        .then(result => parentPort.postMessage(result));
      `,
      { eval: true },
    );
    try {
      expect(await nextMessage(worker)).toBe("worker-stole:xthread-steal");
      expect(await stolen.promise).toBe("AbortError");
      await mainLock;
    } finally {
      await worker.terminate();
    }
  });
});

describe("process behavior", () => {
  test("pending lock requests do not keep the process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        navigator.locks.request("px", () => new Promise(() => {}));
        navigator.locks.request("px", () => { console.log("UNEXPECTED-GRANT"); });
        console.log("end-of-script");
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("end-of-script\n");
    expect(exitCode).toBe(0);
  });
});

describe("other realms", () => {
  test("a contended request from a ShadowRealm is granted and released", async () => {
    // The realm is a separate global (and script execution context) on the
    // same thread, so its grant arrives as a posted task addressed to the
    // realm's context, not the thread's default one.
    const name = "shadow-realm-lock";
    const release = Promise.withResolvers<void>();
    const holder = navigator.locks.request(name, () => release.promise);

    const granted = Promise.withResolvers<string>();
    const realm = new ShadowRealm();
    realm.evaluate(
      `cb => { navigator.locks.request(${JSON.stringify(name)}, lock => { cb(lock.name + ":" + lock.mode); }); undefined; }`,
    )(granted.resolve);

    release.resolve();
    await holder;
    expect(await granted.promise).toBe(`${name}:exclusive`);

    // the realm's callback returned undefined, so its lock released and the
    // name must be grantable from the main realm again
    const reacquired = await navigator.locks.request(name, { ifAvailable: true }, lock => lock !== null);
    expect(reacquired).toBe(true);
  });
});

describe("diagnostics_channel", () => {
  function subscribeAll(name: string) {
    const events: Record<string, any[]> = { start: [], grant: [], miss: [], end: [] };
    const handlers: Record<string, (e: any) => void> = {};
    for (const kind of ["start", "grant", "miss", "end"]) {
      handlers[kind] = (event: any) => {
        if (event.name === name) events[kind].push(event);
      };
      dc.subscribe(`locks.request.${kind}`, handlers[kind]);
    }
    return {
      events,
      [Symbol.dispose]() {
        for (const kind of ["start", "grant", "miss", "end"]) {
          dc.unsubscribe(`locks.request.${kind}`, handlers[kind]);
        }
      },
    };
  }

  test("emits start, grant, and end on success", async () => {
    using sub = subscribeAll("dc-normal");
    const result = await navigator.locks.request("dc-normal", async () => "done");
    expect(result).toBe("done");
    expect(sub.events.start).toEqual([{ name: "dc-normal", mode: "exclusive" }]);
    expect(sub.events.grant).toEqual([{ name: "dc-normal", mode: "exclusive" }]);
    expect(sub.events.miss).toEqual([]);
    expect(sub.events.end).toEqual([
      { name: "dc-normal", mode: "exclusive", ifAvailable: false, steal: false, error: undefined },
    ]);
  });

  test("emits start, miss, and end when the lock is unavailable", async () => {
    await navigator.locks.request("dc-miss", async () => {
      using sub = subscribeAll("dc-miss");
      const result = await navigator.locks.request("dc-miss", { ifAvailable: true }, lock => lock);
      expect(result).toBeNull();
      expect(sub.events.start).toEqual([{ name: "dc-miss", mode: "exclusive" }]);
      expect(sub.events.grant).toEqual([]);
      expect(sub.events.miss).toEqual([{ name: "dc-miss", mode: "exclusive" }]);
      expect(sub.events.end).toHaveLength(1);
    });
  });

  test("reports the callback error in the end event", async () => {
    using sub = subscribeAll("dc-error");
    const error = new Error("dc-boom");
    await expect(
      navigator.locks.request("dc-error", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(sub.events.end).toEqual([{ name: "dc-error", mode: "exclusive", ifAvailable: false, steal: false, error }]);
  });

  test("stolen lock ends the original request with AbortError", async () => {
    using sub = subscribeAll("dc-steal");
    const granted = Promise.withResolvers<void>();
    const original = navigator.locks
      .request("dc-steal", async () => {
        granted.resolve();
        await new Promise(() => {});
      })
      .catch(e => e.name);
    await granted.promise;
    await navigator.locks.request("dc-steal", { steal: true }, async () => {});
    expect(await original).toBe("AbortError");
    const stolenEnd = sub.events.end.find(e => !e.steal);
    const stealerEnd = sub.events.end.find(e => e.steal);
    expect(stolenEnd.error.name).toBe("AbortError");
    expect(stealerEnd.error).toBeUndefined();
    expect(sub.events.grant).toHaveLength(2);
    expect(sub.events.miss).toHaveLength(0);
  });

  test("a failed channel initialization neither breaks the request nor disables diagnostics", async () => {
    // The channels are created lazily on the thread's first request; if that
    // fails, the request must still work and the next request must retry.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dc = require("node:diagnostics_channel");
        const origChannel = dc.channel;
        dc.channel = () => { throw new Error("dc-init-boom"); };
        const first = await navigator.locks.request("dc-retry", () => "first");
        console.log("first:", first);
        dc.channel = origChannel;
        const events = [];
        dc.subscribe("locks.request.start", e => events.push(e.name));
        const second = await navigator.locks.request("dc-retry", () => "second");
        console.log("second:", second);
        console.log("events:", JSON.stringify(events));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe('first: first\nsecond: second\nevents: ["dc-retry"]\n');
    expect(exitCode).toBe(0);
  });
});
