import { sleep } from "bun";
import { heapStats } from "bun:jsc";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createRequire } from "module";
import { join } from "path";

// this is also testing that imports with default and named imports in the same statement work
// our transpiler transform changes this to a var with import.meta.require
import EventEmitter, {
  captureRejectionSymbol,
  getEventListeners,
  getMaxListeners,
  listenerCount,
  setMaxListeners,
} from "node:events";

describe("node:events", () => {
  test("captureRejectionSymbol", () => {
    expect(EventEmitter.captureRejectionSymbol).toBeDefined();
    expect(captureRejectionSymbol).toBeDefined();
    expect(captureRejectionSymbol).toBe(EventEmitter.captureRejectionSymbol);
  });

  test("once", done => {
    const emitter = new EventEmitter();
    EventEmitter.once(emitter, "hey").then(x => {
      try {
        expect(x).toEqual([1, 5]);
      } catch (error) {
        done(error);
      }
      done();
    });
    emitter.emit("hey", 1, 5);
  });

  test("once (abort)", done => {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    EventEmitter.once(emitter, "hey", { signal: controller.signal })
      .then(() => done(new Error("Should not be called")))
      .catch(() => done());
    controller.abort();
  });

  test("once (two events in same tick)", done => {
    const emitter = new EventEmitter();
    EventEmitter.once(emitter, "hey").then(() => {
      EventEmitter.once(emitter, "hey").then(data => {
        try {
          expect(data).toEqual([3]);
        } catch (error) {
          done(error);
        }
        done();
      });
      setTimeout(() => {
        emitter.emit("hey", 3);
      }, 10);
    });
    emitter.emit("hey", 1);
    emitter.emit("hey", 2);
  });

  /// https://github.com/oven-sh/bun/issues/4518
  test("once removes the listener afterwards", async () => {
    const emitter = new EventEmitter();
    process.nextTick(() => {
      emitter.emit("hey", 1);
    });
    const promise = EventEmitter.once(emitter, "hey");
    expect(emitter.listenerCount("hey")).toBe(1);
    await promise;
    expect(emitter.listenerCount("hey")).toBe(0);
  });

  // `events.once()` is an `async function` in Node: a bad `options`, a bad
  // `options.signal`, or an already-aborted signal must produce a *rejected
  // promise*, never a synchronous throw.
  test("once is an async function", () => {
    expect(EventEmitter.once.constructor.name).toBe("AsyncFunction");
  });

  test("once with already-aborted signal rejects (not a synchronous throw)", async () => {
    const ee = new EventEmitter();
    const p = EventEmitter.once(ee, "foo", { signal: AbortSignal.abort() });
    expect(p).toBeInstanceOf(Promise);
    await expect(p).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
  });

  test("once with invalid options.signal rejects (not a synchronous throw)", async () => {
    for (const signal of [1, {}, "hi", null, false]) {
      const ee = new EventEmitter();
      const p = EventEmitter.once(ee, "foo", { signal } as any);
      expect(p).toBeInstanceOf(Promise);
      await expect(p).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
    }
  });

  test("once with non-object options rejects (not a synchronous throw)", async () => {
    const ee = new EventEmitter();
    const p = EventEmitter.once(ee, "foo", "hi" as any);
    expect(p).toBeInstanceOf(Promise);
    await expect(p).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
  });

  test("once rejects with the value emitted on 'error' and removes both listeners", async () => {
    const emitter = new EventEmitter();
    const p = EventEmitter.once(emitter, "hey");
    const err = new Error("boom");
    emitter.emit("error", err);
    await expect(p).rejects.toBe(err);
    expect([emitter.listenerCount("hey"), emitter.listenerCount("error")]).toEqual([0, 0]);
  });

  test("once settles once when the event fires and the signal aborts afterwards", async () => {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    const p = EventEmitter.once(emitter, "hey", { signal: controller.signal });
    emitter.emit("hey", 42);
    controller.abort();
    expect(await p).toEqual([42]);
    expect([emitter.listenerCount("hey"), emitter.listenerCount("error")]).toEqual([0, 0]);
  });

  test("once resolves with the Event dispatched on an EventTarget and ignores later events", async () => {
    const target = new EventTarget();
    const p = EventEmitter.once(target, "ping");
    const event = new Event("ping");
    target.dispatchEvent(event);
    target.dispatchEvent(new Event("ping"));
    const [received] = await p;
    expect(received).toBe(event);
  });
});

describe("EventEmitter", () => {
  test("getEventListeners", () => {
    expect(getEventListeners(new EventEmitter(), "hey").length).toBe(0);
    const emitter = new EventEmitter();
    emitter.on("hey", () => {});
    expect(getEventListeners(emitter, "hey").length).toBe(1);
  });

  test("constructor", () => {
    var emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    expect(emitter.getMaxListeners()).toBe(100);
  });

  test("removeAllListeners()", () => {
    var emitter = new EventEmitter() as any;
    var ran = false;
    emitter.on("hey", () => {
      ran = true;
    });
    emitter.on("hey", () => {
      ran = true;
    });
    emitter.on("exit", () => {
      ran = true;
    });
    const { _events } = emitter;
    emitter.removeAllListeners();
    expect(emitter.listenerCount("hey")).toBe(0);
    expect(emitter.listenerCount("exit")).toBe(0);
    emitter.emit("hey");
    emitter.emit("exit");
    expect(ran).toBe(false);
    expect(_events).not.toBe(emitter._events); // This looks wrong but node.js replaces it too
    emitter.on("hey", () => {
      ran = true;
    });
    emitter.emit("hey");
    expect(ran).toBe(true);
    expect(emitter.listenerCount("hey")).toBe(1);
  });

  test("removeAllListeners(type)", () => {
    var emitter = new EventEmitter();
    var ran = false;
    emitter.on("hey", () => {
      ran = true;
    });
    emitter.on("exit", () => {
      ran = true;
    });
    expect(emitter.listenerCount("hey")).toBe(1);
    emitter.removeAllListeners("hey");
    expect(emitter.listenerCount("hey")).toBe(0);
    expect(emitter.listenerCount("exit")).toBe(1);
    emitter.emit("hey");
    expect(ran).toBe(false);
    emitter.emit("exit");
    expect(ran).toBe(true);
  });

  // These are also tests for the done() function in the test runner.
  describe("emit", () => {
    test("different tick", done => {
      var emitter = new EventEmitter();
      emitter.on("wow", () => done());
      queueMicrotask(() => {
        emitter.emit("wow");
      });
    });

    // Unlike Jest, bun supports async and done
    test("async microtask before", done => {
      (async () => {
        await 1;
        var emitter = new EventEmitter();
        emitter.on("wow", () => done());
        emitter.emit("wow");
      })();
    });

    test("async microtask after", done => {
      (async () => {
        var emitter = new EventEmitter();
        emitter.on("wow", () => done());
        await 1;
        emitter.emit("wow");
      })();
    });

    test("same tick", done => {
      var emitter = new EventEmitter();

      emitter.on("wow", () => done());

      emitter.emit("wow");
    });

    test("setTimeout task", done => {
      var emitter = new EventEmitter();
      emitter.on("wow", () => done());
      setTimeout(() => emitter.emit("wow"), 1);
    });

    test("emit multiple values", () => {
      const emitter = new EventEmitter();

      const receivedVals: number[] = [];
      emitter.on("multiple-vals", (val1, val2, val3) => {
        receivedVals[0] = val1;
        receivedVals[1] = val2;
        receivedVals[2] = val3;
      });

      emitter.emit("multiple-vals", 1, 2, 3);

      expect(receivedVals).toEqual([1, 2, 3]);
    });
  });

  test("addListener return type", () => {
    var myEmitter = new EventEmitter();
    expect(myEmitter.addListener("foo", () => {})).toBe(myEmitter);
  });

  test("addListener validates function", () => {
    var myEmitter = new EventEmitter();
    expect(() => myEmitter.addListener("foo", {} as any)).toThrow();
  });

  test("removeListener return type", () => {
    var myEmitter = new EventEmitter();
    expect(myEmitter.removeListener("foo", () => {})).toBe(myEmitter);
  });

  test("once", () => {
    var myEmitter = new EventEmitter();
    var calls = 0;

    const fn = () => {
      calls++;
    };

    myEmitter.once("foo", fn);

    expect(myEmitter.listenerCount("foo")).toBe(1);
    expect(myEmitter.listeners("foo")).toEqual([fn]);

    myEmitter.emit("foo");
    myEmitter.emit("foo");

    expect(calls).toBe(1);
    expect(myEmitter.listenerCount("foo")).toBe(0);
  });

  test("addListener/removeListener aliases", () => {
    expect(EventEmitter.prototype.addListener).toBe(EventEmitter.prototype.on);
    expect(EventEmitter.prototype.removeListener).toBe(EventEmitter.prototype.off);
  });

  test("prependListener", () => {
    const myEmitter = new EventEmitter();
    const order: number[] = [];

    myEmitter.on("foo", () => {
      order.push(1);
    });

    myEmitter.prependListener("foo", () => {
      order.push(2);
    });

    myEmitter.prependListener("foo", () => {
      order.push(3);
    });

    myEmitter.on("foo", () => {
      order.push(4);
    });

    myEmitter.emit("foo");

    expect(order).toEqual([3, 2, 1, 4]);
  });

  test("prependOnceListener", () => {
    const myEmitter = new EventEmitter();
    const order: number[] = [];

    myEmitter.on("foo", () => {
      order.push(1);
    });

    myEmitter.prependOnceListener("foo", () => {
      order.push(2);
    });
    myEmitter.prependOnceListener("foo", () => {
      order.push(3);
    });

    myEmitter.on("foo", () => {
      order.push(4);
    });

    myEmitter.emit("foo");

    expect(order).toEqual([3, 2, 1, 4]);

    myEmitter.emit("foo");

    expect(order).toEqual([3, 2, 1, 4, 1, 4]);
  });

  test("prependListener in callback", () => {
    const myEmitter = new EventEmitter();
    const order: number[] = [];

    myEmitter.on("foo", () => {
      order.push(1);
    });

    myEmitter.once("foo", () => {
      myEmitter.prependListener("foo", () => {
        order.push(2);
      });
    });

    myEmitter.on("foo", () => {
      order.push(3);
    });

    myEmitter.emit("foo");

    expect(order).toEqual([1, 3]);

    myEmitter.emit("foo");

    expect(order).toEqual([1, 3, 2, 1, 3]);
  });

  test("addListener in callback", () => {
    const myEmitter = new EventEmitter();
    const order: number[] = [];

    myEmitter.on("foo", () => {
      order.push(1);
    });

    myEmitter.once("foo", () => {
      myEmitter.addListener("foo", () => {
        order.push(2);
      });
    });

    myEmitter.on("foo", () => {
      order.push(3);
    });

    myEmitter.emit("foo");

    expect(order).toEqual([1, 3]);

    myEmitter.emit("foo");

    expect(order).toEqual([1, 3, 1, 3, 2]);
  });

  test("listeners", () => {
    const myEmitter = new EventEmitter();
    const fn = () => {};
    myEmitter.on("foo", fn);
    expect(myEmitter.listeners("foo")).toEqual([fn]);
    const fn2 = () => {};
    myEmitter.on("foo", fn2);
    expect(myEmitter.listeners("foo")).toEqual([fn, fn2]);
    myEmitter.off("foo", fn2);
    expect(myEmitter.listeners("foo")).toEqual([fn]);
    const fn3 = () => {};
    myEmitter.once("foo", fn3);
    expect(myEmitter.listeners("foo")).toEqual([fn, fn3]);
  });

  test("rawListeners", () => {
    const myEmitter = new EventEmitter();
    const fn = () => {};
    myEmitter.on("foo", fn);
    expect(myEmitter.rawListeners("foo")).toEqual([fn]);
    const fn2 = () => {};
    myEmitter.on("foo", fn2);
    expect(myEmitter.rawListeners("foo")).toEqual([fn, fn2]);
    myEmitter.off("foo", fn2);
    expect(myEmitter.rawListeners("foo")).toEqual([fn]);
    const fn3 = () => {};
    myEmitter.once("foo", fn3);
    const rawListeners: (Function & { listener?: Function })[] = myEmitter.rawListeners("foo");
    // rawListeners() returns onceWrappers as well
    expect([rawListeners[0], rawListeners[1].listener]).toEqual([fn, fn3]);
  });

  test("eventNames", () => {
    const myEmitter = new EventEmitter();
    expect(myEmitter.eventNames()).toEqual([]);
    const fn = () => {};
    myEmitter.on("foo", fn);
    expect(myEmitter.eventNames()).toEqual(["foo"]);
    myEmitter.on("bar", () => {});
    expect(myEmitter.eventNames()).toEqual(["foo", "bar"]);
    myEmitter.off("foo", fn);
    expect(myEmitter.eventNames()).toEqual(["bar"]);
  });

  test("_eventsCount", () => {
    const myEmitter = new EventEmitter() as EventEmitter & {
      _eventsCount: number;
    };
    expect(myEmitter._eventsCount).toBe(0);
    myEmitter.on("foo", () => {});
    expect(myEmitter._eventsCount).toBe(1);
    myEmitter.on("foo", () => {});
    expect(myEmitter._eventsCount).toBe(1);
    myEmitter.on("bar", () => {});
    expect(myEmitter._eventsCount).toBe(2);
    myEmitter.on("foo", () => {});
    expect(myEmitter._eventsCount).toBe(2);
    myEmitter.on("bar", () => {});
    expect(myEmitter._eventsCount).toBe(2);
    myEmitter.removeAllListeners("foo");
    expect(myEmitter._eventsCount).toBe(1);
  });

  test("events.init", () => {
    // init is a undocumented property that is identical to the constructor except it doesn't return the instance
    // in node, EventEmitter just calls init()
    let instance = Object.create(EventEmitter.prototype);
    (EventEmitter as any).init.call(instance);
    expect(instance._eventsCount).toBe(0);
    expect(instance._maxListeners).toBeUndefined();
    expect(instance._events).toEqual({});
    expect(instance instanceof EventEmitter).toBe(true);
  });
});

describe("EventEmitter.on", () => {
  test("Basic test", async () => {
    const emitter = new EventEmitter();
    const asyncIterator = EventEmitter.on(emitter, "hey");

    expect(asyncIterator.next).toBeDefined();
    expect(asyncIterator[Symbol.asyncIterator]).toBeDefined();

    process.nextTick(() => {
      emitter.emit("hey", 1);
    });

    const { value } = await asyncIterator.next();
    expect(value).toEqual([1]);
  });

  test("Basic test with for await...of", async () => {
    const emitter = new EventEmitter();
    const asyncIterator = EventEmitter.on(emitter, "hey", { close: ["close"] } as any);

    process.nextTick(() => {
      emitter.emit("hey", 1);
      emitter.emit("hey", 2);
      emitter.emit("hey", 3);
      emitter.emit("hey", 4);
      emitter.emit("close");
    });

    const result: any[][] = [];
    for await (const ev of asyncIterator) {
      result.push(ev);
    }

    expect(result).toEqual([[1], [2], [3], [4]]);
  });

  test("Stop reading events after 'close' event is emitted", async () => {
    const emitter = new EventEmitter();
    const asyncIterator = EventEmitter.on(emitter, "hey", { close: ["close"] } as any);

    process.nextTick(() => {
      emitter.emit("hey", 1);
      emitter.emit("hey", 2);
      emitter.emit("close");
      emitter.emit("hey", 3);
    });

    const result: any[][] = [];
    for await (const ev of asyncIterator) {
      result.push(ev);
    }

    expect(result).toEqual([[1], [2]]);
  });

  test("Queue events before first next() call", async () => {
    const emitter = new EventEmitter();
    const asyncIterator = EventEmitter.on(emitter, "hey");

    emitter.emit("hey", 1);
    emitter.emit("hey", 2);
    emitter.emit("hey", 3);

    await new Promise(resolve => setTimeout(resolve, 1));

    expect((await asyncIterator.next()).value).toEqual([1]);
    expect((await asyncIterator.next()).value).toEqual([2]);
    expect((await asyncIterator.next()).value).toEqual([3]);
  });

  test("Emit multiple values", async () => {
    const emitter = new EventEmitter();
    const asyncIterator = EventEmitter.on(emitter, "hey");

    emitter.emit("hey", 1, 2, 3);

    const { value } = await asyncIterator.next();
    expect(value).toEqual([1, 2, 3]);
  });

  test("kFirstEventParam", async () => {
    const kFirstEventParam = Symbol.for("nodejs.kFirstEventParam");
    const emitter = new EventEmitter();
    const asyncIterator = EventEmitter.on(emitter, "hey", { [kFirstEventParam]: true } as any);

    emitter.emit("hey", 1, 2, 3);
    emitter.emit("hey", [4, 5, 6]);

    expect((await asyncIterator.next()).value).toBe<number>(1);
    expect((await asyncIterator.next()).value).toEqual([4, 5, 6]);
  });

  test("Cancel via error event", async () => {
    const { on, EventEmitter } = require("node:events");
    const process = require("node:process");

    const ee = new EventEmitter();
    const output: unknown[] = [];

    // Emit later on
    process.nextTick(() => {
      ee.emit("foo", "bar");
      ee.emit("foo", 42);
      ee.emit("foo", "baz");
    });

    setTimeout(() => {
      ee.emit("error", "DONE");
    }, 1);

    try {
      for await (const event of on(ee, "foo")) {
        output.push([1, event]);
      }
    } catch (error) {
      output.push([2, error]);
    }

    expect(output).toEqual([
      [1, ["bar"]],
      [1, [42]],
      [1, ["baz"]],
      [2, "DONE"],
    ]);
  });

  test("AbortController", async () => {
    const { on, EventEmitter } = require("node:events");

    const ac = new AbortController();
    const ee = new EventEmitter();
    const output: unknown[] = [];

    process.nextTick(() => {
      ee.emit("foo", "bar");
      ee.emit("foo", 42);
      ee.emit("foo", "baz");
    });
    const consumed = (async () => {
      try {
        for await (const event of on(ee, "foo", { signal: ac.signal })) {
          output.push([1, event]);
        }
        output.push(["unreachable"]);
      } catch (error: any) {
        const { name, code, message, cause } = error;
        output.push([2, { name, code, message, cause }]);
      }
    })();

    process.nextTick(() => ac.abort());
    await consumed;

    expect(output).toEqual([
      [1, ["bar"]],
      [1, [42]],
      [1, ["baz"]],
      [
        2,
        {
          name: "AbortError",
          code: "ABORT_ERR",
          message: "The operation was aborted",
          cause: ac.signal.reason,
        },
      ],
    ]);
  });

  // Checks for potential issues with FixedQueue size
  test("Queue many events", async () => {
    const emitter = new EventEmitter();
    const asyncIterator = EventEmitter.on(emitter, "hey");

    for (let i = 0; i < 2500; i += 1) {
      emitter.emit("hey", i);
    }

    expect((await asyncIterator.next()).value).toEqual([0]);
  });

  test("does not resume the emitter after a close event", async () => {
    const calls: string[] = [];
    const emitter = Object.assign(new EventEmitter(), {
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
    });
    const asyncIterator = EventEmitter.on(emitter, "hey", { close: ["close"], highWaterMark: 2 } as any);

    // The third queued event exceeds highWaterMark and pauses the emitter.
    for (let i = 0; i < 4; i++) emitter.emit("hey", i);
    emitter.emit("close");

    const result: any[][] = [];
    for await (const ev of asyncIterator) result.push(ev);

    expect({ result, calls }).toEqual({ result: [[0], [1], [2], [3]], calls: ["pause"] });
  });

  test("readline.createInterface", async () => {
    const { createInterface } = require("node:readline");
    const { createReadStream } = require("node:fs");
    const path = require("node:path");

    const fpath = path.join(__filename, "..", "..", "child_process", "fixtures", "child-process-echo-options.js");
    const text = await Bun.file(fpath).text();
    const interfaced = createInterface(createReadStream(fpath));
    const output: string[] = [];

    try {
      for await (const line of interfaced) {
        output.push(line);
      }
    } catch (e) {}
    const out = text.replaceAll("\r\n", "\n").trim().split("\n");
    expect(output).toEqual(out);
  });
});

describe("EventEmitter error handling", () => {
  test("unhandled error event throws on emit", () => {
    const myEmitter = new EventEmitter();

    expect(() => {
      myEmitter.emit("error", "Hello!");
    }).toThrow("Hello!");
  });

  test("unhandled error event throws on emit with no arguments", () => {
    const myEmitter = new EventEmitter();

    expect(() => {
      myEmitter.emit("error");
    }).toThrow("Unhandled error.");
  });

  test("handled error event", () => {
    const myEmitter = new EventEmitter();

    let handled = false;
    myEmitter.on("error", (...args) => {
      expect(args).toEqual(["Hello", "World"]);
      handled = true;
    });

    myEmitter.emit("error", "Hello", "World");

    expect(handled).toBe(true);
  });

  test("errorMonitor", () => {
    const myEmitter = new EventEmitter();

    let handled = false;
    myEmitter.on(EventEmitter.errorMonitor, (...args) => {
      expect(args).toEqual(["Hello", "World"]);
      handled = true;
    });

    myEmitter.on("error", () => {});

    myEmitter.emit("error", "Hello", "World");

    expect(handled).toBe(true);
  });

  test("errorMonitor (unhandled)", () => {
    const myEmitter = new EventEmitter();

    let handled = false;
    myEmitter.on(EventEmitter.errorMonitor, (...args) => {
      expect(args).toEqual(["Hello", "World"]);
      handled = true;
    });

    expect(() => {
      myEmitter.emit("error", "Hello", "World");
    }).toThrow("Hello");

    expect(handled).toBe(true);
  });
});

describe("EventEmitter captureRejections", () => {
  // Can't catch the unhandled rejection because we do not have process.on("unhandledRejection")
  // test("captureRejections off will not capture rejections", async () => {
  //   const myEmitter = new EventEmitter();

  //   let handled = false;
  //   myEmitter.on("error", (...args) => {
  //     handled = true;
  //   });

  //   myEmitter.on("action", async () => {
  //     throw new Error("Hello World");
  //   });

  //   myEmitter.emit("action");

  //   await sleep(1);

  //   expect(handled).toBe(false);
  // });
  test("it captures rejections", async () => {
    const myEmitter = new EventEmitter({ captureRejections: true });

    let handled: any = null;
    myEmitter.on("error", (...args) => {
      handled = args;
    });

    myEmitter.on("action", async () => {
      throw 123;
    });

    myEmitter.emit("action");

    await sleep(5);

    expect(handled).toEqual([123]);
  });
  test("it does not capture successful promises", async () => {
    const myEmitter = new EventEmitter({ captureRejections: true });

    let handled: any = null;
    myEmitter.on("error", () => {
      handled = true;
    });

    myEmitter.on("action", async () => {
      return 123;
    });

    myEmitter.emit("action");

    await sleep(5);

    expect(handled).toEqual(null);
  });
  test("it does not capture handled rejections", async () => {
    const myEmitter = new EventEmitter({ captureRejections: true });

    let handled: any = null;
    myEmitter.on("error", () => {
      handled = true;
    });

    myEmitter.on("action", async () => {
      return Promise.reject(123).catch(() => 234);
    });

    myEmitter.emit("action");

    await sleep(5);

    expect(handled).toEqual(null);
  });
});

const waysOfCreating = [
  () => Object.create(EventEmitter.prototype),
  () => new EventEmitter(),
  () => new (class extends EventEmitter {})(),
  () => {
    class MyEmitter extends EventEmitter {}
    return new MyEmitter();
  },
  () => {
    var foo = {};
    Object.setPrototypeOf(foo, EventEmitter.prototype);
    return foo;
  },
  () => {
    function FakeEmitter(this: any) {
      return EventEmitter.call(this);
    }
    Object.setPrototypeOf(FakeEmitter.prototype, EventEmitter.prototype);
    Object.setPrototypeOf(FakeEmitter, EventEmitter);
    return new (FakeEmitter as any)();
  },
  () => {
    const FakeEmitter: any = function FakeEmitter(this: any) {
      EventEmitter.call(this);
    } as any;
    Object.assign(FakeEmitter.prototype, EventEmitter.prototype);
    Object.assign(FakeEmitter, EventEmitter);
    return new FakeEmitter();
  },
  () => {
    var foo = {};
    Object.assign(foo, EventEmitter.prototype);
    return foo;
  },
];

describe("EventEmitter constructors", () => {
  for (let create of waysOfCreating) {
    test(`${create
      .toString()
      .slice(6, 52)
      .replaceAll("\n", "")
      .trim()
      .replaceAll(/ {2,}/g, " ")
      .replace(/^\{ ?/, "")} should work`, () => {
      var myEmitter = create();
      var called = false;
      (myEmitter as EventEmitter).once("event", function () {
        called = true;
        // @ts-ignore
        expect(this).toBe(myEmitter);
      });
      var firstEvents = myEmitter._events;
      expect(myEmitter.listenerCount("event")).toBe(1);

      expect(myEmitter.emit("event")).toBe(true);
      expect(myEmitter.listenerCount("event")).toBe(0);

      expect(firstEvents).toEqual({ event: firstEvents.event }); // it shouldn't mutate
      expect(called).toBe(true);
    });
  }

  test("with createRequire, events is callable", () => {
    const req = createRequire(import.meta.path);
    const events = req("events");
    new events();
  });

  test("in cjs, events is callable", () => {
    const EventEmitter = require("events");
    new EventEmitter();
  });
});

test("addAbortListener", async () => {
  const emitter = new EventEmitter();
  const controller = new AbortController();
  const promise = EventEmitter.once(emitter, "hey", { signal: controller.signal });
  const mocked = mock();
  EventEmitter.addAbortListener(controller.signal, mocked);
  controller.abort();
  expect(promise).rejects.toThrow("aborted");
  expect(mocked).toHaveBeenCalled();
});

test("using addAbortListener", async () => {
  const emitter = new EventEmitter();
  const controller = new AbortController();
  const promise = EventEmitter.once(emitter, "hey", { signal: controller.signal });
  const mocked = mock();
  {
    using aborty = EventEmitter.addAbortListener(controller.signal, mocked);
  }
  controller.abort();
  expect(promise).rejects.toThrow("aborted");
  expect(mocked).not.toHaveBeenCalled();
});

describe("addAbortListener resists stopImmediatePropagation", () => {
  test("runs after an earlier listener stopped propagation", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const order: string[] = [];

    signal.addEventListener("abort", e => {
      order.push("stopper");
      e.stopImmediatePropagation();
    });
    EventEmitter.addAbortListener(signal, e => {
      order.push(`cleanup:${(e as Event).target === signal}`);
    });
    signal.addEventListener("abort", () => order.push("plain-after"));

    controller.abort();
    expect(order).toEqual(["stopper", "cleanup:true"]);
  });

  test("runs when it was registered before the listener that stops propagation", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const order: string[] = [];

    EventEmitter.addAbortListener(signal, () => order.push("cleanup"));
    signal.addEventListener("abort", e => {
      order.push("stopper");
      e.stopImmediatePropagation();
    });
    signal.addEventListener("abort", () => order.push("plain-after"));

    controller.abort();
    expect(order).toEqual(["cleanup", "stopper"]);
  });

  test("is not run once disposed", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const mocked = mock();

    signal.addEventListener("abort", e => e.stopImmediatePropagation());
    {
      using _ = EventEmitter.addAbortListener(signal, mocked);
    }

    controller.abort();
    expect(mocked).not.toHaveBeenCalled();
  });

  test("once(emitter, event, { signal }) still rejects on a suppressed signal", async () => {
    const emitter = new EventEmitter();
    const controller = new AbortController();
    controller.signal.addEventListener("abort", e => e.stopImmediatePropagation());

    const promise = EventEmitter.once(emitter, "never", { signal: controller.signal });
    expect(emitter.listenerCount("never")).toBe(1);
    controller.abort();

    // once()'s abort listener detaches the emitter listener and rejects, both synchronously.
    expect(emitter.listenerCount("never")).toBe(0);
    expect(await promise.catch(err => err.code)).toBe("ABORT_ERR");
  });

  test("stopImmediatePropagation still suppresses ordinary listeners", () => {
    const target = new EventTarget();
    const order: string[] = [];

    target.addEventListener("x", () => order.push("a"));
    target.addEventListener("x", e => {
      order.push("b");
      e.stopImmediatePropagation();
    });
    target.addEventListener("x", () => order.push("c"));

    target.dispatchEvent(new Event("x"));
    expect(order).toEqual(["a", "b"]);
  });
});

test("getMaxListeners", () => {
  const emitter = new EventEmitter();
  expect(emitter.getMaxListeners()).toBe(10);
  emitter.setMaxListeners(20);
  expect(emitter.getMaxListeners()).toBe(20);
});

test("setMaxListeners", () => {
  const emitter = new EventEmitter();
  expect(emitter.getMaxListeners()).toBe(10);
  emitter.setMaxListeners(20);
  expect(emitter.getMaxListeners()).toBe(20);

  setMaxListeners(30, emitter);
  expect(emitter.getMaxListeners()).toBe(30);

  const eventTarget = new EventTarget();
  setMaxListeners(1, eventTarget);
  expect(getMaxListeners(eventTarget)).toBe(1);

  setMaxListeners(99, eventTarget);
  expect(getMaxListeners(eventTarget)).toBe(99);
});

test("getEventListeners", () => {
  const target = new EventTarget();
  expect(getEventListeners(target, "hey").length).toBe(0);
  target.addEventListener("hey", () => {}, { once: true });
  expect(getEventListeners(target, "hey").length).toBe(1);
  target.dispatchEvent(new Event("hey"));
  expect(getEventListeners(target, "hey").length).toBe(0);
});

test("EventEmitter.prototype.listenerCount", () => {
  const ee = new EventEmitter();
  const a = () => {};
  const b = () => {};

  expect(ee.listenerCount("x")).toBe(0);
  expect(ee.listenerCount("x", a)).toBe(0);

  ee.on("x", a);
  expect(ee.listenerCount("x")).toBe(1);
  expect(ee.listenerCount("x", a)).toBe(1);
  expect(ee.listenerCount("x", b)).toBe(0);

  ee.on("x", b);
  expect(ee.listenerCount("x")).toBe(2);
  expect(ee.listenerCount("x", a)).toBe(1);
  expect(ee.listenerCount("x", b)).toBe(1);

  ee.once("y", a);
  expect(ee.listenerCount("y")).toBe(1);
  expect(ee.listenerCount("y", a)).toBe(1);

  // null/undefined listener arg means "count all", same as omitting it
  expect(ee.listenerCount("x", null as any)).toBe(2);
  expect(ee.listenerCount("x", undefined)).toBe(2);
});

test("events.listenerCount validates emitter argument", () => {
  const ee = new EventEmitter();
  ee.on("y", () => {});
  expect(listenerCount(ee, "y")).toBe(1);

  const et = new EventTarget();
  et.addEventListener("k", () => {});
  et.addEventListener("k", () => {});
  expect(listenerCount(et, "k")).toBe(2);

  const np = Object.create(null);
  EventEmitter.call(np);
  EventEmitter.prototype.on.call(np, "y", () => {});

  for (const bad of [{}, 42, np]) {
    expect(() => listenerCount(bad as any, "y")).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
    );
  }
});

test("EventEmitter.name", () => {
  expect(EventEmitter.name).toBe("EventEmitter");
});

// A fired once() wrapper must drop its closure refs so holding it (a cached
// rawListeners() result, the COW array emit() iterates) does not retain the
// emitter. wrapped.listener stays: node asserts it survives emit.
test("once() wrapper releases its target after firing", async () => {
  const src = `
    const { EventEmitter } = require("events");
    const held = [];
    const total = 8;
    let collected = 0;
    const registry = new FinalizationRegistry(() => collected++);
    (function () {
      for (let i = 0; i < total; i++) {
        const ee = new EventEmitter();
        ee.once("x", function () {});
        held.push(ee.rawListeners("x")[0]);
        ee.emit("x");
        registry.register(ee);
      }
    })();
    let iters = 0;
    setImmediate(function check() {
      Bun.gc(true);
      if (collected === total) {
        console.log("collected " + collected + "/" + total + " holding " + held.length + " wrappers");
        return;
      }
      if (++iters > 50) {
        console.log("stuck " + collected + "/" + total + " holding " + held.length + " wrappers");
        process.exit(1);
      }
      setImmediate(check);
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: "collected 8/8 holding 8 wrappers",
    stderr: "",
    exitCode: 0,
  });
});

describe("native EventEmitter propagates an exception from a `_events` getter", () => {
  // The native EventEmitter prototype (process's) reads `this._events` when `this` is not a native
  // emitter; a throwing getter must propagate rather than become "invalid this".
  const nativeProto = Object.getPrototypeOf(process);

  const cases: Array<[string, (obj: object) => void]> = [
    ["on", obj => nativeProto.on.call(obj, "foo", () => {})],
    ["addListener", obj => nativeProto.addListener.call(obj, "foo", () => {})],
    ["once", obj => nativeProto.once.call(obj, "foo", () => {})],
    ["emit", obj => nativeProto.emit.call(obj, "foo")],
    ["removeListener", obj => nativeProto.removeListener.call(obj, "foo", () => {})],
    ["removeAllListeners", obj => nativeProto.removeAllListeners.call(obj)],
    ["eventNames", obj => nativeProto.eventNames.call(obj)],
    ["listenerCount", obj => nativeProto.listenerCount.call(obj, "foo")],
    ["listeners", obj => nativeProto.listeners.call(obj, "foo")],
    ["getMaxListeners", obj => nativeProto.getMaxListeners.call(obj)],
  ];

  test.each(cases)("%s", (_name, invoke) => {
    const sentinel = new Error("getter threw");
    const obj = {};
    Object.defineProperty(obj, "_events", {
      get() {
        throw sentinel;
      },
    });
    let caught: unknown;
    try {
      invoke(obj);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(sentinel);
  });

  test("Proxy get trap that throws", () => {
    const sentinel = new Error("proxy get threw");
    const obj = new Proxy(
      {},
      {
        get(_t, key) {
          if (key === "_events") throw sentinel;
        },
      },
    );
    let caught: unknown;
    try {
      nativeProto.on.call(obj, "foo", () => {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(sentinel);
  });

  test("a plain object receiver gets a working emitter", () => {
    const obj: any = {};
    let fired = 0;
    nativeProto.on.call(obj, "x", () => fired++);
    nativeProto.emit.call(obj, "x");
    expect(fired).toBe(1);
  });
});

// The loop stands in module code, where the JIT enters it while it runs. An array of 48 or 64 bytes a call is 12 collections or more.
test.each([
  ["one listener, no argument", `emitter.on("x", listener);`, `emitter.emit("x")`],
  ["one listener, one argument", `emitter.on("x", listener);`, `emitter.emit("x", i)`],
  ["one listener, four arguments", `emitter.on("x", listener);`, `emitter.emit("x", i, i, i, i)`],
  ["two listeners, one argument", `emitter.on("x", listener); emitter.on("x", () => {});`, `emitter.emit("x", i)`],
  [
    "a listener that returns a promise",
    `const settled = Promise.resolve(); emitter.on("x", () => settled);`,
    `emitter.emit("x", i)`,
  ],
])(
  "emit() compiled by the JIT makes no array of its arguments: %s",
  async (_, listen, emit) => {
    using dir = tempDir("emit-makes-no-array", {
      "emit.js": `
      const emitter = new (require("node:events"))();
      let heard = 0;
      const listener = () => { heard++; };
      ${listen}
      for (let i = 0; i < 2_000_000; i++) ${emit};
      console.log(require("bun:jsc").numberOfDFGCompiles(emitter.emit));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "emit.js")],
      env: { ...bunEnv, BUN_JSC_logGC: "1", BUN_JSC_useConcurrentJIT: "0", BUN_GC_TIMER_DISABLE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(0);
    if (Number(stdout) === 0 || Number(stdout) >= 1_000_000) return; // This Bun runs without the optimizing JIT.
    expect(stderr.match(/(Eden|Full)Collection/g)?.length ?? 0).toBeLessThan(6);
  },
  60_000,
);

// One more call for every event with several listeners is a sixth more in the interpreter.
test("emit() itself calls each of several listeners", () => {
  const emitter = new EventEmitter();
  let stack = "";
  emitter.on("x", () => {});
  emitter.on("x", function second() {
    stack = new Error().stack!;
  });
  emitter.emit("x");
  const functions = stack
    .split("\n")
    .slice(1, 3)
    .map(line => line.trim().split(" ")[1]);
  expect(functions).toEqual(["second", "emit"]);
});

// `process` and the other objects that use the native EventEmitter prototype. Under `bun --bun jest`, the `process`
// that test code sees is an object that inherits that prototype (jest-util's createProcessObject()). No user of the
// two receivers that the native constructor makes is known. The node:events EventEmitter is the reference: every
// expected value is what it gives, and what node v26.3.0 gives for the same calls.
describe("native EventEmitter", () => {
  type Wrapper = Function & { listener: Function; tag?: string };
  const nativeProto = Object.getPrototypeOf(process);
  const NativeEventEmitter = nativeProto.constructor;
  const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
  const functions = () => heapStats().objectTypeCounts.Function ?? 0;

  let nextName = 0;
  const receivers: Array<[string, () => any]> = [
    ["process", () => process],
    ["new NativeEventEmitter()", () => new NativeEventEmitter()],
    ["NativeEventEmitter()", () => NativeEventEmitter()],
    ["an object that inherits the native prototype", () => Object.create(nativeProto)],
    ["node:events EventEmitter", () => new EventEmitter()],
  ];
  const eventNames: Array<[string, () => string | symbol]> = [
    ["a string", () => `native-emitter-${nextName++}`],
    ["a symbol", () => Symbol("native-emitter")],
  ];
  const readStates = ["never read", "read before the emit", "read during the emit"] as const;

  describe.each(receivers)("%s", (receiver, makeTarget) => {
    const native = receiver !== "node:events EventEmitter";
    let target: any;
    const types: Array<string | symbol> = [];
    const track = <T extends string | symbol>(type: T) => {
      types.push(type);
      return type;
    };
    beforeEach(() => {
      target = makeTarget();
    });
    afterEach(() => {
      for (const type of types.splice(0)) target.removeAllListeners(type);
    });

    describe.each(eventNames)("%s event name", (_kind, makeType) => {
      const newType = () => track(makeType());

      describe.each(["once", "prependOnceListener"] as const)("%s()", method => {
        test("rawListeners() returns a wrapper that has the handler in .listener", () => {
          const type = newType();
          const handler = () => {};
          target[method](type, handler);

          const wrapper: Wrapper = target.rawListeners(type)[0];
          expect(typeof wrapper).toBe("function");
          expect(wrapper).not.toBe(handler);
          expect(Object.getOwnPropertyDescriptor(wrapper, "listener")).toEqual({
            value: handler,
            writable: true,
            enumerable: true,
            configurable: true,
          });
          expect(Object.keys(wrapper)).toEqual(["listener"]);
          // The emitter stores the wrapper, so every read returns the same one.
          expect(target.rawListeners(type)).toEqual([wrapper]);
          expect(target.listeners(type)).toEqual([handler]);
          expect(target.listenerCount(type)).toBe(1);
        });

        test(".listener() keeps the registration and the wrapper removes it", () => {
          const type = newType();
          const calls: unknown[][] = [];
          function handler(this: unknown, ...args: unknown[]) {
            calls.push([this === target, ...args]);
            return "result";
          }
          target[method](type, handler);
          const wrapper: Wrapper = target.rawListeners(type)[0];

          wrapper.listener();
          expect(target.listenerCount(type)).toBe(1);

          // The wrapper calls the handler on the emitter, whatever the wrapper is called on.
          expect(wrapper.call({}, 1, 2)).toBe("result");
          expect(target.listenerCount(type)).toBe(0);
          expect(target.rawListeners(type)).toEqual([]);

          // A wrapper that fired does nothing.
          expect(wrapper(3)).toBeUndefined();
          expect(target.emit(type, 4)).toBe(false);
          expect(calls).toEqual([[false], [true, 1, 2]]);
        });

        test.each(readStates)("an emit runs the listener one time (%s)", state => {
          const type = newType();
          const calls: unknown[][] = [];
          function handler(this: unknown, ...args: unknown[]) {
            calls.push([this === target, ...args]);
          }
          target[method](type, handler);
          let wrapper: Wrapper | undefined;
          const read = () => {
            wrapper = target.rawListeners(type).at(-1);
          };
          if (state === "read before the emit") read();
          if (state === "read during the emit") target.prependListener(type, read);

          expect(target.emit(type, "a", "b")).toBe(true);
          expect(calls).toEqual([[true, "a", "b"]]);
          expect(target.listeners(type)).toEqual(state === "read during the emit" ? [read] : []);

          // A wrapper that was read before the listener ran does nothing now.
          wrapper?.("late");
          target.emit(type, "again");
          expect(calls).toEqual([[true, "a", "b"]]);
        });

        test.each(readStates)("an emit from inside an earlier listener runs the listener one time (%s)", state => {
          const type = newType();
          let calls = 0;
          let depth = 0;
          target[method](type, () => calls++);
          if (state === "read before the emit") target.rawListeners(type);
          target.prependListener(type, () => {
            if (state === "read during the emit") target.rawListeners(type);
            if (depth++ === 0) target.emit(type);
          });

          target.emit(type);
          expect(calls).toBe(1);
          expect(target.listenerCount(type)).toBe(1);
        });

        test("a wrapper that an earlier listener calls during the emit runs the handler one time", () => {
          const type = newType();
          const order: string[] = [];
          target[method](type, () => order.push("handler"));
          target.prependListener(type, () => {
            order.push("earlier");
            target.rawListeners(type).at(-1)();
          });

          target.emit(type);
          expect(order).toEqual(["earlier", "handler"]);
          expect(target.listenerCount(type)).toBe(1);
        });

        test.each(readStates)("a listener that an earlier listener removes during the emit still runs (%s)", state => {
          const type = newType();
          const order: string[] = [];
          const handler = () => order.push("handler");
          target[method](type, handler);
          if (state === "read before the emit") target.rawListeners(type);
          target.prependListener(type, () => {
            if (state === "read during the emit") target.rawListeners(type);
            target.removeListener(type, handler);
            order.push("earlier");
          });

          target.emit(type);
          target.emit(type);
          expect(order).toEqual(["earlier", "handler", "earlier"]);
        });

        test("removeListener() takes the wrapper or the handler", () => {
          const handler = () => {};

          const byWrapper = newType();
          target[method](byWrapper, handler);
          target[method](byWrapper, handler);
          const [first, second]: Wrapper[] = target.rawListeners(byWrapper);
          expect(first).not.toBe(second);
          expect([first.listener, second.listener]).toEqual([handler, handler]);
          target.removeListener(byWrapper, first);
          expect(target.rawListeners(byWrapper)).toEqual([second]);

          // The handler matches the last registration that wraps it.
          const byHandler = newType();
          target[method](byHandler, handler);
          target[method](byHandler, handler);
          const [kept]: Wrapper[] = target.rawListeners(byHandler);
          target.removeListener(byHandler, handler);
          expect(target.rawListeners(byHandler)).toEqual([kept]);
        });

        test.each(["removeListener", "removeAllListeners"] as const)(
          "a wrapper that %s() removed before it fired still calls the handler one time",
          remove => {
            const type = newType();
            let calls = 0;
            target[method](type, () => calls++);
            const wrapper: Wrapper = target.rawListeners(type)[0];
            if (remove === "removeListener") target.removeListener(type, wrapper);
            else target.removeAllListeners(type);
            expect(target.listenerCount(type)).toBe(0);

            wrapper();
            wrapper();
            expect(calls).toBe(1);
          },
        );

        // jest-circus >= 30.5.0 saves, removes and restores the listeners of `process` in this way around each test.
        test("a saved wrapper that on() registers again after removeAllListeners() fires one time", () => {
          const type = newType();
          let calls = 0;
          const handler = () => calls++;
          target[method](type, handler);
          const saved: Wrapper[] = [...target.rawListeners(type)];
          target.removeAllListeners(type);
          for (const listener of saved) target.on(type, listener);
          expect(target.rawListeners(type)).toEqual(saved);
          expect(target.listeners(type)).toEqual([handler]);

          expect(target.emit(type)).toBe(true);
          expect(target.listenerCount(type)).toBe(0);
          expect(target.emit(type)).toBe(false);
          expect(calls).toBe(1);
        });

        test("a wrapper registered with on() for another event fires one time and stays there", () => {
          const type = newType();
          const other = newType();
          let calls = 0;
          const handler = () => calls++;
          target[method](type, handler);
          const wrapper: Wrapper = target.rawListeners(type)[0];

          target.on(other, wrapper);
          expect(target.rawListeners(other)).toEqual([wrapper]);
          expect(target.listeners(other)).toEqual([handler]);

          target.emit(other);
          target.emit(other);
          expect(calls).toBe(1);
          // The wrapper removed its registration for `type`. node leaves the one for `other`.
          expect(target.listenerCount(type)).toBe(0);
          expect(target.rawListeners(other)).toEqual([wrapper]);

          target.removeListener(other, handler);
          expect(target.listenerCount(other)).toBe(0);
        });

        test("a wrapper registered with on() for its own event removes the last registration of it", () => {
          const type = newType();
          let calls = 0;
          target[method](type, () => calls++);
          const wrapper: Wrapper = target.rawListeners(type)[0];
          target.on(type, wrapper);
          expect(target.rawListeners(type)).toEqual([wrapper, wrapper]);

          target.emit(type);
          expect(calls).toBe(1);
          expect(target.rawListeners(type)).toEqual([wrapper]);

          // What is left is a wrapper that fired.
          target.emit(type);
          expect(calls).toBe(1);
          expect(target.rawListeners(type)).toEqual([wrapper]);
        });

        // The wrapper removes by value: the last registration that is it, or that wraps it.
        test("a wrapper that fires removes a later registration of it and keeps its own", () => {
          const type = newType();
          let calls = 0;
          const between = () => {};
          target[method](type, () => calls++);
          const wrapper: Wrapper = target.rawListeners(type)[0];
          target.on(type, between);
          target.on(type, wrapper);

          target.emit(type);
          expect(calls).toBe(1);
          expect(target.rawListeners(type)).toEqual([wrapper, between]);
        });

        test("a wrapper that fires removes a once() registration of it", () => {
          const type = newType();
          let calls = 0;
          target[method](type, () => calls++);
          const wrapper: Wrapper = target.rawListeners(type)[0];
          target.once(type, wrapper);
          const outer: Wrapper = target.rawListeners(type)[1];
          expect(outer.listener).toBe(wrapper);

          wrapper();
          expect(calls).toBe(1);
          expect(target.rawListeners(type)).toEqual([wrapper]);
        });

        test("the wrapper of a wrapper", () => {
          const type = newType();
          const other = newType();
          let calls = 0;
          const handler = () => calls++;
          target[method](type, handler);
          const inner: Wrapper = target.rawListeners(type)[0];

          target[method](other, inner);
          // Before and after the read, the registration is for `inner`, not for the handler inside it.
          expect(target.listeners(other)).toEqual([inner]);
          target.removeListener(other, handler);
          expect(target.listenerCount(other)).toBe(1);
          const outer: Wrapper = target.rawListeners(other)[0];
          expect(outer).not.toBe(inner);
          expect(outer.listener).toBe(inner);
          expect(target.listeners(other)).toEqual([inner]);
          target.removeListener(other, handler);
          expect(target.listenerCount(other)).toBe(1);

          target.emit(other);
          target.emit(other);
          target.emit(type);
          expect(calls).toBe(1);
          expect([target.listenerCount(type), target.listenerCount(other)]).toEqual([0, 0]);
        });

        test("'newListener' receives the handler for on() and the wrapper for once()", () => {
          const type = newType();
          const added = newType();
          const handler = () => {};
          target[method](type, handler);
          const wrapper: Wrapper = target.rawListeners(type)[0];
          expect(wrapper).not.toBe(handler);

          const seen: unknown[] = [];
          const onNewListener = (name: unknown, listener: unknown) => {
            if (name === added) seen.push(listener);
          };
          target.on("newListener", onNewListener);
          try {
            for (const verb of ["on", "addListener", "prependListener", "once", "prependOnceListener"]) {
              target[verb](added, wrapper);
            }
          } finally {
            target.removeListener("newListener", onNewListener);
          }
          expect(seen).toEqual([handler, handler, handler, wrapper, wrapper]);
        });

        test("an error that the handler throws reaches the caller of the wrapper", () => {
          const type = newType();
          const error = new RangeError("thrown by the handler");
          target[method](type, () => {
            throw error;
          });
          const wrapper: Wrapper = target.rawListeners(type)[0];

          let thrown: unknown;
          try {
            wrapper();
          } catch (e) {
            thrown = e;
          }
          expect(thrown).toBe(error);
          expect(target.listenerCount(type)).toBe(0);
          expect(wrapper()).toBeUndefined();
        });

        // node rejects a listener that is not a function. The native emitter accepts an object and never calls it.
        test.skipIf(!native)("rawListeners() does not wrap an object that is not callable", () => {
          const type = newType();
          const notCallable = {};
          target[method](type, notCallable);
          expect(target.rawListeners(type)[0]).toBe(notCallable);
        });
      });

      test("on() listeners are returned as they are", () => {
        const type = newType();
        const handler = () => {};
        target.on(type, handler);
        target.prependListener(type, handler);
        expect(target.rawListeners(type)).toEqual([handler, handler]);
        expect(Object.hasOwn(handler, "listener")).toBe(false);
      });

      test("rawListeners() and listeners() keep the order of mixed registrations", () => {
        const type = newType();
        const a = () => {};
        const b = () => {};
        const c = () => {};
        target.on(type, a);
        target.once(type, b);
        target.prependOnceListener(type, c);

        const raw: Wrapper[] = target.rawListeners(type);
        expect([raw[0].listener, raw[1], raw[2].listener]).toEqual([c, a, b]);
        expect(target.listeners(type)).toEqual([c, a, b]);
      });
    });

    // The emitter converts a name that is not a string or a symbol. The wrapper removes itself from the result.
    test("an event name that is a number", () => {
      const type = 1_000_000 + nextName++;
      track(String(type));
      let calls = 0;
      target.once(type, () => calls++);
      const wrapper: Wrapper = target.rawListeners(type)[0];
      expect(target.rawListeners(String(type))).toEqual([wrapper]);

      wrapper();
      wrapper();
      expect(calls).toBe(1);
      expect(target.listenerCount(type)).toBe(0);
    });

    // These are the checks of the native emitter. node also rejects a listener that is undefined, null or an object.
    test.skipIf(!native)("removeListener() rejects a listener that is a primitive", () => {
      const type = track(`native-emitter-${nextName++}`);
      target.on(type, () => {});
      for (const listener of [undefined, null, {}, () => {}]) {
        expect(target.removeListener(type, listener)).toBe(target);
      }
      for (const listener of [1, "listener", Symbol("listener"), true]) {
        expect(() => target.removeListener(type, listener)).toThrow(
          expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
        );
      }
      expect(target.listenerCount(type)).toBe(1);
    });

    test("the emitter keeps the wrapper that it stores", () => {
      const type = track(`native-emitter-${nextName++}`);
      target.once(type, () => {});
      (() => {
        target.rawListeners(type)[0].tag = "kept";
      })();
      Bun.gc(true);
      expect(target.rawListeners(type)[0].tag).toBe("kept");
    });

    // The first listener removes the third one and the second listener collects. After the removal, only the emit in
    // flight holds the registration, and only the registration holds the listener.
    test("a listener that an earlier listener removes during the emit still runs after a collection", async () => {
      const type = track(`native-emitter-${nextName++}`);
      let calls = 0;
      target.on(type, () => target.removeListener(type, target.listeners(type)[2]));
      target.on(type, () => Bun.gc(true));
      target.on(type, () => calls++);
      // From the next turn on, nothing but the registration holds the listener.
      await nextTurn();

      target.emit(type);
      expect(calls).toBe(1);
    });
  });

  // The same three listeners, for each way to remove a listener and each kind of listener.
  describe("a listener that is removed during the emit still runs after a collection", () => {
    const removers: Array<[string, (emitter: any) => void]> = [
      ["removeListener(type, listener)", emitter => emitter.removeListener("x", emitter.listeners("x")[2])],
      ["removeAllListeners(type)", emitter => emitter.removeAllListeners("x")],
      ["removeAllListeners()", emitter => emitter.removeAllListeners()],
    ];
    const listeners: Array<[string, (emitter: any, listener: () => void) => void]> = [
      ["an on() listener", (emitter, listener) => emitter.on("x", listener)],
      ["a once() listener", (emitter, listener) => emitter.once("x", listener)],
      [
        "a once() listener that rawListeners() read",
        (emitter, listener) => void emitter.once("x", listener).rawListeners("x"),
      ],
    ];

    describe.each(removers)("%s", (_remover, remove) => {
      test.each(listeners)("%s", async (_listener, add) => {
        const emitter = new NativeEventEmitter();
        let calls = 0;
        emitter.on("x", () => remove(emitter));
        emitter.on("x", () => Bun.gc(true));
        add(emitter, () => calls++);
        await nextTurn();

        emitter.emit("x");
        expect(calls).toBe(1);
      });
    });

    test("and after a nested emit returned", async () => {
      const emitter = new NativeEventEmitter();
      let calls = 0;
      emitter.on("nested", () => {});
      emitter.on("x", () => {
        emitter.removeAllListeners("x");
        // The return of this emit must not release what the emit in flight holds.
        emitter.emit("nested");
      });
      emitter.on("x", () => Bun.gc(true));
      emitter.on("x", () => calls++);
      await nextTurn();

      emitter.emit("x");
      expect(calls).toBe(1);
    });
  });

  // The emitter keeps a registration that is removed while an emit holds it. It keeps no other one, and none after
  // that emit returned.
  test.each<[string, (emitter: any) => void]>([
    [
      "no emit holds them",
      emitter => {
        const listener = () => {};
        emitter.on("other", listener);
        emitter.removeListener("other", listener);
        emitter.once("other", () => {});
        emitter.rawListeners("other");
        emitter.removeAllListeners("other");
      },
    ],
    [
      "a nested emit holds them",
      emitter => {
        emitter.on("other", () => emitter.removeAllListeners("other"));
        emitter.once("other", () => {});
        emitter.rawListeners("other");
        emitter.emit("other");
      },
    ],
  ])("listeners that are removed during a long emit do not stay until it returns (%s)", (_holder, round) => {
    const emitter = new NativeEventEmitter();
    const total = 200;
    // Each round makes two listeners and one wrapper.
    let kept = total * 3;
    emitter.on("long", () => {
      Bun.gc(true);
      const before = functions();
      for (let i = 0; i < total; i++) round(emitter);
      Bun.gc(true);
      kept = functions() - before;
    });

    emitter.emit("long");
    expect(kept).toBeLessThan(total);
  });

  test.each<[string, () => any]>([
    ["process", () => process],
    ["an emitter that stays alive", () => new NativeEventEmitter()],
  ])("listeners that are removed during an emit are collected after it returns (%s)", async (_receiver, makeTarget) => {
    const target = makeTarget();
    const type = `native-emitter-${nextName++}`;
    const total = 200;
    const listeners: Array<WeakRef<() => void>> = [];
    target.on(type, () => target.removeAllListeners(type));
    (() => {
      for (let i = 0; i < total; i++) {
        const listener = () => {};
        listeners.push(new WeakRef(listener));
        target.on(type, listener);
      }
    })();
    target.emit(type);

    let alive = total;
    for (let i = 0; i < 50 && alive >= total / 4; i++) {
      // deref() keeps its result until the turn ends, so each count has its own turn.
      await nextTurn();
      Bun.gc(true);
      alive = listeners.filter(listener => listener.deref() !== undefined).length;
    }
    expect(alive).toBeLessThan(total / 4);
    expect(target.listenerCount(type)).toBe(0);
  });

  // once() stores the function and a flag. Only a rawListeners() read makes wrappers, one for each once() listener.
  test("only rawListeners() makes wrappers, and they are collected after they fire", () => {
    const emitter = new NativeEventEmitter();
    const count = () => {
      Bun.gc(true);
      return functions();
    };
    const total = 200;
    const handler = () => {};

    const before = count();
    for (let i = 0; i < total; i++) emitter[i % 2 ? "once" : "prependOnceListener"]("cells", handler);
    emitter.listeners("cells");
    emitter.listenerCount("cells");
    emitter.eventNames();
    const unread = count() - before;
    emitter.rawListeners("cells");
    emitter.rawListeners("cells");
    const read = count() - before;
    emitter.emit("cells");
    const fired = count() - before;

    expect(unread).toBeLessThan(total / 4);
    expect(read).toBeGreaterThan((total * 3) / 4);
    expect(read).toBeLessThan((total * 5) / 4);
    expect(fired).toBeLessThan(total / 4);
  });

  // The two objects share one emitter through the prototype chain.
  describe.each<[string, () => any]>([
    ["an object that inherits the native prototype", () => Object.create(nativeProto)],
    ["node:events EventEmitter", () => new EventEmitter()],
  ])("an object that inherits from %s", (receiver, makeShared) => {
    test("the wrapper calls the handler on the object that called once(), not on the one that read it", () => {
      const shared = makeShared();
      shared.on("own", () => {});
      const registrant = Object.create(shared);
      let self: unknown;
      registrant.once("x", function (this: unknown) {
        self = this;
      });

      shared.rawListeners("x")[0].call({});
      expect(self).toBe(registrant);
    });

    // The native emitter holds the object that called once() weakly. Its emit then calls the listeners on undefined.
    test.skipIf(receiver === "node:events EventEmitter")(
      "a read does not change the `this` of the handler after the object that called once() is collected",
      async () => {
        const shared = makeShared();
        shared.on("own", () => {});
        const seen: Record<string, unknown> = {};
        const registrant = (() => {
          const registrant = Object.create(shared);
          registrant.on("x", function (this: unknown) {
            seen.on = this;
          });
          registrant.once("x", function (this: unknown) {
            seen.unread = this;
          });
          registrant.once("y", function (this: unknown) {
            seen.read = this;
          });
          return new WeakRef(registrant);
        })();
        for (let i = 0; i < 50; i++) {
          await nextTurn();
          Bun.gc(true);
          // In its own turn, so that this deref() does not keep the object for the collection above.
          await nextTurn();
          if (registrant.deref() === undefined) break;
        }
        expect(registrant.deref()).toBeUndefined();

        const wrapper: Wrapper = shared.rawListeners("y")[0];
        expect(typeof wrapper.listener).toBe("function");
        shared.emit("x");
        shared.emit("y");
        expect(seen).toEqual({ on: undefined, unread: undefined, read: undefined });
      },
    );
  });

  // A wrapper that fired has no use for the emitter. The emitters below must be collected while the test holds
  // their wrappers.
  test.concurrent("a wrapper that fired does not keep the emitter alive", async () => {
    const src = `
      const nativeProto = Object.getPrototypeOf(process);
      const NativeEventEmitter = nativeProto.constructor;
      const held = [];
      const total = 8;
      let collected = 0;
      const registry = new FinalizationRegistry(() => collected++);
      (function () {
        for (let i = 0; i < total; i++) {
          const emitter = i % 2 ? new NativeEventEmitter() : Object.create(nativeProto);
          emitter.once("x", function () {});
          held.push(emitter.rawListeners("x")[0]);
          // Half of the wrappers fire from the emit and half from a direct call.
          if (i % 4 < 2) emitter.emit("x");
          else held[i]();
          registry.register(emitter);
        }
      })();
      let iters = 0;
      setImmediate(function check() {
        Bun.gc(true);
        const wrappers = held.filter(wrapper => typeof wrapper.listener === "function").length;
        if (collected === total) {
          console.log("collected " + collected + "/" + total + " holding " + wrappers + " wrappers");
          return;
        }
        if (++iters > 50) {
          console.log("stuck " + collected + "/" + total + " holding " + wrappers + " wrappers");
          process.exit(1);
        }
        setImmediate(check);
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "collected 8/8 holding 8 wrappers",
      stderr: "",
      exitCode: 0,
    });
  });

  // jest-circus >= 30.5.0 does this around each test (injectGlobalErrorHandlers and restoreGlobalErrorHandlers). The
  // second error finds no listener, so the process ends with it.
  test.concurrent.each([
    ["uncaughtException", `throw new Error("first");`, `throw new Error("second");`],
    ["unhandledRejection", `Promise.reject(new Error("first"));`, `Promise.reject(new Error("second"));`],
  ])(
    "a once('%s') listener that is saved with rawListeners() and restored with on() runs one time",
    async (event, first, second) => {
      const src = `
        const events = ["uncaughtException", "unhandledRejection", "rejectionHandled"];
        const log = [];
        process.once("${event}", error => log.push(error.message));

        const replacement = () => {};
        const saved = events.map(event => [...process.rawListeners(event)]);
        for (const event of events) process.removeAllListeners(event);
        for (const event of events) process.on(event, replacement);
        for (const event of events) process.removeListener(event, replacement);
        events.forEach((event, i) => {
          for (const listener of saved[i]) process.on(event, listener);
        });

        process.on("exit", () => console.log(JSON.stringify({ log, listeners: process.listenerCount("${event}") })));
        setImmediate(() => {
          setImmediate(() => {
            ${second}
          });
          ${first}
        });
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("error: second");
      expect({ stdout, exitCode }).toEqual({ stdout: '{"log":["first"],"listeners":0}\n', exitCode: 1 });
    },
  );

  // The timeout of node:vm fires during the sleep, and the call of the wrapper is the first place that sees it. The
  // call ends there, before the handler runs. A longer sleep is tried when the timeout fired too late for that.
  test.concurrent("a wrapper call that a node:vm timeout ends leaves the listener registered", async () => {
    const src = `
      const vm = require("node:vm");
      vm.runInThisContext("1");
      let calls = 0;
      let interrupted = false;
      for (let timeout = 25; timeout <= 400 && !interrupted; timeout *= 2) {
        calls = 0;
        process.removeAllListeners("interrupted");
        process.once("interrupted", () => calls++);
        globalThis.wrapper = process.rawListeners("interrupted")[0];
        globalThis.sleep = timeout * 8;
        const start = performance.now();
        let code;
        try {
          vm.runInThisContext("Bun.sleepSync(sleep); wrapper();", { timeout });
        } catch (error) {
          code = error.code;
        }
        interrupted =
          code === "ERR_SCRIPT_EXECUTION_TIMEOUT" &&
          performance.now() - start >= sleep &&
          calls === 0 &&
          process.listenerCount("interrupted") === 1;
      }
      process.emit("interrupted");
      const afterEmit = [calls, process.listenerCount("interrupted")];
      wrapper();
      console.log(JSON.stringify({ interrupted, afterEmit, afterCall: [calls, process.listenerCount("interrupted")] }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: '{"interrupted":true,"afterEmit":[1,0],"afterCall":[1,0]}\n',
      stderr: "",
      exitCode: 0,
    });
  });

  // The native 'exit' emit holds the once() listener in its copy of the listeners while the first listener emits.
  test.concurrent("a once('exit') listener runs one time when an earlier 'exit' listener emits 'exit'", async () => {
    const src = `
      let depth = 0;
      process.on("exit", code => {
        if (depth++ === 0) process.emit("exit", code);
      });
      process.once("exit", code => console.log("once exit listener", code));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "once exit listener 0\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
