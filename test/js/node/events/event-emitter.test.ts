import { sleep } from "bun";
// A namespace import: a build without nodeEventEmitterPrototype fails the tests that call it, not the whole file.
import * as internalForTesting from "bun:internal-for-testing";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createRequire } from "module";

// this is also testing that imports with default and named imports in the same statement work
// our transpiler transform changes this to a var with import.meta.require
import EventEmitter, {
  captureRejectionSymbol,
  getEventListeners,
  getMaxListeners,
  listenerCount,
  setMaxListeners,
} from "node:events";

const kCapture = Object.getOwnPropertySymbols(EventEmitter.prototype).find(s => s.description === "kCapture")!;
const kShapeMode = Object.getOwnPropertySymbols(new EventEmitter()).find(s => s.description === "shapeMode")!;

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

    const result = [];
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

    const result = [];
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

    expect((await asyncIterator.next()).value).toBe(1);
    expect((await asyncIterator.next()).value).toEqual([4, 5, 6]);
  });

  test("Cancel via error event", async () => {
    const { on, EventEmitter } = require("node:events");
    const process = require("node:process");

    const ee = new EventEmitter();
    const output = [];

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
    const output = [];

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

    const result = [];
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
    const output = [];

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

  test("the constructor gives every capturing instance the same own emit", () => {
    class Subclass extends EventEmitter {
      emit(type: string | symbol, ...args: unknown[]) {
        return super.emit(type, ...args);
      }
    }
    const first: any = new EventEmitter({ captureRejections: true });
    const second: any = new EventEmitter({ captureRejections: true });
    const subclassed: any = new Subclass({ captureRejections: true });
    const plain: any = new EventEmitter();

    expect({
      keys: Reflect.ownKeys(first),
      emit: Object.getOwnPropertyDescriptor(first, "emit"),
      emitProperties: [first.emit.name, first.emit.length, Reflect.ownKeys(first.emit)],
      isPrototypeEmit: first.emit === EventEmitter.prototype.emit,
      sameOnEveryInstance: [second.emit === first.emit, subclassed.emit === first.emit],
      capture: [first[kCapture], plain[kCapture]],
      plainKeys: Reflect.ownKeys(plain),
    }).toEqual({
      keys: ["_events", "_eventsCount", "_maxListeners", "emit", kShapeMode, kCapture],
      emit: { value: first.emit, writable: true, enumerable: true, configurable: true },
      emitProperties: ["emit", 1, ["length", "name"]],
      isPrototypeEmit: false,
      sameOnEveryInstance: [true, true],
      capture: [true, false],
      plainKeys: ["_events", "_eventsCount", "_maxListeners", kShapeMode, kCapture],
    });
  });

  test("EventEmitter.captureRejections is an accessor over EventEmitter.prototype[kCapture]", () => {
    const proto: any = EventEmitter.prototype;
    const { get, set, ...attributes } = Object.getOwnPropertyDescriptor(EventEmitter, "captureRejections")!;
    const states: unknown[] = [];
    // [accessor, prototype[kCapture], [kCapture, has an own emit] of a new emitter, and of one that passed false]
    const record = () => {
      const created: any = new EventEmitter();
      const optedOut: any = new EventEmitter({ captureRejections: false });
      states.push([
        EventEmitter.captureRejections,
        Object.getOwnPropertyDescriptor(proto, kCapture),
        [created[kCapture], Object.hasOwn(created, "emit")],
        [optedOut[kCapture], Object.hasOwn(optedOut, "emit")],
      ]);
    };
    try {
      record();
      EventEmitter.captureRejections = true;
      record();
      set!(false);
      record();
      proto[kCapture] = true;
      record();
      states.push(get!());
    } finally {
      proto[kCapture] = false;
    }

    const data = { writable: true, enumerable: true, configurable: true };
    const off = [false, { value: false, ...data }, [false, false], [false, false]];
    const on = [true, { value: true, ...data }, [true, true], [true, true]];
    expect({ accessor: [typeof get, typeof set, attributes], states }).toEqual({
      accessor: ["function", "function", { enumerable: true, configurable: false }],
      states: [off, on, off, on, true],
    });
  });

  test("captureRejections must be a boolean", () => {
    const invalid = (name: string, received: string) =>
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "${name}" property must be of type boolean. Received ${received}`,
      });
    expect(() => new EventEmitter({ captureRejections: "yes" as any })).toThrow(
      invalid("options.captureRejections", "type string ('yes')"),
    );
    expect(() => {
      EventEmitter.captureRejections = 1 as any;
    }).toThrow(invalid("EventEmitter.captureRejections", "type number (1)"));
    expect(EventEmitter.captureRejections).toBe(false);
  });

  // Resolves after emit() has passed on the rejections of `promises`: it does that one tick after they settle.
  async function passedOn(promises: Promise<unknown>[]) {
    await Promise.allSettled(promises);
    await new Promise<void>(resolve => process.nextTick(resolve));
  }

  test("a rejection is emitted as 'error' with kCapture switched off for the listeners", async () => {
    const emitter: any = new EventEmitter({ captureRejections: true });
    const rejected = [Promise.reject("first"), Promise.reject("second")];
    const errors: unknown[] = [];
    emitter.on("error", function (this: unknown, ...args: unknown[]) {
      errors.push([this === emitter, args, emitter[kCapture]]);
    });
    emitter.on("action", () => rejected[0]);
    emitter.on("action", () => "not a promise");
    emitter.once("action", () => rejected[1]);

    expect(emitter.emit("action", 1)).toBe(true);
    await passedOn(rejected);
    expect({ errors, capture: emitter[kCapture], listeners: emitter.listenerCount("action") }).toEqual({
      errors: [
        [true, ["first"], false],
        [true, ["second"], false],
      ],
      capture: true,
      listeners: 2,
    });
  });

  test("a rejection goes to Symbol.for('nodejs.rejection') when the emitter has that method", async () => {
    const emitter: any = new EventEmitter({ captureRejections: true });
    const rejected = [Promise.reject("boom")];
    const calls: unknown[] = [];
    const onError = mock();
    emitter[captureRejectionSymbol] = function (this: unknown, ...args: unknown[]) {
      calls.push([this === emitter, args, emitter[kCapture]]);
    };
    emitter.on("error", onError);
    emitter.on("action", () => rejected[0]);

    expect(emitter.emit("action", 1, 2, 3, 4)).toBe(true);
    await passedOn(rejected);
    expect(calls).toEqual([[true, ["boom", "action", 1, 2, 3, 4], true]]);
    expect(onError).not.toHaveBeenCalled();
  });

  test("EventEmitterAsyncResource captures rejections without an own emit", async () => {
    const { EventEmitterAsyncResource } = EventEmitter;
    const emitter: any = new EventEmitterAsyncResource({ name: "capturing", captureRejections: true });
    try {
      const rejected = [Promise.reject("boom")];
      const onError = mock();
      emitter.on("error", onError);
      emitter.on("action", () => rejected[0]);

      expect({
        keys: Reflect.ownKeys(emitter),
        capture: emitter[kCapture],
        emit: emitter.emit === EventEmitterAsyncResource.prototype.emit,
      }).toEqual({
        keys: ["_events", "_eventsCount", "_maxListeners", kShapeMode, kCapture],
        capture: true,
        emit: true,
      });
      expect(emitter.emit("action")).toBe(true);
      await passedOn(rejected);
      expect(onError.mock.calls).toEqual([["boom"]]);
    } finally {
      emitter.emitDestroy();
    }
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

// [key, name, length] of the methods, in the order of the keys of EventEmitter.prototype.
const prototypeMethods = [
  ["setMaxListeners", "setMaxListeners", 1],
  ["getMaxListeners", "getMaxListeners", 0],
  ["emit", "emit", 1],
  ["addListener", "addListener", 2],
  ["on", "addListener", 2],
  ["prependListener", "prependListener", 2],
  ["once", "once", 2],
  ["prependOnceListener", "prependOnceListener", 2],
  ["removeListener", "removeListener", 2],
  ["off", "removeListener", 2],
  ["removeAllListeners", "removeAllListeners", 1],
  ["listeners", "listeners", 1],
  ["rawListeners", "rawListeners", 1],
  ["listenerCount", "listenerCount", 2],
  ["eventNames", "eventNames", 0],
] as const;
const methodKeys = prototypeMethods.map(([key]) => key);
const inspectedMethods = prototypeMethods.map(([key, name]) => `  ${key}: [Function: ${name}],`);
// Arguments that every method accepts, for the tests that call all of them.
const methodArguments: Record<string, unknown[]> = {
  setMaxListeners: [5],
  getMaxListeners: [],
  emit: ["x"],
  removeAllListeners: [],
  listeners: ["x"],
  rawListeners: ["x"],
  listenerCount: ["x"],
  eventNames: [],
};

function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    return error;
  }
}

describe("EventEmitter.prototype", () => {
  const proto: any = EventEmitter.prototype;
  const data = { writable: true, enumerable: true, configurable: true };

  test("own properties: order, attributes, and the name and length of every method", () => {
    const table = Reflect.ownKeys(proto).map(key => {
      const { value, ...attributes } = Object.getOwnPropertyDescriptor(proto, key)!;
      if (typeof value !== "function" || key === "constructor") return { key, value, ...attributes };
      return { key, name: value.name, length: value.length, keys: Reflect.ownKeys(value), ...attributes };
    });

    const method = ([key, name, length]: (typeof prototypeMethods)[number]) => ({
      key,
      name,
      length,
      keys: ["length", "name"],
      ...data,
    });
    expect(table).toEqual([
      method(prototypeMethods[0]),
      { key: "constructor", value: EventEmitter, ...data },
      ...prototypeMethods.slice(1).map(method),
      { key: "_eventsCount", value: 0, ...data },
      { key: kCapture, value: false, ...data },
    ]);
  });

  test("is a plain object in a writable, enumerable, configurable property of the constructor", () => {
    expect({
      prototype: Object.getPrototypeOf(proto) === Object.prototype,
      extensible: Object.isExtensible(proto),
      tag: Object.prototype.toString.call(proto),
      property: Object.getOwnPropertyDescriptor(EventEmitter, "prototype"),
      constructorKeys: Reflect.ownKeys(EventEmitter).join(" "),
    }).toEqual({
      prototype: true,
      extensible: true,
      tag: "[object Object]",
      property: { value: proto, ...data },
      constructorKeys:
        "length name prototype captureRejections defaultMaxListeners kMaxEventTargetListeners " +
        "kMaxEventTargetListenersWarned once on getEventListeners getMaxListeners setMaxListeners EventEmitter " +
        "usingDomains captureRejectionSymbol EventEmitterAsyncResource errorMonitor addAbortListener init " +
        "listenerCount",
    });
  });

  test("the symbols are real symbols with the descriptions and registry status they had", () => {
    const describeSymbols = (object: object) =>
      Object.getOwnPropertySymbols(object).map(symbol => [typeof symbol, symbol.description, Symbol.keyFor(symbol)]);
    expect({
      prototype: describeSymbols(proto),
      instance: describeSymbols(new EventEmitter()),
      sameOnEveryInstance: Object.getOwnPropertySymbols(new EventEmitter()).map(
        (symbol, i) => symbol === [kShapeMode, kCapture][i],
      ),
      errorMonitor: [EventEmitter.errorMonitor === Symbol.for("events.errorMonitor"), EventEmitter.errorMonitor],
      captureRejectionSymbol: [captureRejectionSymbol === Symbol.for("nodejs.rejection"), captureRejectionSymbol],
    }).toEqual({
      prototype: [["symbol", "kCapture", undefined]],
      instance: [
        ["symbol", "shapeMode", undefined],
        ["symbol", "kCapture", undefined],
      ],
      sameOnEveryInstance: [true, true],
      errorMonitor: [true, Symbol.for("events.errorMonitor")],
      captureRejectionSymbol: [true, Symbol.for("nodejs.rejection")],
    });
  });

  test("an instance gets its own properties from the constructor", () => {
    const emitter: any = new EventEmitter();
    const { _events, ...rest } = Object.getOwnPropertyDescriptors(emitter);
    expect({
      keys: Reflect.ownKeys(emitter),
      events: [Object.getPrototypeOf(_events.value), Reflect.ownKeys(_events.value), _events.writable],
      rest,
      shadowedMethods: methodKeys.filter(key => emitter[key] !== proto[key]),
    }).toEqual({
      keys: ["_events", "_eventsCount", "_maxListeners", kShapeMode, kCapture],
      events: [null, [], true],
      rest: {
        _eventsCount: { value: 0, ...data },
        _maxListeners: { value: undefined, ...data },
        [kShapeMode]: { value: false, ...data },
        [kCapture]: { value: false, ...data },
      },
      shadowedMethods: [],
    });
  });

  test("is behind the prototype of process, whose own methods stay", () => {
    const processPrototype = Object.getPrototypeOf(process);
    const chain: number[] = [];
    for (let object = process; object !== null; object = Object.getPrototypeOf(object)) {
      chain.push([process, processPrototype, proto, Object.prototype].indexOf(object));
    }
    expect({
      chain,
      instance: process instanceof EventEmitter,
      inherited: methodKeys.filter(
        key => !Object.hasOwn(processPrototype, key) || (process as any)[key] === proto[key],
      ),
    }).toEqual({ chain: [0, 1, 2, 3], instance: true, inherited: [] });
  });

  test("every method is a constructor", () => {
    function listener() {}
    const plain = new proto.getMaxListeners();
    // new.target is EventEmitter so that `this` has the `on` and `prependListener` that once() and
    // prependOnceListener() call. [key, is an array, inherits from EventEmitter.prototype, own keys]
    const constructed = methodKeys.map(key => {
      const result: any = Reflect.construct(proto[key], methodArguments[key] ?? ["x", listener], EventEmitter);
      return [key, Array.isArray(result), Object.getPrototypeOf(result) === proto, Reflect.ownKeys(result).join()];
    });

    expect({
      plain: [Object.getPrototypeOf(plain) === Object.prototype, Reflect.ownKeys(plain)],
      hasPrototypeProperty: methodKeys.filter(key => Object.hasOwn(proto[key], "prototype")),
      constructed,
    }).toEqual({
      plain: [true, []],
      hasPrototypeProperty: [],
      constructed: [
        ["setMaxListeners", false, true, "_maxListeners"],
        ["getMaxListeners", false, true, ""],
        ["emit", false, true, ""],
        ["addListener", false, true, "_events,_eventsCount"],
        ["on", false, true, "_events,_eventsCount"],
        ["prependListener", false, true, "_events,_eventsCount"],
        ["once", false, true, "_events,_eventsCount"],
        ["prependOnceListener", false, true, "_events,_eventsCount"],
        ["removeListener", false, true, ""],
        ["off", false, true, ""],
        ["removeAllListeners", false, true, ""],
        ["listeners", true, false, "length"],
        ["rawListeners", true, false, "length"],
        ["listenerCount", false, true, ""],
        ["eventNames", true, false, "length"],
      ],
    });
  });

  describe.each([
    ["a plain object", () => ({})],
    ["Object.create(null)", () => Object.create(null)],
  ] as [string, () => any][])("called on %s", (_name, create) => {
    // Calls the methods on `target` in order. A row is [call, what it returned], with "this" for `target`.
    function run(target: object, calls: [key: string, ...args: unknown[]][]) {
      const label = (value: any) => (typeof value === "function" ? value.name : JSON.stringify(value));
      return calls.map(([key, ...args]) => {
        let returned;
        try {
          returned = proto[key].apply(target, args);
        } catch (error: any) {
          returned = `${error instanceof TypeError ? "TypeError" : error} ${error.code}`;
        }
        return [`${key}(${args.map(label).join(", ")})`, returned === target ? "this" : returned];
      });
    }

    test("the methods work without the constructor having run", () => {
      const target = create();
      const received: unknown[] = [];
      function first(this: unknown, ...args: unknown[]) {
        received.push(["first", this === target, args]);
      }
      function second(this: unknown, ...args: unknown[]) {
        received.push(["second", this === target, args]);
      }

      expect(
        run(target, [
          ["getMaxListeners"],
          ["eventNames"],
          ["listeners", "x"],
          ["rawListeners", "x"],
          ["listenerCount", "x"],
          ["emit", "x"],
          ["removeListener", "x", first],
          ["off", "x", first],
          ["removeAllListeners", "x"],
        ]),
      ).toEqual([
        ["getMaxListeners()", 10],
        ["eventNames()", []],
        ['listeners("x")', []],
        ['rawListeners("x")', []],
        ['listenerCount("x")', 0],
        ['emit("x")', false],
        ['removeListener("x", first)', "this"],
        ['off("x", first)', "this"],
        ['removeAllListeners("x")', "this"],
      ]);
      expect(Reflect.ownKeys(target)).toEqual([]);

      const added = run(target, [
        ["on", "x", first],
        ["addListener", "x", second],
        ["prependListener", "x", second],
      ]);
      const events = target._events;
      expect({
        added,
        keys: Reflect.ownKeys(target),
        events: [Object.getPrototypeOf(events), Reflect.ownKeys(events), target._eventsCount],
        rest: run(target, [
          ["rawListeners", "x"],
          ["listeners", "x"],
          ["listenerCount", "x"],
          ["listenerCount", "x", second],
          ["eventNames"],
          ["emit", "x", 1, 2],
          ["setMaxListeners", 5],
          ["getMaxListeners"],
          ["removeListener", "x", second],
          ["rawListeners", "x"],
          ["off", "x", second],
          ["rawListeners", "x"],
          ["removeAllListeners", "x"],
          ["eventNames"],
        ]),
        received,
        after: [Reflect.ownKeys(target), target._events === events, target._eventsCount, target[kShapeMode]],
      }).toEqual({
        added: [
          ['on("x", first)', "this"],
          ['addListener("x", second)', "this"],
          ['prependListener("x", second)', "this"],
        ],
        keys: ["_events", "_eventsCount"],
        events: [null, ["x"], 1],
        rest: [
          ['rawListeners("x")', [second, first, second]],
          ['listeners("x")', [second, first, second]],
          ['listenerCount("x")', 3],
          ['listenerCount("x", second)', 2],
          ["eventNames()", ["x"]],
          ['emit("x", 1, 2)', true],
          ["setMaxListeners(5)", "this"],
          ["getMaxListeners()", 5],
          // The last of the two is removed.
          ['removeListener("x", second)', "this"],
          ['rawListeners("x")', [second, first]],
          ['off("x", second)', "this"],
          ['rawListeners("x")', [first]],
          ['removeAllListeners("x")', "this"],
          ["eventNames()", []],
        ],
        received: [
          ["second", true, [1, 2]],
          ["first", true, [1, 2]],
          ["second", true, [1, 2]],
        ],
        after: [["_events", "_eventsCount", "_maxListeners", kShapeMode], false, 0, false],
      });
    });

    test("once and prependOnceListener call on, prependListener and removeListener of the receiver", () => {
      const target = create();
      const received: unknown[] = [];
      function first(this: unknown, ...args: unknown[]) {
        received.push(["first", this === target, args]);
        return "first returned";
      }
      function second(this: unknown, ...args: unknown[]) {
        received.push(["second", this === target, args]);
      }

      expect(
        run(target, [
          ["once", "x", first],
          ["prependOnceListener", "x", first],
        ]),
      ).toEqual([
        ['once("x", first)', "TypeError undefined"],
        ['prependOnceListener("x", first)', "TypeError undefined"],
      ]);
      expect(Reflect.ownKeys(target)).toEqual([]);

      target.on = proto.on;
      target.prependListener = proto.prependListener;
      const added = run(target, [
        ["once", "x", first],
        ["prependOnceListener", "x", second],
      ]);
      const wrappers = proto.rawListeners.call(target, "x");
      // The wrapper removes itself with this.removeListener(), which the receiver does not have yet.
      const withoutRemoveListener = run(target, [
        ["listeners", "x"],
        ["listenerCount", "x", first],
        ["emit", "x", "a"],
        ["rawListeners", "x"],
      ]);
      target.removeListener = proto.removeListener;
      expect({
        added,
        wrappers: wrappers.map((fn: any) => [fn.name, fn.length, Reflect.ownKeys(fn), fn.listener]),
        listener: Object.getOwnPropertyDescriptor(wrappers[0], "listener"),
        withoutRemoveListener,
        // A wrapper that has run does nothing, also while it is still registered.
        withRemoveListener: run(target, [
          ["emit", "x", "b"],
          ["rawListeners", "x"],
          ["emit", "x", "c"],
        ]),
        received,
      }).toEqual({
        added: [
          ['once("x", first)', "this"],
          ['prependOnceListener("x", second)', "this"],
        ],
        wrappers: [
          ["onceWrapper", 0, ["length", "name", "listener"], second],
          ["onceWrapper", 0, ["length", "name", "listener"], first],
        ],
        listener: { value: second, ...data },
        withoutRemoveListener: [
          ['listeners("x")', [second, first]],
          ['listenerCount("x", first)', 1],
          ['emit("x", "a")', "TypeError undefined"],
          ['rawListeners("x")', wrappers],
        ],
        withRemoveListener: [
          ['emit("x", "b")', true],
          ['rawListeners("x")', [wrappers[0]]],
          ['emit("x", "c")', true],
        ],
        received: [["first", true, ["b"]]],
      });

      proto.once.call(target, "y", first);
      const [direct] = proto.rawListeners.call(target, "y");
      expect({
        // Called directly, the wrapper runs the listener on the emitter and unregisters itself, once.
        returned: [direct.call("ignored", 1, 2, 3, 4), direct.call("ignored", 5)],
        received: received.slice(1),
        listenerCount: proto.listenerCount.call(target, "y"),
      }).toEqual({
        returned: ["first returned", undefined],
        received: [["first", true, [1, 2, 3, 4]]],
        listenerCount: 0,
      });
    });

    test("an unhandled 'error' throws", () => {
      const target = create();
      const error = new Error("unhandled");
      const context = { reason: 1 };
      const unhandled = thrownBy(() => proto.emit.call(target, "error", context, 2));
      expect({
        error: thrownBy(() => proto.emit.call(target, "error", error)) === error,
        properties: [unhandled instanceof Error, unhandled.name, unhandled.code, unhandled.message],
        context: unhandled.context === context,
        withoutArguments: thrownBy(() => proto.emit.call(target, "error")).message,
        keys: Reflect.ownKeys(target),
      }).toEqual({
        error: true,
        properties: [true, "Error", "ERR_UNHANDLED_ERROR", "Unhandled error. ({ reason: 1 })"],
        context: true,
        withoutArguments: "Unhandled error. (undefined)",
        keys: [],
      });
    });
  });

  test("called on undefined, only getMaxListeners returns", () => {
    function listener() {}
    const results = methodKeys.map(key => {
      try {
        return [key, proto[key].apply(undefined, methodArguments[key] ?? ["x", listener])];
      } catch (error: any) {
        return [key, error instanceof TypeError, error.code];
      }
    });
    expect(results).toEqual(methodKeys.map(key => (key === "getMaxListeners" ? [key, 10] : [key, true, undefined])));
    expect("_maxListeners" in globalThis).toBe(false);
  });

  test("a subclass that overrides a method is called by the methods that use it", () => {
    const log: string[] = [];
    const label = (value: any) =>
      typeof value !== "function"
        ? String(value)
        : value.listener === undefined
          ? value.name
          : `${value.name}(${value.listener.name})`;
    class Recording extends EventEmitter {}
    const overridden = [
      "on",
      "addListener",
      "prependListener",
      "emit",
      "removeListener",
      "off",
      "removeAllListeners",
      "listenerCount",
      "getMaxListeners",
    ];
    for (const key of overridden) {
      (Recording.prototype as any)[key] = function (...args: unknown[]) {
        log.push(`${key}(${args.map(label).join(", ")})`);
        return proto[key].apply(this, args);
      };
    }
    const emitter = new Recording();
    function a() {}
    function b() {}
    function c() {}
    function onNewListener() {}
    function onRemoveListener() {}
    const step = (name: string, run: () => unknown) => {
      run();
      return [name, log.splice(0)];
    };

    expect([
      step("once", () => emitter.once("x", a)),
      step("prependOnceListener", () => emitter.prependOnceListener("x", b)),
      step("emit runs both once wrappers", () => emitter.emit("x", 1)),
      step("on 'newListener'", () => emitter.on("newListener", onNewListener)),
      step("on 'removeListener'", () => emitter.on("removeListener", onRemoveListener)),
      step("once", () => emitter.once("x", a)),
      step("prependOnceListener", () => emitter.prependOnceListener("x", b)),
      step("addListener", () => emitter.addListener("x", c)),
      step("emit runs both once wrappers", () => emitter.emit("x", 1)),
      step("off", () => emitter.off("x", c)),
      step("on, twice", () => emitter.on("y", a).on("y", b)),
      step("removeAllListeners(type)", () => emitter.removeAllListeners("y")),
      step("on", () => emitter.on("y", a)),
      step("removeAllListeners()", () => emitter.removeAllListeners()),
      step("on, twice, without a 'newListener' listener", () => emitter.on("z", a).on("z", b)),
      step("removeAllListeners(type) without a 'removeListener' listener", () => emitter.removeAllListeners("z")),
      step("removeAllListeners() without a 'removeListener' listener", () => emitter.on("z", a).removeAllListeners()),
      step("the listener limit is read without getMaxListeners()", () => {
        for (const listener of [a, b, c]) proto.on.call(emitter, "w", listener);
      }),
    ]).toEqual([
      ["once", ["on(x, onceWrapper(a))"]],
      ["prependOnceListener", ["prependListener(x, onceWrapper(b))"]],
      [
        "emit runs both once wrappers",
        ["emit(x, 1)", "removeListener(x, onceWrapper(b))", "removeListener(x, onceWrapper(a))"],
      ],
      ["on 'newListener'", ["on(newListener, onNewListener)"]],
      [
        "on 'removeListener'",
        ["on(removeListener, onRemoveListener)", "emit(newListener, removeListener, onRemoveListener)"],
      ],
      ["once", ["on(x, onceWrapper(a))", "emit(newListener, x, a)"]],
      ["prependOnceListener", ["prependListener(x, onceWrapper(b))", "emit(newListener, x, b)"]],
      ["addListener", ["addListener(x, c)", "emit(newListener, x, c)"]],
      [
        "emit runs both once wrappers",
        [
          "emit(x, 1)",
          "removeListener(x, onceWrapper(b))",
          "emit(removeListener, x, b)",
          "removeListener(x, onceWrapper(a))",
          "emit(removeListener, x, a)",
        ],
      ],
      ["off", ["off(x, c)", "emit(removeListener, x, c)"]],
      ["on, twice", ["on(y, a)", "emit(newListener, y, a)", "on(y, b)", "emit(newListener, y, b)"]],
      [
        "removeAllListeners(type)",
        [
          "removeAllListeners(y)",
          "removeListener(y, b)",
          "emit(removeListener, y, b)",
          "removeListener(y, a)",
          "emit(removeListener, y, a)",
        ],
      ],
      ["on", ["on(y, a)", "emit(newListener, y, a)"]],
      [
        "removeAllListeners()",
        [
          "removeAllListeners()",
          "removeAllListeners(newListener)",
          "removeListener(newListener, onNewListener)",
          "emit(removeListener, newListener, onNewListener)",
          "removeAllListeners(y)",
          "removeListener(y, a)",
          "emit(removeListener, y, a)",
          "removeAllListeners(removeListener)",
          "removeListener(removeListener, onRemoveListener)",
          // The last listener is gone and _events was replaced, but emit() is still called.
          "emit(removeListener, removeListener, onRemoveListener)",
        ],
      ],
      ["on, twice, without a 'newListener' listener", ["on(z, a)", "on(z, b)"]],
      ["removeAllListeners(type) without a 'removeListener' listener", ["removeAllListeners(z)"]],
      ["removeAllListeners() without a 'removeListener' listener", ["on(z, a)", "removeAllListeners()"]],
      ["the listener limit is read without getMaxListeners()", []],
    ]);
  });

  test("removeAllListeners(undefined) removes the listeners of the event named 'undefined', not all of them", () => {
    function listener() {}
    const removed: string[] = [];
    const plain = new EventEmitter().on("x", listener).on("undefined", listener);
    const watched = new EventEmitter()
      .on("x", listener)
      .on("undefined", listener)
      .on("removeListener", (type: unknown, fn: Function) => removed.push(`${typeof type} ${fn.name}`));
    expect({
      returned: [
        plain.removeAllListeners(undefined as any) === plain,
        watched.removeAllListeners(undefined as any) === watched,
      ],
      plain: plain.eventNames(),
      watched: watched.eventNames(),
      removed,
    }).toEqual({
      returned: [true, true],
      plain: ["x"],
      watched: ["x", "removeListener"],
      removed: ["undefined listener"],
    });
  });
});

// nodeEventEmitterPrototype() is EventEmitter.prototype as native code gets it. node:events has defined every method
// on that object, so the tests of a method that is created when it is read use nodeEventEmitterPrototype(true): a
// new object of the same class.
describe("EventEmitter.prototype as native code creates it", () => {
  const { hasNonReifiedStatic, nodeEventEmitterPrototype } = internalForTesting;
  const data = { writable: true, enumerable: true, configurable: true };
  const tableKeys = [methodKeys[0], "constructor", ...methodKeys.slice(1)];

  test("is the object that node:events exports, with every method a property", () => {
    expect(nodeEventEmitterPrototype()).toBe(EventEmitter.prototype);
    expect(hasNonReifiedStatic(EventEmitter.prototype)).toBe(false);
  });

  test("a new object has the keys of the table and creates a method when it is read", () => {
    const fresh: any = nodeEventEmitterPrototype(true);
    expect({
      isPrototype: fresh === EventEmitter.prototype,
      prototype: Object.getPrototypeOf(fresh) === Object.prototype,
      lazy: hasNonReifiedStatic(fresh),
      keys: Reflect.ownKeys(fresh),
      methods: prototypeMethods.map(([key]) => {
        const { value, ...attributes } = Object.getOwnPropertyDescriptor(fresh, key)!;
        return [key, value.name, value.length, attributes];
      }),
      constructor: fresh.constructor === EventEmitter,
      aliases: [fresh.on === fresh.addListener, fresh.off === fresh.removeListener],
      shared: methodKeys.filter(key => fresh[key] === (EventEmitter.prototype as any)[key]),
      keysAfter: Reflect.ownKeys(fresh),
    }).toEqual({
      isPrototype: false,
      prototype: true,
      lazy: true,
      keys: tableKeys,
      methods: prototypeMethods.map(([key, name, length]) => [key, name, length, data]),
      constructor: true,
      aliases: [true, true],
      shared: [],
      keysAfter: tableKeys,
    });
  });

  test.each([
    ["on", "addListener", "addListener"],
    ["addListener", "on", "addListener"],
    ["off", "removeListener", "removeListener"],
    ["removeListener", "off", "removeListener"],
  ] as const)("%s, read first, is the function that %s is", (first, second, name) => {
    const fresh: any = nodeEventEmitterPrototype(true);
    const method = fresh[first];
    expect([method === fresh[second], method.name, method.length]).toEqual([true, name, 2]);
  });

  test("a name that was assigned keeps its value, and its alias is the method", () => {
    const fresh: any = nodeEventEmitterPrototype(true);
    function replacement() {}
    fresh.addListener = replacement;
    fresh.off = replacement;
    expect({
      on: [fresh.on.name, fresh.on === replacement, fresh.addListener === replacement],
      removeListener: [fresh.removeListener.name, fresh.removeListener === replacement, fresh.off === replacement],
      keys: Reflect.ownKeys(fresh),
    }).toEqual({
      on: ["addListener", false, true],
      removeListener: ["removeListener", false, true],
      keys: tableKeys,
    });
  });

  test("the methods of a new object work on an object that inherits from it", () => {
    const emitter = Object.create(nodeEventEmitterPrototype(true));
    const calls: unknown[] = [];
    const listener = (...args: unknown[]) => calls.push(args);
    emitter.once("x", listener);
    emitter.prependListener("x", listener);
    expect({
      emitted: [emitter.emit("x", 1, 2, 3, 4), emitter.emit("x"), emitter.emit("y")],
      listeners: emitter.listenerCount("x"),
      calls,
      keys: Reflect.ownKeys(emitter),
    }).toEqual({
      emitted: [true, true, false],
      listeners: 1,
      calls: [[1, 2, 3, 4], [1, 2, 3, 4], []],
      keys: ["_events", "_eventsCount"],
    });
  });

  // A development build evaluates the arguments of $debug() on every call, and `constructor` is the property of the
  // prototype whose read evaluates node:events.
  test("emit does not read `constructor`", () => {
    let reads = 0;
    const counted = {
      constructor: {
        get() {
          reads++;
        },
      },
    };
    const emitter = Object.create(Object.create(nodeEventEmitterPrototype(true), counted));
    emitter.on("x", () => {});
    // An emitter that captures rejections has another `emit`, as a property of its own.
    const capturing = Object.defineProperties(new EventEmitter({ captureRejections: true }), counted);
    capturing.on("x", () => {});
    const emitted = [
      emitter.emit("x"),
      emitter.emit("x", 1, 2, 3, 4),
      capturing.emit("x"),
      capturing.emit("x", 1, 2, 3, 4),
    ];
    expect({ emitted, ownEmit: Object.hasOwn(capturing, "emit"), reads }).toEqual({
      emitted: [true, true, true, true],
      ownEmit: true,
      reads: 0,
    });
  });
});

// Each case runs in its own process, in which nothing evaluates node:events before the case does: loading
// bun:internal-for-testing does not, and console.log() does not either (process.stdout would).
describe("EventEmitter.prototype before node:events is evaluated", () => {
  const tableKeys = [methodKeys[0], "constructor", ...methodKeys.slice(1)] as string[];
  const keys = [...tableKeys, "_eventsCount", "Symbol(kCapture)"];
  // node:events, when it is evaluated, defines every method on the prototype and adds _eventsCount to it.
  const untouched = { lazy: true, _eventsCount: false };
  const evaluated = { lazy: false, _eventsCount: true };

  const prelude = `
    const { hasNonReifiedStatic, nodeEventEmitterPrototype } = require("bun:internal-for-testing");
    const proto = nodeEventEmitterPrototype();
    const methodKeys = ${JSON.stringify(methodKeys)};
    const keys = object => Reflect.ownKeys(object).map(String);
    const state = () => ({ lazy: hasNonReifiedStatic(proto), _eventsCount: Object.hasOwn(proto, "_eventsCount") });
    const print = value => console.log(JSON.stringify(value, null, 2));
  `;

  const cases: [name: string, source: string, expected: unknown][] = [
    [
      "the native getter and the 15 methods do not evaluate node:events",
      `
        const created = state();
        const emitter = Object.create(proto);
        const received = [];
        function first(...args) {
          received.push(["first", ...args]);
        }
        function second(...args) {
          received.push(["second", ...args]);
        }
        function third(...args) {
          received.push(["third", ...args]);
        }
        const label = value =>
          typeof value !== "function" ? value : value.listener ? "once " + value.listener.name : value.name;
        const called = new Set();
        // The first method whose call left node:events evaluated.
        let evaluatedBy = null;
        const call = (key, ...args) => {
          const returned = emitter[key](...args);
          called.add(key);
          if (evaluatedBy === null && !hasNonReifiedStatic(proto)) evaluatedBy = key;
          return [key, returned === emitter ? "this" : Array.isArray(returned) ? returned.map(label) : returned];
        };
        const returned = [
          call("setMaxListeners", 5),
          call("getMaxListeners"),
          call("on", "x", first),
          call("addListener", "x", second),
          call("prependListener", "x", third),
          call("once", "y", first),
          call("prependOnceListener", "y", second),
          call("listeners", "y"),
          call("rawListeners", "y"),
          call("listenerCount", "x"),
          call("eventNames"),
          call("emit", "x", 1),
          call("emit", "y", 2, 3),
          call("emit", "y"),
          call("removeListener", "x", third),
          call("off", "x", first),
          call("rawListeners", "x"),
          call("removeAllListeners"),
          call("eventNames"),
        ];
        print({
          created,
          returned,
          received,
          notCalled: methodKeys.filter(key => !called.has(key)),
          evaluatedBy,
          after: state(),
          keys: keys(proto),
        });
      `,
      {
        created: untouched,
        returned: [
          ["setMaxListeners", "this"],
          ["getMaxListeners", 5],
          ["on", "this"],
          ["addListener", "this"],
          ["prependListener", "this"],
          ["once", "this"],
          ["prependOnceListener", "this"],
          ["listeners", ["second", "first"]],
          ["rawListeners", ["once second", "once first"]],
          ["listenerCount", 3],
          ["eventNames", ["x", "y"]],
          ["emit", true],
          ["emit", true],
          ["emit", false],
          ["removeListener", "this"],
          ["off", "this"],
          ["rawListeners", ["second"]],
          ["removeAllListeners", "this"],
          ["eventNames", []],
        ],
        received: [
          ["third", 1],
          ["first", 1],
          ["second", 1],
          ["second", 2, 3],
          ["first", 2, 3],
        ],
        notCalled: [],
        evaluatedBy: null,
        after: untouched,
        keys: tableKeys,
      },
    ],
    [
      "node:events adopts the prototype that the methods were read from, and gives it its own key order",
      `
        // Last to first, so that no method is defined in the place that it has among the keys.
        const read = [...methodKeys].reverse().map(key => proto[key]).reverse();
        function replacement() {}
        proto.listeners = replacement;
        const emitter = Object.create(proto).on("x", replacement);
        const before = state();
        const EventEmitter = require("node:events");
        print({
          before,
          isPrototype: EventEmitter.prototype === proto,
          after: state(),
          keys: keys(proto),
          // A method is still the function that was read, and the name that was assigned keeps its value.
          changed: methodKeys.filter((key, i) => proto[key] !== read[i]),
          listeners: proto.listeners === replacement,
          constructor: proto.constructor === EventEmitter,
          emitter: [emitter instanceof EventEmitter, emitter.listenerCount("x"), emitter.emit("x")],
        });
      `,
      {
        before: untouched,
        isPrototype: true,
        after: evaluated,
        keys,
        changed: ["listeners"],
        listeners: true,
        constructor: true,
        emitter: [true, 1, true],
      },
    ],
    [
      "reading `constructor` evaluates node:events",
      `
        const before = state();
        const EventEmitter = proto.constructor;
        print({
          before,
          constructor: [typeof EventEmitter, EventEmitter.name, EventEmitter === require("node:events")],
          isPrototype: EventEmitter.prototype === proto,
          after: state(),
          keys: keys(proto),
        });
      `,
      {
        before: untouched,
        constructor: ["function", "EventEmitter", true],
        isPrototype: true,
        after: evaluated,
        keys,
      },
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, source, expected) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: JSON.stringify(expected, null, 2).split("\n"),
      stderr: "",
      exitCode: 0,
    });
  });
});

// Each case runs in its own process: what it checks depends on nothing having read or written the properties of
// EventEmitter.prototype before.
describe("EventEmitter.prototype in a fresh process", () => {
  const keys = [methodKeys[0], "constructor", ...methodKeys.slice(1), "_eventsCount", "Symbol(kCapture)"] as string[];
  const without = (...removed: string[]) => keys.filter(key => !removed.includes(key));
  const inspected = ["EventEmitter {", ...inspectedMethods, "  [Symbol(kCapture)]: false,", "  _eventsCount: 0,", "}"];
  const attributes = "writable,true,enumerable,true,configurable,true";
  const worked = [[true, true, true, false], [[1]]];

  const prelude = `
    const EventEmitter = require("node:events");
    const proto = EventEmitter.prototype;
    const methodKeys = ${JSON.stringify(methodKeys)};
    const keys = object => Reflect.ownKeys(object).map(String);
    const describe = fn => [typeof fn, fn.name, fn.length];
    const works = (on, off) => {
      const emitter = new EventEmitter();
      const calls = [];
      const listener = (...args) => calls.push(args);
      const returned = [on.call(emitter, "x", listener) === emitter, emitter.emit("x", 1)];
      returned.push(off.call(emitter, "x", listener) === emitter, emitter.emit("x", 2));
      return [returned, calls];
    };
    const replacement = () => {
      throw new Error("the replacement was called");
    };
    const print = value => console.log(JSON.stringify(value, null, 2));
  `;

  const cases: [name: string, source: string, expected: unknown][] = [
    [
      "off is removeListener when off is read first",
      `
        const off = proto.off;
        const removeListener = proto.removeListener;
        print({
          off: [...describe(off), off === removeListener, off === proto.off],
          works: works(proto.on, off),
          keys: keys(proto),
        });
      `,
      { off: ["function", "removeListener", 2, true, true], works: worked, keys },
    ],
    [
      "on is addListener when on is read first",
      `
        const on = proto.on;
        const addListener = proto.addListener;
        print({
          on: [...describe(on), on === addListener, on === proto.on],
          works: works(on, proto.off),
          keys: keys(proto),
        });
      `,
      { on: ["function", "addListener", 2, true, true], works: worked, keys },
    ],
    [
      "on and removeListener are not the addListener and the off that were overwritten first",
      `
        proto.addListener = replacement;
        proto.off = replacement;
        const { on, removeListener } = proto;
        print({
          on: [...describe(on), on === replacement, proto.addListener === replacement],
          removeListener: [...describe(removeListener), removeListener === replacement, proto.off === replacement],
          works: works(on, removeListener),
          keys: keys(proto),
        });
      `,
      {
        on: ["function", "addListener", 2, false, true],
        removeListener: ["function", "removeListener", 2, false, true],
        works: worked,
        keys,
      },
    ],
    [
      "a deleted method is gone, its alias stays, and a method added again is the last string key",
      `
        const deleted = [delete proto.on, delete proto.removeListener, delete proto.emit];
        const afterDelete = keys(proto);
        const emitter = new EventEmitter();
        const has = ["on", "removeListener", "emit", "addListener", "off"].map(key => key in emitter);
        proto.emit = function emit() {};
        print({
          deleted,
          has,
          addListener: describe(proto.addListener),
          off: describe(proto.off),
          afterDelete,
          afterAdd: keys(proto),
        });
      `,
      {
        deleted: [true, true, true],
        has: [false, false, false, true, true],
        addListener: ["function", "addListener", 2],
        off: ["function", "removeListener", 2],
        afterDelete: without("on", "removeListener", "emit"),
        afterAdd: [...without("on", "removeListener", "emit", "Symbol(kCapture)"), "emit", "Symbol(kCapture)"],
      },
    ],
    [
      "the key order does not depend on the order the methods are read in",
      `
        const read = [...methodKeys].reverse().map(key => [key, proto[key].name]);
        const afterRead = keys(proto);
        Object.defineProperty(proto, "eventNames", { value: proto.eventNames });
        const afterDefine = keys(proto);
        delete proto.listenerCount;
        print({ read, afterRead, afterDefine, afterDelete: keys(proto), inspected: Bun.inspect(proto).split("\\n") });
      `,
      {
        read: prototypeMethods.map(([key, name]) => [key, name]).reverse(),
        afterRead: keys,
        afterDefine: keys,
        afterDelete: without("listenerCount"),
        inspected: inspected.filter(line => !line.includes("listenerCount")),
      },
    ],
    [
      "Bun.inspect prints every method and leaves the key order alone",
      `
        const inspected = [Bun.inspect(proto), Bun.inspect(new EventEmitter())].map(text => text.split("\\n"));
        const aliases = [proto.on === proto.addListener, proto.off === proto.removeListener];
        print({ inspected, keys: keys(proto), aliases });
      `,
      {
        inspected: [
          inspected,
          [
            "EventEmitter {",
            "  _events: [Object: null prototype] {},",
            "  _eventsCount: 0,",
            "  [Symbol(shapeMode)]: false,",
            "  _maxListeners: undefined,",
            "  [Symbol(kCapture)]: false,",
            ...inspectedMethods,
            "}",
          ],
        ],
        keys,
        aliases: [true, true],
      },
    ],
    [
      "every way of enumerating sees the methods, in order, when nothing was read before",
      `
        const visited = [];
        for (const key in new EventEmitter()) visited.push(key);
        const enumerable = Object.keys(proto);
        const descriptors = Object.entries(Object.getOwnPropertyDescriptors(proto)).map(
          ([key, { value, ...attributes }]) => [
            key,
            typeof value === "function" ? [value.name, value.length] : value,
            Object.entries(attributes).join(),
          ],
        );
        const copy = Object.assign({}, proto);
        print({
          visited,
          enumerable,
          descriptors,
          copy: keys(copy),
          copyDiffers: Reflect.ownKeys(proto).filter(key => copy[key] !== proto[key]).map(String),
          spread: keys({ ...proto }),
          json: JSON.stringify(proto),
          keys: keys(proto),
        });
      `,
      {
        visited: ["_events", "_eventsCount", "_maxListeners", ...without("_eventsCount", "Symbol(kCapture)")],
        enumerable: without("Symbol(kCapture)"),
        descriptors: [
          ["setMaxListeners", ["setMaxListeners", 1], attributes],
          ["constructor", ["EventEmitter", 1], attributes],
          ...prototypeMethods.slice(1).map(([key, name, length]) => [key, [name, length], attributes]),
          ["_eventsCount", 0, attributes],
        ],
        copy: keys,
        copyDiffers: [],
        spread: keys,
        json: '{"_eventsCount":0}',
        keys,
      },
    ],
    [
      "the listener limit is the default at the time a listener is added",
      `
        process.removeAllListeners("warning");
        const warnings = [];
        process.on("warning", warning => {
          const { name, message, type, count } = warning;
          const error = warning instanceof Error;
          warnings.push({ error, name, message, type, count, emitter: warning.emitter === emitter });
        });
        class Named extends EventEmitter {}
        const emitter = new Named();
        const listener = () => {};
        const limits = [emitter.getMaxListeners()];
        EventEmitter.defaultMaxListeners = 2;
        limits.push(emitter.getMaxListeners());
        emitter.on("x", listener).on("x", listener);
        const warned = [emitter._events.x.warned];
        emitter.on("x", listener);
        warned.push(emitter._events.x.warned);
        emitter.on("x", listener).off("x", listener);
        warned.push(emitter._events.x.warned, emitter._events.x.length);
        EventEmitter.defaultMaxListeners = 1;
        emitter.prependListener("y", listener).prependListener("y", listener);
        EventEmitter.setMaxListeners(0);
        for (let i = 0; i < 3; i++) emitter.once("z", listener);
        limits.push(emitter.getMaxListeners(), EventEmitter.defaultMaxListeners);
        process.nextTick(() => print({ limits, warned, warnings }));
      `,
      {
        limits: [10, 2, 0, 0],
        warned: [null, true, true, 3],
        warnings: [
          {
            error: true,
            name: "MaxListenersExceededWarning",
            message:
              "Possible EventEmitter memory leak detected. 3 x listeners added to [Named]. MaxListeners is 2. " +
              "Use emitter.setMaxListeners() to increase limit",
            type: "x",
            count: 3,
            emitter: true,
          },
          {
            error: true,
            name: "MaxListenersExceededWarning",
            message:
              "Possible EventEmitter memory leak detected. 2 y listeners added to [Named]. MaxListeners is 1. " +
              "Use emitter.setMaxListeners() to increase limit",
            type: "y",
            count: 2,
            emitter: true,
          },
        ],
      },
    ],
  ];

  test.concurrent.each(cases)("%s", async (_name, source, expected) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: JSON.stringify(expected, null, 2).split("\n"),
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("EventEmitter.defaultMaxListeners", () => {
  test("is one value that every reader sees, also an emitter created before it changed", () => {
    const { get, set, ...attributes } = Object.getOwnPropertyDescriptor(EventEmitter, "defaultMaxListeners")!;
    const before = new EventEmitter();
    const pinned = new EventEmitter().setMaxListeners(4);
    const target = new EventTarget();
    const read = () => [
      EventEmitter.defaultMaxListeners,
      before.getMaxListeners(),
      getMaxListeners(before),
      new EventEmitter().getMaxListeners(),
      EventEmitter.prototype.getMaxListeners.call({}),
      getMaxListeners(new EventTarget()),
      pinned.getMaxListeners(),
    ];
    const setLimit = setMaxListeners as (n?: number, ...targets: (EventEmitter | EventTarget)[]) => void;
    const seen: unknown[] = [];
    try {
      seen.push(read());
      EventEmitter.defaultMaxListeners = 3;
      seen.push(read());
      // Without targets, events.setMaxListeners() sets the default.
      seen.push(setLimit(7), read());
      // Without a number, it uses the default.
      seen.push(setLimit(), read());
      seen.push(setLimit(undefined, before, target), [(before as any)._maxListeners, getMaxListeners(target)]);
      set!(0);
      seen.push(get!(), read());
    } finally {
      EventEmitter.defaultMaxListeners = 10;
    }

    expect({ accessor: [typeof get, typeof set, attributes], seen }).toEqual({
      accessor: ["function", "function", { enumerable: true, configurable: false }],
      seen: [
        [10, 10, 10, 10, 10, 10, 4],
        [3, 3, 3, 3, 3, 3, 4],
        undefined,
        [7, 7, 7, 7, 7, 7, 4],
        undefined,
        [7, 7, 7, 7, 7, 7, 4],
        undefined,
        [7, 7],
        0,
        [0, 7, 7, 0, 0, 0, 4],
      ],
    });
  });
});

describe("EventEmitter with a preallocated _events", () => {
  function Preallocated(this: any) {
    this._events = { a: undefined, b: undefined };
    EventEmitter.call(this);
  }
  Object.setPrototypeOf(Preallocated.prototype, EventEmitter.prototype);

  const data = { writable: true, enumerable: true, configurable: true };
  function first() {}
  function second() {}
  const label = (value: any) => (Array.isArray(value) ? `[${value.map(label)}]` : (value?.name ?? String(value)));
  // [_events is the preallocated object, its properties, _eventsCount, kShapeMode, eventNames()]
  const state = (emitter: any, preallocated: object) => [
    emitter._events === preallocated,
    Reflect.ownKeys(emitter._events)
      .map(key => `${String(key)}: ${label(emitter._events[key])}`)
      .join(", "),
    emitter._eventsCount,
    emitter[kShapeMode],
    emitter.eventNames().join(),
  ];

  test("the constructor keeps the object and does not create _eventsCount", () => {
    const emitter = new (Preallocated as any)();
    const { _events, ...rest } = Object.getOwnPropertyDescriptors(emitter);
    expect({
      keys: Reflect.ownKeys(emitter),
      events: [Object.getPrototypeOf(_events.value) === Object.prototype, Object.entries(_events.value)],
      rest,
      count: emitter._eventsCount,
    }).toEqual({
      keys: ["_events", "_maxListeners", kShapeMode, kCapture],
      events: [
        true,
        [
          ["a", undefined],
          ["b", undefined],
        ],
      ],
      rest: {
        _maxListeners: { value: undefined, ...data },
        [kShapeMode]: { value: true, ...data },
        [kCapture]: { value: false, ...data },
      },
      count: 0,
    });
  });

  test("adding and removing listeners keeps the object and its keys", () => {
    const emitter = new (Preallocated as any)();
    const events = emitter._events;
    const step = (name: string, run: () => unknown) => {
      run();
      return [name, ...state(emitter, events)];
    };

    expect([
      step("on a", () => emitter.on("a", first)),
      step("on a", () => emitter.on("a", second)),
      step("off a", () => emitter.off("a", first)),
      step("off a", () => emitter.off("a", second)),
      step("once c, emit c", () => emitter.once("c", first).emit("c")),
      step("on b, prependListener c", () => emitter.on("b", first).prependListener("c", second)),
      step("removeListener b", () => emitter.removeListener("b", first)),
    ]).toEqual([
      ["on a", true, "a: first, b: undefined", 1, true, "a,b"],
      ["on a", true, "a: [first,second], b: undefined", 1, true, "a,b"],
      ["off a", true, "a: second, b: undefined", 1, true, "a,b"],
      ["off a", true, "a: undefined, b: undefined", 0, true, ""],
      ["once c, emit c", true, "a: undefined, b: undefined, c: undefined", 0, true, ""],
      ["on b, prependListener c", true, "a: undefined, b: first, c: second", 2, true, "a,b,c"],
      ["removeListener b", true, "a: undefined, b: undefined, c: second", 1, true, "a,b,c"],
    ]);
    expect(Object.getOwnPropertyDescriptor(emitter, "_eventsCount")).toEqual({ value: 1, ...data });
  });

  test("properties that _events inherits are listeners", () => {
    const emitter = new (Preallocated as any)();
    expect({
      listenerCount: emitter.listenerCount("valueOf"),
      listeners: emitter.listeners("valueOf"),
      rawListeners: emitter.rawListeners("valueOf"),
      emit: emitter.emit("valueOf"),
      eventNames: emitter.eventNames(),
      notPreallocated: new EventEmitter().listenerCount("valueOf"),
    }).toEqual({
      listenerCount: 1,
      listeners: [Object.prototype.valueOf],
      rawListeners: [Object.prototype.valueOf],
      emit: true,
      eventNames: [],
      notPreallocated: 0,
    });
  });

  test("removeAllListeners ends it", () => {
    const byType = new (Preallocated as any)();
    const byTypeEvents = byType._events;
    byType.on("a", first).on("a", second).on("b", first).removeAllListeners("a");
    const afterType = state(byType, byTypeEvents);
    byType.off("b", first);
    const afterLast = state(byType, byTypeEvents);

    const unused = new (Preallocated as any)();
    const unusedEvents = unused._events;
    unused.removeAllListeners("a");

    const all = new (Preallocated as any)();
    const allEvents = all._events;
    all.on("a", first).removeAllListeners();

    expect({
      afterType,
      afterLast,
      unused: state(unused, unusedEvents),
      all: [...state(all, allEvents), Object.getPrototypeOf(all._events)],
      allEvents: Object.entries(allEvents),
    }).toEqual({
      afterType: [true, "b: first", 1, false, "b"],
      afterLast: [false, "", 0, false, ""],
      unused: [true, "a: undefined, b: undefined", 0, false, ""],
      all: [false, "", 0, false, "", null],
      allEvents: [
        ["a", first],
        ["b", undefined],
      ],
    });
  });

  test("removeAllListeners with a 'removeListener' listener", () => {
    const removed: string[] = [];
    function onRemoveListener(type: string, listener: Function) {
      removed.push(`${type}: ${listener.name}`);
    }
    const emitter = new (Preallocated as any)();
    const events = emitter._events;
    emitter.on("a", first).on("a", second).on("removeListener", onRemoveListener).removeAllListeners("a");
    const afterType = [...state(emitter, events), removed.splice(0)];
    emitter.on("b", first).removeAllListeners();

    expect({ afterType, afterAll: [...state(emitter, events), removed], events: Object.entries(events) }).toEqual({
      afterType: [
        true,
        "a: undefined, b: undefined, removeListener: onRemoveListener",
        1,
        true,
        "a,b,removeListener",
        ["a: second", "a: first"],
      ],
      afterAll: [false, "", 0, false, "", ["b: first"]],
      events: [
        ["a", undefined],
        ["b", undefined],
        ["removeListener", undefined],
      ],
    });
  });
});

describe("EventEmitter argument validation", () => {
  const notFunctions = [
    [42, "type number (42)"],
    [undefined, "undefined"],
    [null, "null"],
    [{}, "an instance of Object"],
    ["listener", "type string ('listener')"],
  ] as const;

  test.each(["addListener", "on", "prependListener", "once", "prependOnceListener", "removeListener", "off"] as const)(
    "%s requires a function",
    method => {
      const emitter: any = new EventEmitter();
      emitter.on("x", () => {});
      const events = emitter._events;
      const errors = notFunctions.map(([listener]) => {
        const error = thrownBy(() => emitter[method]("x", listener));
        return [error instanceof TypeError, error?.name, error?.code, error?.message];
      });

      expect({
        errors,
        unchanged: [emitter._events === events, emitter.listenerCount("x"), emitter.eventNames()],
      }).toEqual({
        errors: notFunctions.map(([, received]) => [
          true,
          "TypeError",
          "ERR_INVALID_ARG_TYPE",
          `The "listener" argument must be of type function. Received ${received}`,
        ]),
        unchanged: [true, 1, ["x"]],
      });
    },
  );

  test.each([
    [-1, RangeError, "ERR_OUT_OF_RANGE", "The value of * is out of range. It must be >= 0. Received -1"],
    [NaN, RangeError, "ERR_OUT_OF_RANGE", "The value of * is out of range. It must be >= 0. Received NaN"],
    ["1", TypeError, "ERR_INVALID_ARG_TYPE", "The * argument must be of type number. Received type string ('1')"],
    [null, TypeError, "ERR_INVALID_ARG_TYPE", "The * argument must be of type number. Received null"],
  ] as const)("%p is not a listener limit", (n: any, constructor, code, message) => {
    const emitter: any = new EventEmitter();
    const describeError = (fn: () => unknown) => {
      const error = thrownBy(fn);
      return [error instanceof constructor, error?.name, error?.code, error?.message];
    };
    const expected = (name: string) => [true, constructor.name, code, message.replace("*", `"${name}"`)];

    expect({
      method: describeError(() => emitter.setMaxListeners(n)),
      withTarget: describeError(() => setMaxListeners(n, emitter)),
      withoutTarget: describeError(() => setMaxListeners(n)),
      accessor: describeError(() => {
        EventEmitter.defaultMaxListeners = n;
      }),
      unchanged: [emitter._maxListeners, emitter.getMaxListeners(), EventEmitter.defaultMaxListeners],
    }).toEqual({
      method: expected("setMaxListeners"),
      withTarget: expected("setMaxListeners"),
      withoutTarget: expected("setMaxListeners"),
      accessor: expected("defaultMaxListeners"),
      unchanged: [undefined, 10, 10],
    });
  });

  test("setMaxListeners() requires a number", () => {
    const emitter: any = new EventEmitter();
    expect(() => emitter.setMaxListeners()).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: 'The "setMaxListeners" argument must be of type number. Received undefined',
      }),
    );
  });

  test.each([0, 1.5, Infinity])("%p is a listener limit", n => {
    const emitter = new EventEmitter();
    expect(emitter.setMaxListeners(n)).toBe(emitter);
    expect(emitter.getMaxListeners()).toBe(n);
  });
});

test("a Worker has its own defaultMaxListeners and captureRejections", async () => {
  const source = `
    const EventEmitter = require("node:events");
    const read = () => [
      EventEmitter.defaultMaxListeners,
      new EventEmitter().getMaxListeners(),
      EventEmitter.captureRejections,
      Object.hasOwn(new EventEmitter(), "emit"),
    ];
    const before = read();
    EventEmitter.defaultMaxListeners = 3;
    EventEmitter.captureRejections = true;
    postMessage({ before, after: read() });
  `;
  const url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  const read = () => [
    EventEmitter.defaultMaxListeners,
    new EventEmitter().getMaxListeners(),
    EventEmitter.captureRejections,
    Object.hasOwn(new EventEmitter(), "emit"),
  ];
  const worker = new Worker(url);
  try {
    const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();
    worker.onmessage = resolve;
    worker.onerror = event => reject(new Error(event.message));
    worker.addEventListener("close", () => reject(new Error("the worker closed before it sent a message")));

    EventEmitter.defaultMaxListeners = 5;
    const before = read();
    const { data } = await promise;
    expect({ before, worker: data, after: read() }).toEqual({
      before: [5, 5, false, false],
      worker: { before: [10, 10, false, false], after: [3, 3, true, true] },
      after: [5, 5, false, false],
    });
  } finally {
    EventEmitter.defaultMaxListeners = 10;
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});
