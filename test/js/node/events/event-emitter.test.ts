import { test, describe, expect, mock } from "bun:test";
import { sleep } from "bun";
import { createRequire } from "module";

// this is also testing that imports with default and named imports in the same statement work
// our transpiler transform changes this to a var with import.meta.require
import EventEmitter, { getEventListeners, captureRejectionSymbol } from "node:events";

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
});

describe("EventEmitter", () => {
  test("getEventListeners", () => {
    expect(getEventListeners(new EventEmitter(), "hey").length).toBe(0);
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

    await new Promise(resolve => setTimeout(resolve, 1000));

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
    }, 1_000);

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

  test("AbortController", () => {
    const { on, EventEmitter } = require("node:events");

    const ac = new AbortController();
    const ee = new EventEmitter();
    const output = [];

    process.nextTick(() => {
      ee.emit("foo", "bar");
      ee.emit("foo", 42);
      ee.emit("foo", "baz");
    });
    (async () => {
      try {
        for await (const event of on(ee, "foo", { signal: ac.signal })) {
          output.push([1, event]);
        }
        console.log("unreachable");
      } catch (error: any) {
        const { code, message } = error;
        output.push([2, { code, message }]);

        expect(output).toEqual([
          [1, ["bar"]],
          [1, [42]],
          [1, ["baz"]],
          [
            2,
            {
              code: "ABORT_ERR",
              message: "The operation was aborted",
            },
          ],
        ]);
      }
    })();

    process.nextTick(() => ac.abort());
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

test("getMaxListeners", () => {
  const emitter = new EventEmitter();
  expect(emitter.getMaxListeners()).toBe(10);
  emitter.setMaxListeners(20);
  expect(emitter.getMaxListeners()).toBe(20);
});
