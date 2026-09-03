import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import http2 from "http2";

describe("AsyncLocalStorage", () => {
  test("throw inside of AsyncLocalStorage.run() will be passed out", () => {
    const s = new AsyncLocalStorage();
    expect(() => {
      s.run(1, () => {
        throw new Error("error");
      });
    }).toThrow("error");
  });

  // The post-run restoration assert must account for getStore() falling
  // through to defaultValue once the entry is removed (debug builds only).
  test("run() works with a defaultValue and no prior context", () => {
    const s = new AsyncLocalStorage({ defaultValue: "def" });
    expect(s.run("x", () => 42)).toBe(42);
    expect(s.getStore()).toBe("def");

    // nested inside another storage's context: entry is spliced, not cleared
    const other = new AsyncLocalStorage();
    other.run(1, () => {
      const inner = new AsyncLocalStorage({ defaultValue: "d2" });
      expect(inner.run("y", () => 7)).toBe(7);
      expect(inner.getStore()).toBe("d2");
    });

    // disable() during the callback: run() finally re-enables (Node's is
    // unconditionally enterWith(prior)), so getStore() falls through to
    // defaultValue. Verified against Node v26.4.0 (both --async-context-frame
    // and --no-async-context-frame).
    const s3 = new AsyncLocalStorage({ defaultValue: "d3" });
    expect(
      s3.run("z", () => {
        s3.disable();
        return 9;
      }),
    ).toBe(9);
    expect(s3.getStore()).toBe("d3");

    // Bare disable() without run(): getStore() returns defaultValue, not
    // undefined (Node v26 both impls).
    const s4 = new AsyncLocalStorage({ defaultValue: "d4" });
    s4.enterWith("v");
    s4.disable();
    expect(s4.getStore()).toBe("d4");
  });

  // NaN is a legal store value in Node; === cannot compare it.
  // Verified against Node v26.3.0.
  test("NaN is usable as a store value and as defaultValue", () => {
    const s = new AsyncLocalStorage();
    expect(s.run(NaN, () => s.getStore())).toBeNaN();

    const withDefault = new AsyncLocalStorage({ defaultValue: NaN });
    expect(withDefault.run("x", () => 42)).toBe(42);
    expect(withDefault.getStore()).toBeNaN();

    const other = new AsyncLocalStorage();
    const s2 = new AsyncLocalStorage();
    try {
      other.enterWith("keep");
      s2.enterWith(NaN);
      expect(s2.getStore()).toBeNaN();
      expect(other.getStore()).toBe("keep");
    } finally {
      // enterWith() is not scoped: splice both back out so later tests still
      // start from an empty context.
      s2.disable();
      other.disable();
    }
  });

  // Node compares stores with the primordial ObjectIs, which userland cannot
  // reach. Subprocess: patches a global. Verified against Node v26.3.0.
  test("run() is unaffected by a userland Object.is patch", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Object.is = () => true;
         const { AsyncLocalStorage } = require("async_hooks");
         const s = new AsyncLocalStorage();
         console.log(s.run("v", () => s.getStore()));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "v", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // run() entered on a disabled storage must still restore on the way out:
  // node's finally is an unconditional enterWith(prior), so the store must not
  // survive past run(). Verified against Node v26.3.0.
  test("run() on a disabled storage does not leak the store past the callback", () => {
    const a = new AsyncLocalStorage();
    a.disable();
    expect(a.run("Y", () => a.getStore())).toBe("Y");
    expect(a.getStore()).toBeUndefined();

    const b = new AsyncLocalStorage({ defaultValue: "D" });
    b.disable();
    expect(b.run("Y", () => b.getStore())).toBe("Y");
    expect(b.getStore()).toBe("D");

    // ...including when the callback disables it again.
    const c = new AsyncLocalStorage({ defaultValue: "D" });
    c.disable();
    c.run("Y", () => c.disable());
    expect(c.getStore()).toBe("D");
  });

  // A snapshot-restored frame can hold a value for a disabled storage, which
  // getStore() masks with defaultValue — run() must not short-circuit on that
  // comparison and leave the masked value visible. Verified against Node v26.3.0.
  test("run() inside a snapshot does not expose a disabled storage's frame value", () => {
    const als = new AsyncLocalStorage<string>();
    let snap!: <T>(fn: () => T) => T;
    als.run("X", () => {
      snap = AsyncLocalStorage.snapshot();
    });
    als.disable();
    expect(snap(() => als.exit(() => als.getStore()))).toBeUndefined();

    const withDefault = new AsyncLocalStorage<string>({ defaultValue: "D" });
    let snap2!: <T>(fn: () => T) => T;
    withDefault.run("Y", () => {
      snap2 = AsyncLocalStorage.snapshot();
    });
    withDefault.disable();
    expect(snap2(() => withDefault.run(undefined, () => withDefault.getStore()))).toBeUndefined();
  });

  // run() on a disabled storage takes the full path and re-enables it.
  // Verified against Node.
  test("run(undefined)/exit() on a disabled storage re-enables it", () => {
    const als = new AsyncLocalStorage();
    als.disable();
    als.exit(() => {});
    als.run("Y", () => {});
    expect(als.getStore()).toBeUndefined();
  });

  // Behaviour verified against Node v26.4.0.
  test("run() short-circuits when the store value is unchanged (Object.is)", () => {
    const als1 = new AsyncLocalStorage();
    const als2 = new AsyncLocalStorage();
    const als3 = new AsyncLocalStorage({ defaultValue: "d" });
    try {
      // enterWith inside a same-value run survives past the run
      als1.enterWith("A");
      als1.run("A", () => als1.enterWith("B"));
      expect(als1.getStore()).toBe("B");

      // exit() on a fresh storage is a same-value (undefined) run
      als2.exit(() => als2.enterWith("C"));
      expect(als2.getStore()).toBe("C");

      // defaultValue counts as the "current" store
      als3.run("d", () => als3.enterWith("X"));
      expect(als3.getStore()).toBe("X");
    } finally {
      // enterWith() is not scoped: splice the entries back out so later
      // tests still start from an empty context.
      als1.disable();
      als2.disable();
      als3.disable();
    }
  });

  // Reaches the else-if(hasPrevious) re-enable branch in run()'s finally.
  test("disable() mid-run then finally restores the previous value", () => {
    const als = new AsyncLocalStorage();
    als.run("outer", () => {
      als.run("inner", () => als.disable());
      // Node v26: run's finally re-enters the previous value.
      expect(als.getStore()).toBe("outer");
    });
    expect(als.getStore()).toBeUndefined();

    // hasPrevious=true via enterWith, disable() mid-run of ANOTHER storage's callback.
    const alsA = new AsyncLocalStorage();
    const alsB = new AsyncLocalStorage();
    try {
      alsA.enterWith("prev");
      alsA.run("a", () => {
        alsB.run("b", () => alsA.disable());
        // Still inside alsA.run: finally hasn't fired yet, alsA is disabled.
        expect(alsA.getStore()).toBeUndefined();
      });
      expect(alsA.getStore()).toBe("prev");
    } finally {
      // alsB is spliced out by its own run(); enterWith('prev') is not scoped.
      alsA.disable();
    }
  });
});

// Node's disable() deletes the storage from the current frame object in place,
// so every disable() reaches continuations that captured that frame.
test("consecutive disable() calls exit continuations that captured the frame", async () => {
  const a = new AsyncLocalStorage();
  const b = new AsyncLocalStorage();
  a.enterWith(1);
  b.enterWith(2);
  const seen = Promise.all([
    new Promise(resolve => setTimeout(() => resolve([a.getStore(), b.getStore()]), 1)),
    Promise.resolve().then(() => [a.getStore(), b.getStore()]),
  ]);
  a.disable();
  b.disable();
  b.enterWith(3);
  expect(await seen).toEqual([
    [undefined, undefined],
    [undefined, undefined],
  ]);
  b.disable();
});

// Verified against Node v26: run()'s finally is enterWith(prior), so a binding
// the callback installed for the same storage is replaced, not stacked.
test("run() restores its own binding after enterWith()/withScope()/exit() inside the callback", () => {
  const a = new AsyncLocalStorage();
  a.run("outer", () => {
    a.run("inner", () => {
      using _ = a.withScope("scoped");
      expect(a.getStore()).toBe("scoped");
    });
    expect(a.getStore()).toBe("outer");
  });
  expect(a.getStore()).toBe(undefined);
  a.run(1, () => {
    a.run(2, () => {
      a.enterWith(3);
    });
    expect(a.getStore()).toBe(1);
    a.exit(() => {
      a.enterWith(4);
    });
    expect(a.getStore()).toBe(1);
  });
  expect(a.getStore()).toBe(undefined);
  // enterWith() of a storage bound below the run() frames copies them; the
  // restore must still go by value.
  const b = new AsyncLocalStorage();
  b.enterWith(0);
  a.run(1, () => {
    a.run(2, () => {
      a.run(3, () => {
        b.enterWith(9);
      });
      expect([a.getStore(), b.getStore()]).toEqual([2, 9]);
    });
    expect([a.getStore(), b.getStore()]).toEqual([1, 9]);
  });
  expect([a.getStore(), b.getStore()]).toEqual([undefined, 9]);
  b.disable();
  // disable() from inside a snapshot of the prior frame exits that frame in
  // place; run() still restores the value it saw on entry.
  a.enterWith(1);
  const resource = new AsyncResource("prior-frame");
  a.run(2, () => resource.runInAsyncScope(() => a.disable()));
  expect(a.getStore()).toBe(1);
  a.disable();
});

test("re-entering a storage inside run() does not grow the context", () => {
  const als = new AsyncLocalStorage();
  const other = new AsyncLocalStorage();
  const objects = () => {
    Bun.gc(true);
    return heapStats().objectCount;
  };
  als.run(0, () => {
    const before = objects();
    for (let i = 0; i < 100_000; i++) {
      als.run(1, () => {
        using _ = als.withScope(2);
      });
      als.run(1, () => {
        als.enterWith(3);
      });
      other.run(1, () => {
        other.disable();
      });
    }
    expect(objects() - before).toBeLessThan(1000);
    expect(als.getStore()).toBe(0);
  });
});

// Node's run() enters a fresh frame, so a disable() inside it only reaches
// continuations captured since; ones captured before keep their binding.
test("disable() inside another storage's run() does not reach earlier continuations", async () => {
  const a = new AsyncLocalStorage();
  const b = new AsyncLocalStorage();
  const seen = await a.run(1, () => {
    const earlier = new Promise(resolve => setTimeout(() => resolve(a.getStore()), 1));
    let during;
    b.run(2, () => {
      during = new Promise(resolve => setTimeout(() => resolve(a.getStore()), 1));
      a.disable();
    });
    a.run(5, () => {}); // re-enable
    return Promise.all([earlier, during]);
  });
  expect(seen).toEqual([1, undefined]);
});

// Node deletes from the current frame object only: a disable() run inside a
// snapshot of an older frame does not reach frames that were already derived
// from it, but frames derived afterwards inherit the deletion.
test("disable() inside a snapshot of an older frame only affects that frame and later copies", async () => {
  const a = new AsyncLocalStorage();
  const b = new AsyncLocalStorage();
  a.enterWith(1);
  const older = new AsyncResource("older"); // snapshot of the frame with a=1
  b.enterWith("x"); // current frame now derives from it
  const derivedBefore = new Promise(resolve => setTimeout(() => resolve([a.getStore(), b.getStore()]), 1));
  older.runInAsyncScope(() => a.disable());
  expect(a.getStore()).toBe(1); // current frame was derived before the delete
  const derivedAfter = older.runInAsyncScope(() => b.run(2, () => a.getStore()));
  expect(derivedAfter).toBe(undefined);
  expect(await derivedBefore).toEqual([1, "x"]);
  a.disable();
  b.disable();
});

test("re-entering after another storage's disable() stays cheap and does not inherit deeper deletions", () => {
  const a = new AsyncLocalStorage();
  const b = new AsyncLocalStorage();
  a.enterWith(0);
  b.enterWith(0);
  b.disable();
  for (let i = 0; i < 200; i++) a.enterWith(i); // must not blow up the frame's mask
  expect([a.getStore(), b.getStore()]).toEqual([199, undefined]);
  // Verified against Node v26: the delete happened on an older frame via a
  // snapshot; re-entering b from the current frame keeps a.
  a.enterWith(1);
  const older = new AsyncResource("older");
  b.enterWith(2);
  older.runInAsyncScope(() => a.disable());
  b.enterWith(3);
  expect([a.getStore(), b.getStore()]).toEqual([1, 3]);
  a.disable();
  b.disable();
});

test("AsyncResource", () => {
  const resource = new AsyncResource("prisma-client-request");
  var called = false;
  resource.runInAsyncScope(
    () => {
      called = true;
    },
    null,
    "foo",
    "bar",
  );
  expect(called).toBe(true);
});

describe("async context passes through", () => {
  test("syncronously", () => {
    const s = new AsyncLocalStorage();
    s.run("value", () => {
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    s.run("value", () => {
      s.run("second", () => {
        expect(s.getStore()).toBe("second");
      });
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("promise.then", async () => {
    const s = new AsyncLocalStorage<string>();
    let resolve!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    let v!: string;
    s.run("value", () => {
      promise.then(() => {
        v = s.getStore()!;
      });
    });
    resolve();
    await promise;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("nested promises", async () => {
    const s = new AsyncLocalStorage<string>();
    let resolve!: () => void;
    let resolve2!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    const promise2 = new Promise<void>(r => (resolve2 = r));
    let v!: string;
    const resolved = Promise.resolve(5);
    // console.log(1);
    s.run("value", () => {
      // console.log(2);
      promise.then(() => {
        // console.log(3);
        new Promise<void>(resolve => {
          // console.log(4);
          setTimeout(() => {
            // console.log(5);
            resolve();
          }, 1);
        }).then(() => {
          // console.log(6);
          resolved.then(() => {
            // console.log(7);
            v = s.getStore()!;
            resolve2();
          });
        });
      });
    });
    resolve();
    await promise2;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("await 1", async () => {
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      await 1;
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("await an actual promise", async () => {
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      await Promise.resolve(1);
      expect(s.getStore()).toBe("value");
      await Bun.sleep(2);
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("setTimeout", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    s.run("value", () => {
      expect(s.getStore()).toBe("value");
      setTimeout(() => {
        resolve(s.getStore()!);
      }, 2);
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("setInterval", async () => {
    let resolve: (x: string[]) => void;
    const promise = new Promise<string[]>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      const array: string[] = [];
      const interval = setInterval(() => {
        array.push(s.getStore()!);
        if (array.length === 3) {
          clearInterval(interval);
          resolve(array);
        }
      }, 5);
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toEqual(["value", "value", "value"]);
  });
  test("setImmediate", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      setImmediate(() => {
        resolve(s.getStore()!);
      });
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("process.nextTick", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      process.nextTick(() => {
        resolve(s.getStore()!);
      });
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("queueMicrotask", async () => {
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    const s = new AsyncLocalStorage<string>();
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");
      queueMicrotask(() => {
        resolve(s.getStore()!);
      });
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("promise catch", async () => {
    const s = new AsyncLocalStorage<string>();
    let reject!: () => void;
    let promise = new Promise<void>((_, r) => (reject = r));
    let v!: string;
    s.run("value", () => {
      promise = promise.catch(() => {
        v = s.getStore()!;
      });
    });
    reject();
    await promise;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("promise finally", async () => {
    const s = new AsyncLocalStorage<string>();
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    let v!: string;
    s.run("value", () => {
      promise = promise.finally(() => {
        v = s.getStore()!;
      });
    });
    resolve();
    await promise;
    expect(v).toBe("value");
    expect(s.getStore()).toBe(undefined);
  });
  test("fetch", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      const response = await fetch(server.url) //
        .then(r => {
          expect(s.getStore()).toBe("value");
          return true;
        });
      expect(s.getStore()).toBe("value");
      expect(response).toBe(true);
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("Bun.spawn() onExit", async () => {
    const s = new AsyncLocalStorage<string>();
    let value: string | undefined;
    let resolve!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    await s.run("value", () => {
      expect(s.getStore()).toBe("value");

      const x = Bun.spawn({
        cmd: [bunExe(), "help"],
        env: bunEnv,
        onExit(subprocess, exitCode, signalCode, error) {
          value = s.getStore()!;
          resolve();
        },
      });

      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    await promise;
    expect(value).toBe("value");
  });
  test("Bun.serve", async () => {
    const s = new AsyncLocalStorage<string>();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");

      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          return new Response(s.getStore()!);
        },
      });

      const response = await fetch("http://" + server.hostname + ":" + server.port);
      expect(await response.text()).toBe("value");

      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .start", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    s.run("value", async () => {
      stream = new ReadableStream({
        start(controller) {
          controller.enqueue(s.getStore()!);
          controller.close();
        },
      });
    });
    const reader = stream.getReader();
    const result = await reader.read();
    expect(result.value).toBe("value");
    const result2 = await reader.read();
    expect(result2.done).toBe(true);
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .pull", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    s.run("value", async () => {
      stream = new ReadableStream(
        {
          start(controller) {
            controller.enqueue(new Uint8Array(500));
          },
          pull(controller) {
            controller.enqueue(s.getStore()!);
            controller.close();
          },
        },
        {
          highWaterMark: 1,
          size() {
            return 500;
          },
        },
      );
    });
    const reader = stream.getReader();
    const result = await reader.read();
    const result2 = await reader.read();
    expect(result2.value).toBe("value");
    const result3 = await reader.read();
    expect(result3.done).toBe(true);
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .pull 2", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let n = 0;
    s.run("value", async () => {
      stream = new ReadableStream(
        {
          start(controller) {
            controller.enqueue(new Uint8Array(500));
          },
          async pull(controller) {
            controller.enqueue(s.getStore()!);
            n++;
            if (n < 5) {
              await new Promise(r => setTimeout(r, 1));
            } else {
              controller.close();
            }
          },
        },
        {
          highWaterMark: 1,
          size() {
            return 500;
          },
        },
      );
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    const result = await reader.read();
    const result2 = await reader.read();
    expect(result2.value).toBe("value");
    const result3 = await reader.read();
    expect(result3.value).toBe("value");
    const result4 = await reader.read();
    expect(result4.value).toBe("value");
    const result5 = await reader.read();
    expect(result5.value).toBe("value");
    const result6 = await reader.read();
    expect(result6.value).toBe("value");
    const result7 = await reader.read();
    expect(result7.done).toBe(true);
    expect(s.getStore()).toBe(undefined);
  });
  test("readable stream .cancel", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let value: string | undefined;
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    s.run("value", async () => {
      stream = new ReadableStream({
        start(controller) {},
        cancel(reason) {
          value = s.getStore();
          resolve();
        },
      });
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    reader.cancel();
    await promise;
    expect(value).toBe("value");
  });
  test("readable stream direct .pull", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let value: string | undefined;
    let value2: string | undefined;
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    s.run("value", async () => {
      stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          value = s.getStore();
          controller.write("hello");
          controller.close();
          resolve();
        },
        cancel(reason) {},
      });
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    await reader.read();
    await promise;
    expect(value).toBe("value");
  });
  // blocked by a bug with .cancel
  test.todo("readable stream direct .cancel", async () => {
    const s = new AsyncLocalStorage<string>();
    let stream!: ReadableStream;
    let value: string | undefined;
    let value2: string | undefined;
    let resolve!: () => void;
    let promise = new Promise<void>(r => (resolve = r));
    s.run("value", async () => {
      stream = new ReadableStream({
        type: "direct",
        pull(controller) {
          value = s.getStore();
          controller.write("hello");
        },
        cancel(reason) {
          console.log("1");
          value2 = s.getStore();
          resolve();
        },
      });
    });
    expect(s.getStore()).toBe(undefined);
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    await stream.cancel();
    await promise;
    expect(value).toBe("value");
    expect(value2).toBe("value");
  });
  test("Websocket Server", async () => {
    const s = new AsyncLocalStorage<string>();
    let values_server: string[] = [];
    const { promise, resolve } = Promise.withResolvers();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");

      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          if (server.upgrade(request)) return null as any;
          return new Response(s.getStore()!);
        },
        websocket: {
          open(ws) {
            values_server.push("open:" + s.getStore());
          },
          message(ws, message) {
            values_server.push("message:" + s.getStore());
            ws.close();
          },
          close(ws, code, message) {
            values_server.push("close:" + s.getStore());
          },
        },
      });

      const ws = new WebSocket("ws://" + server.hostname + ":" + server.port);
      ws.addEventListener("open", () => {
        ws.send("hello");
      });
      ws.addEventListener("close", () => {
        resolve();
      });
      await promise;
    });
    expect(s.getStore()).toBe(undefined);
    expect(values_server).toEqual(["open:value", "message:value", "close:value"]);
  });
  test.todo("WebSocket client", async () => {
    const s = new AsyncLocalStorage<string>();
    let values_client: string[] = [];
    const { promise, resolve } = Promise.withResolvers();
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");

      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          if (server.upgrade(request)) return null as any;
          return new Response(s.getStore()!);
        },
        websocket: {
          open(ws) {},
          message(ws, message) {
            ws.close();
          },
          close(ws, code, message) {},
        },
      });

      const ws = new WebSocket("ws://" + server.hostname + ":" + server.port);
      ws.addEventListener("open", () => {
        ws.send("hello");
        values_client.push("open:" + s.getStore());
      });
      ws.addEventListener("close", () => {
        resolve();
        values_client.push("close:" + s.getStore());
      });
    });
    expect(s.getStore()).toBe(undefined);
    await promise;
    expect(values_client).toEqual(["open:value", "close:value"]);
  });
  test("node:fs callback", async () => {
    const fs = require("fs");
    const s = new AsyncLocalStorage<string>();
    let resolve: (x: string) => void;
    const promise = new Promise<string>(r => (resolve = r));
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      fs.readFile(import.meta.path, () => {
        resolve(s.getStore()!);
      });
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    expect(await promise).toBe("value");
  });
  test("node:fs/promises", async () => {
    const fs = require("fs").promises;
    const s = new AsyncLocalStorage<string>();
    let v!: string;
    await s.run("value", async () => {
      expect(s.getStore()).toBe("value");
      await fs.readFile(import.meta.path).then(() => {
        v = s.getStore()!;
      });
      expect(s.getStore()).toBe("value");
    });
    expect(s.getStore()).toBe(undefined);
    expect(v).toBe("value");
  });
  test("http2 client stream: native events see request-time context; user emit sees caller context", async () => {
    const s = new AsyncLocalStorage<string>();
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const client = http2.connect(`http://127.0.0.1:${port}`);
    try {
      const req = s.run("REQUEST", () => client.request({ ":path": "/" }));

      // Native-driven events observe the context captured at request() time.
      const responseStore = new Promise(r => req.on("response", () => r(s.getStore())));
      const dataStore = new Promise(r => req.on("data", () => r(s.getStore())));
      const endStore = new Promise(r => req.on("end", () => r(s.getStore())));
      const closeStore = new Promise(r => req.on("close", () => r(s.getStore())));
      req.end();
      expect(await responseStore).toBe("REQUEST");
      expect(await dataStore).toBe("REQUEST");
      expect(await endStore).toBe("REQUEST");
      expect(await closeStore).toBe("REQUEST");

      // User-initiated emit() observes the CALLER's context (Node semantics —
      // only native→JS callbacks re-enter the resource scope; Bun swaps the
      // frame at the #Handlers seam, not by overriding emit()).
      let customStore;
      req.on("custom", () => {
        customStore = s.getStore();
      });
      s.run("USER", () => req.emit("custom"));
      expect(customStore).toBe("USER");

      // Session-level 'close' must observe the SESSION's construction-time
      // context (undefined here), not the last stream's — Node fires it in
      // the Http2Session AsyncWrap scope, not any Http2Stream's. The
      // withStreamFrame-wrapped streamEnd calls self.destroy() while the
      // stream's frame is installed, so destroy() must run its own emits in
      // the session frame.
      const sessionCloseStore = new Promise(r => client.on("close", () => r(s.getStore())));
      client.close();
      expect(await sessionCloseStore).toBeUndefined();
    } finally {
      if (!client.destroyed) client.destroy();
      await new Promise(r => server.close(r));
    }
  });
  // An error in the window between onSocket() and onSocketNT() must still see
  // the request's context: the socket listeners are frame-wrapped, and an
  // unset frame would clear it. Verified against Node v26.3.0.
  test("http: a socket error before onSocketNT keeps the request's context", async () => {
    const http = require("http");
    const net = require("net");
    const s = new AsyncLocalStorage<string>();
    const { promise, resolve, reject } = Promise.withResolvers<string>();

    const agent = new http.Agent();
    let injected: import("net").Socket | undefined;
    agent.createConnection = function () {
      const sock = new net.Socket();
      injected = sock;
      let armed = false;
      const on = sock.on.bind(sock);
      sock.on = function (ev, fn) {
        const r = on(ev, fn);
        // Arm once, during onSocket()'s own socket.on("error") registration, so
        // it fires before onSocket()'s process.nextTick(onSocketNT, ...).
        if (ev === "error" && !armed) {
          armed = true;
          process.nextTick(() => sock.emit("error", new Error("boom")));
        }
        return r;
      };
      return sock;
    };

    try {
      s.run("X", () => {
        const req = http.request({ host: "127.0.0.1", port: 1, agent });
        // Assert on the injected error specifically: a connect-refusal error
        // reaching here instead means the pre-onSocketNT window was missed and
        // the test would otherwise pass without exercising the fix.
        req.on("error", err => resolve(`${(err as Error).message}|${s.getStore()}`));
        req.on("response", () => reject(new Error("unexpected response")));
        req.end();
      });

      expect(await promise).toBe("boom|X");
    } finally {
      injected?.destroy();
      agent.destroy();
    }
  });

  test("http agent reuse: req 'error'/'close' see the reused request's context", async () => {
    const http = require("http");
    const net = require("net");
    const s = new AsyncLocalStorage<string>();
    let dataHits = 0;
    // Keep-alive reuses ONE connection: first request served, second RST'd.
    const server = net.createServer(sock => {
      sock.on("data", () => {
        dataHits++;
        if (dataHits === 1) sock.write("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\nok");
        else sock.resetAndDestroy();
      });
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const { errorStore, closeStore } = await new Promise<{ errorStore: unknown; closeStore: unknown }>(
        (resolve, reject) => {
          s.run("first", () => {
            const r1 = http.request({ host: "127.0.0.1", port, agent }, res => {
              res.resume();
              res.on("end", () => {
                // setImmediate() lets the agent register the freed socket.
                setImmediate(() => {
                  s.run("second", () => {
                    const r2 = http.request({ host: "127.0.0.1", port, agent });
                    let errorStore: unknown, closeStore: unknown;
                    r2.on("error", () => {
                      errorStore = s.getStore();
                    });
                    r2.on("close", () => {
                      closeStore = s.getStore();
                      resolve({ errorStore, closeStore });
                    });
                    r2.end();
                  });
                });
              });
            });
            r1.on("error", reject);
            r1.end();
          });
        },
      );
      expect(errorStore).toBe("second");
      expect(closeStore).toBe("second");
    } finally {
      agent.destroy();
      await new Promise(r => server.close(r));
    }
  });
  test("http.request clears its captured async-context frame on 'close'", async () => {
    const http = require("http");
    const server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const agent = new http.Agent({ keepAlive: true });
    const s = new AsyncLocalStorage<object>();
    let req: any;
    try {
      await s.run(
        { marker: true },
        () =>
          new Promise<void>((resolve, reject) => {
            req = http.request({ host: "127.0.0.1", port, agent }, res => {
              res.resume();
            });
            req.on("error", reject);
            req.on("close", resolve);
            req.end();
          }),
      );
      // req is retained past 'close'; closeRequest() must have cleared the
      // frame slot so the store is not pinned by the retained request. This
      // is Bun's counterpart to Node's parser.initialize resource leak (Bun's
      // parser binding ignores the resource argument, so the vendored
      // test-async-local-storage-http-parser-leak.js is a compat-only no-op
      // — this is the coverage that fails if the closeRequest cleanup drops).
      const kClientAsyncContext = Object.getOwnPropertySymbols(req).find(
        sym => sym.description === "kClientAsyncContext",
      );
      expect(kClientAsyncContext).toBeDefined();
      expect(req[kClientAsyncContext!]).toBeUndefined();
    } finally {
      agent.destroy();
      await new Promise(r => server.close(r));
    }
  });
  // http2 counterpart of the http1 cleanup above: a stream/session retained
  // past its terminal event must not pin the store.
  test("http2 clears its captured async-context frame on stream and session close", async () => {
    const server = http2.createServer((_req, res) => res.end("ok"));
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as import("net").AddressInfo).port;
    const s = new AsyncLocalStorage<object>();
    let stream: any, client: any;
    let closed!: Promise<void>;
    try {
      await s.run(
        { marker: true },
        () =>
          new Promise<void>((resolve, reject) => {
            client = http2.connect(`http://127.0.0.1:${port}`);
            client.on("error", reject);
            // Registered before the await: the session can close on its own and
            // this must not miss the event.
            closed = new Promise<void>(r => client.on("close", () => r()));
            stream = client.request({ ":path": "/" });
            stream.on("error", reject);
            stream.resume();
            stream.on("close", () => resolve());
            stream.end();
          }),
      );
      const frameSym = Object.getOwnPropertySymbols(stream).find(
        sym => sym.description === "::bunhttp2asynccontextframe::",
      );
      expect(frameSym).toBeDefined();
      expect(stream[frameSym!]).toBeUndefined();

      client.close();
      await closed;
      expect(client[frameSym!]).toBeUndefined();
    } finally {
      if (client && !client.destroyed) client.destroy();
      await new Promise(r => server.close(r));
    }
  });

  // The session frame is read-and-cleared before the emit, so a throwing
  // 'close' listener cannot leave a retained session pinning the store.
  // Subprocess: the listener throws, which the test runner would otherwise
  // claim as its own failure.
  test("http2 clears the session frame even if a 'close' listener throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http2 = require("http2");
         const als = new AsyncLocalStorage();
         const server = http2.createServer((_q, r) => r.end("ok"));
         server.listen(0, () => {
           let client;
           als.run({ marker: true }, () => {
             client = http2.connect("http://127.0.0.1:" + server.address().port);
             const s = client.request({ ":path": "/" });
             s.resume();
             s.on("close", () => client.close());
             s.end();
           });
           client.on("close", () => { throw new Error("listener boom"); });
           client.on("error", () => {});
           // The throw IS the condition: it can only come from the 'close'
           // emit, which runs strictly after the read-and-clear.
           process.on("uncaughtException", err => {
             if (err.message !== "listener boom") throw err;
             const sym = Object.getOwnPropertySymbols(client)
               .find(x => x.description === "::bunhttp2asynccontextframe::");
             console.log(sym === undefined ? "SYMBOL-MISSING" : client[sym] === undefined ? "CLEARED" : "PINNED");
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // destroy(err) with no 'error' listener throws out of the emit, which must
  // not skip the frame clear (the 'close' tick after it never runs).
  test("http2 clears the session frame when destroy(err) throws past the emit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http2 = require("http2");
         const als = new AsyncLocalStorage();
         const server = http2.createServer((_q, r) => r.end("ok"));
         server.listen(0, () => {
           let client;
           als.run({ marker: true }, () => {
             client = http2.connect("http://127.0.0.1:" + server.address().port);
           });
           client.on("connect", () => {
             try { client.destroy(new Error("boom")); } catch {}
             const sym = Object.getOwnPropertySymbols(client)
               .find(x => x.description === "::bunhttp2asynccontextframe::");
             console.log(sym === undefined ? "SYMBOL-MISSING" : client[sym] === undefined ? "CLEARED" : "PINNED");
             // Drain rather than process.exit(), like the siblings.
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // _destroy emits 'aborted' (and can reach user code via end()/push(null))
  // before it finishes; the clear must not sit downstream of that. The throw is
  // swallowed into the stream's 'error', so this leak is otherwise silent.
  test("http2 clears the stream frame even if an 'aborted' listener throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http2 = require("http2");
         const als = new AsyncLocalStorage();
         const server = http2.createServer((_q, r) => { r.write("a"); });
         server.listen(0, () => {
           const client = http2.connect("http://127.0.0.1:" + server.address().port);
           let st;
           // endStream:false keeps the writable side open: like Node, destroy()
           // only emits 'aborted' for a stream whose writable side has not ended
           // (a plain GET ends it up front, so 'aborted' would never fire).
           als.run({ marker: true }, () => {
             st = client.request({ ":path": "/" }, { endStream: false });
             st.resume();
           });
           st.on("aborted", () => { throw new Error("aborted boom"); });
           st.on("response", () => st.destroy());
           // The throw is swallowed into the stream's 'error' — that event IS
           // the condition, and it fires after _destroy has unwound. ('close'
           // never arrives: the throw aborts the destroy.)
           st.on("error", err => {
             if (err.message !== "aborted boom") throw err;
             const sym = Object.getOwnPropertySymbols(st)
               .find(x => x.description === "::bunhttp2asynccontextframe::");
             console.log(sym === undefined ? "SYMBOL-MISSING" : st[sym] === undefined ? "CLEARED" : "PINNED");
             // Tear the session down and let the loop drain: exiting with the
             // session still open leaks it, which aborts under ASAN.
             client.destroy();
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // The upgrade/connect branch emits before closeRequest(), which carries the
  // clear; a throwing handler must not leave the request pinning the store.
  test("http clears the request frame even if an 'upgrade' handler throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { AsyncLocalStorage } = require("async_hooks");
         const http = require("http");
         const net = require("net");
         const als = new AsyncLocalStorage();
         const server = net.createServer(sock => {
           sock.once("data", () => sock.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: x\\r\\nConnection: Upgrade\\r\\n\\r\\n"));
         });
         server.listen(0, "127.0.0.1", () => {
           let req;
           als.run({ marker: true }, () => {
             req = http.request({ host: "127.0.0.1", port: server.address().port, headers: { Connection: "Upgrade", Upgrade: "x" } });
             req.end();
           });
           req.on("error", () => {});
           let upgraded;
           req.on("upgrade", (_res, socket) => { upgraded = socket; throw new Error("upgrade boom"); });
           process.on("uncaughtException", err => {
             if (err.message !== "upgrade boom") throw err;
             const sym = Object.getOwnPropertySymbols(req)
               .find(x => x.description === "kClientAsyncContext");
             console.log(sym === undefined ? "SYMBOL-MISSING" : req[sym] === undefined ? "CLEARED" : "PINNED");
             // Close the upgraded socket too: exiting with it open leaks it,
             // which aborts under ASAN.
             upgraded?.destroy();
             server.close();
           });
         });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "CLEARED", exitCode: 0 });
    expect(stderr).not.toContain("AssertionError");
  });

  // run()'s same-value short-circuit must not spread its rest args, or a
  // tampered Array.prototype[Symbol.iterator] breaks it. The main path is
  // already covered by test-repl-array-prototype-tempering.js.
  test("run() short-circuit survives a deleted Array.prototype[Symbol.iterator]", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { AsyncLocalStorage } = require("async_hooks");
          require("node:util");
          const als = new AsyncLocalStorage();
          als.enterWith("v");
          delete Array.prototype[Symbol.iterator];
          console.log(als.run("v", (a, b) => a + "/" + b, "x", "y"));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("Spread syntax");
    expect(stderr).not.toContain("is not iterable");
    expect(stdout.trim()).toBe("x/y");
    expect(exitCode).toBe(0);
  });

  test("Bun.build plugin", async () => {
    const s = new AsyncLocalStorage<string>();
    let a = undefined;
    await s.run("value", async () => {
      return Bun.build({
        entrypoints: [import.meta.path],
        target: "bun",
        plugins: [
          {
            name: "test",
            setup(build) {
              a = s.getStore();
            },
          },
        ],
      });
    });
    expect(a).toBe("value");
  });
});

describe("async generators", () => {
  // WebKit c8b6308aaa69 introduced a cooperative async-generator driver
  // (InternalMicrotask::AsyncGeneratorDriverResume) as the fast path for
  // `for await` over a pristine async generator. It must capture and
  // restore Bun's async context like every other resume-body microtask.
  test("for await over an async generator preserves the store", async () => {
    const als = new AsyncLocalStorage();
    async function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }
    const seen: unknown[] = [];
    await als.run("STORE_A", async () => {
      for await (const x of gen()) {
        seen.push([x, als.getStore()]);
      }
      seen.push(["done", als.getStore()]);
    });
    expect(seen).toEqual([
      [1, "STORE_A"],
      [2, "STORE_A"],
      [3, "STORE_A"],
      ["done", "STORE_A"],
    ]);
  });

  test("for await body sees its own store, not an interleaved one", async () => {
    const als = new AsyncLocalStorage();
    async function* gen() {
      yield 1;
      yield 2;
    }
    const seen: unknown[] = [];
    await Promise.all([
      als.run("A", async () => {
        for await (const x of gen()) seen.push(["A-loop", x, als.getStore()]);
      }),
      als.run("B", async () => {
        for await (const x of gen()) seen.push(["B-loop", x, als.getStore()]);
      }),
    ]);
    for (const [tag, , store] of seen) {
      expect(store).toBe(tag === "A-loop" ? "A" : "B");
    }
    expect(seen.length).toBe(4);
  });

  test("thrown from async generator preserves the store in the catch", async () => {
    const als = new AsyncLocalStorage();
    async function* gen() {
      yield 1;
      throw new Error("boom");
    }
    let caughtStore: unknown;
    await als.run("STORE_X", async () => {
      try {
        for await (const _ of gen()) {
          expect(als.getStore()).toBe("STORE_X");
        }
      } catch (e) {
        expect((e as Error).message).toBe("boom");
        caughtStore = als.getStore();
      }
    });
    expect(caughtStore).toBe("STORE_X");
  });
});

// A frame installed with enterWith() inside an event-loop callback belongs to
// that callback: it must not be inherited by unrelated callbacks that run later
// (they run under whatever they captured when scheduled, like Node's
// CallbackScope), and anything it references must become collectable.
describe("enterWith() does not leak past the callback that called it", () => {
  async function run(src: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout: stdout.trim().split("\n"), exitCode };
  }
  const prelude = `const { AsyncLocalStorage } = require("node:async_hooks"); const als = new AsyncLocalStorage(); const seen = []; process.on("exit", () => { seen.push("exit:" + als.getStore()); console.log(seen.join("\\n")); });`;

  test.concurrent("timers, immediates, I/O callbacks", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const fs = require("node:fs");
        setTimeout(() => { als.enterWith("timer1"); seen.push("timer1:" + als.getStore()); }, 1);
        setTimeout(() => { seen.push("timer2:" + als.getStore()); }, 20);
        setImmediate(() => { als.enterWith("immediate1"); });
        setImmediate(() => { seen.push("immediate2:" + als.getStore()); });
        setImmediate(() => { queueMicrotask(() => als.enterWith("immediate3-microtask")); process.nextTick(() => als.enterWith("immediate3-tick")); });
        setImmediate(() => { seen.push("immediate4:" + als.getStore()); });
        setTimeout(() => { Promise.resolve().then(() => { als.enterWith("timer5-reaction"); }); }, 5);
        setTimeout(() => { seen.push("timer6:" + als.getStore()); }, 5);
        fs.readFile(__filename, () => {
          als.enterWith("readFile");
          setTimeout(() => { seen.push("timer-in-readFile:" + als.getStore()); }, 1);
          fs.readFile(__filename, () => { seen.push("readFile2:" + als.getStore()); });
        });
        setTimeout(() => { seen.push("timer3:" + als.getStore()); }, 60);
      `,
    );
    expect(stdout.toSorted()).toEqual([
      "exit:undefined",
      "immediate2:undefined",
      "immediate4:undefined",
      "readFile2:readFile",
      "timer-in-readFile:readFile",
      "timer1:timer1",
      "timer2:undefined",
      "timer3:undefined",
      "timer6:undefined",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("promise reactions and microtasks run under the frame they captured", async () => {
    const { stdout, exitCode } = await run(
      prelude +
        `
        const early = Promise.resolve().then(() => { als.enterWith("reaction1"); seen.push("reaction1:" + als.getStore()); });
        Promise.resolve().then(() => { seen.push("reaction2:" + als.getStore()); });
        queueMicrotask(() => { seen.push("microtask:" + als.getStore()); });
        process.nextTick(() => { seen.push("nextTick:" + als.getStore()); });
        (async () => { await early; seen.push("after-await:" + als.getStore()); })();
        als.run("run", () => {
          Promise.resolve().then(() => { seen.push("reaction-in-run:" + als.getStore()); });
        });
        // top-level enterWith after everything above was scheduled: none of it inherits this
        als.enterWith("top");
        seen.push("sync:" + als.getStore());
        setTimeout(() => { seen.push("timer-after-top:" + als.getStore()); });
      `,
    );
    expect(stdout.toSorted()).toEqual([
      "after-await:undefined",
      "exit:undefined",
      "microtask:undefined",
      "nextTick:undefined",
      "reaction-in-run:run",
      "reaction1:reaction1",
      "reaction2:undefined",
      "sync:top",
      "timer-after-top:top",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "a server handler's enterWith() is not seen by the next request and its store is collectable",
    async () => {
      const { stdout, exitCode } = await run(
        prelude +
          `
        const registry = new FinalizationRegistry(id => { collected++; });
        let collected = 0;
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            const inherited = als.getStore();
            const store = { id: new URL(req.url).pathname, payload: new Uint8Array(1024 * 1024) };
            registry.register(store, store.id);
            als.enterWith(store);
            return new Response(String(inherited && inherited.id));
          },
        });
        (async () => {
          for (let i = 0; i < 20; i++) {
            const res = await fetch(server.url + "req" + i);
            seen.push(await res.text());
          }
          server.stop(true);
          for (let i = 0; i < 20 && collected < 19; i++) { Bun.gc(true); await new Promise(r => setTimeout(r, 10)); }
          // every store but (at most) the last one must be gone
          const inherited = seen.filter(body => body !== "undefined");
          seen.length = 0;
          seen.push("inherited:" + inherited.length);
          seen.push("collected>=19:" + (collected >= 19));
        })();
      `,
      );
      expect(stdout).toEqual(["inherited:0", "collected>=19:true", "exit:undefined"]);
      expect(exitCode).toBe(0);
    },
  );
});

// With a store active, awaiting and .then() must not allocate side objects to
// carry the frame (it rides in the reaction / microtask itself).
test("an active store adds no per-await / per-then helper allocations", () => {
  const als = new AsyncLocalStorage();
  const N = 5000;
  const count = () => {
    Bun.gc(true);
    return heapStats().objectTypeCounts.InternalFieldTuple ?? 0;
  };
  const keep: unknown[] = [];
  const never = new Promise(() => {});
  const delta = als.run({ store: 1 }, () => {
    const before = count();
    for (let i = 0; i < N; i++) {
      keep.push(
        (async () => {
          await never;
        })(),
      );
      keep.push(never.then(() => {}));
      keep.push(
        never.then(
          () => {},
          () => {},
        ),
      );
    }
    return count() - before;
  });
  expect(keep.length).toBe(N * 3);
  expect(delta).toBeLessThan(50);
});
