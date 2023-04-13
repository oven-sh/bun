import { test, describe, expect } from "bun:test";
// import { heapStats } from "bun:jsc";
// import { expectMaxObjectTypeCount, gc } from "harness";

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

  // Next two tests are checking exact behavior
  // https://nodejs.org/api/events.html#awaiting-multiple-events-emitted-on-processnexttick
  test("once (multiple, only first hits)", () => {
    const emitter = new EventEmitter();
    let a, b;
    EventEmitter.once(emitter, "hey").then(() => {
      a = true;
    });
    EventEmitter.once(emitter, "hey").then(() => {
      b = true;
    });
    emitter.emit("hey");
    expect(a).toBe(true);
    expect(b).toBe(false);
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

  // TODO: extensive events.on tests
  // test("on", () => {
  //   const emitter = new EventEmitter();
  //   const asyncIterator = EventEmitter.on(emitter, "hey");

  //   expect(asyncIterator.next).toBeDefined();
  //   expect(asyncIterator[Symbol.asyncIterator]).toBeDefined();

  //   const fn = async () => {
  //     const { value } = await asyncIterator.next();
  //     expect(value).toBe(1);
  //   };

  //   emitter.emit("hey", 1, 2, 3);
  // });
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
    test("async microtask before", async done => {
      await 1;
      var emitter = new EventEmitter();
      emitter.on("wow", () => done());
      emitter.emit("wow");
    });

    test("async microtask after", async done => {
      var emitter = new EventEmitter();
      emitter.on("wow", () => done());
      await 1;
      emitter.emit("wow");
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
  });

  test("addListener return type", () => {
    var myEmitter = new EventEmitter();
    expect(myEmitter.addListener("foo", () => {})).toBe(myEmitter);
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
  });

  test("rawListeners", () => {
    const myEmitter = new EventEmitter();
    const fn = () => {};
    myEmitter.on("foo", fn);
    expect(myEmitter.listeners("foo")).toEqual([fn]);
    const fn2 = () => {};
    myEmitter.on("foo", fn2);
    expect(myEmitter.listeners("foo")).toEqual([fn, fn2]);
    myEmitter.off("foo", fn2);
    expect(myEmitter.listeners("foo")).toEqual([fn]);
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
    const myEmitter = new EventEmitter() as EventEmitter & { _eventsCount: number };
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
    // init is a undocumented property that is identical to the constructor
    // in node, EventEmitter just calls init()
    expect(EventEmitter).toBe((EventEmitter as any).init);
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

  //   await Bun.sleep(1);

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

    await Bun.sleep(5);

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

    await Bun.sleep(5);

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

    await Bun.sleep(5);

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
    test(`${create.toString().slice(10, 40).replaceAll("\n", "\\n").trim()} should work`, () => {
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

      expect(firstEvents).toBe(myEmitter._events);
      expect(called).toBe(true);
    });
  }
});

// Internally, EventEmitter has a JSC::Weak with the thisValue of the listener
// edit: it does not at the moment. do we remove this test?
// test("EventEmitter GCs", async () => {
//   gc();

//   const startCount = heapStats().objectTypeCounts["EventEmitter"] ?? 0;
//   (function () {
//     function EventEmitterSubclass(this: any) {
//       EventEmitter.call(this);
//     }

//     Object.setPrototypeOf(EventEmitterSubclass.prototype, EventEmitter.prototype);
//     Object.setPrototypeOf(EventEmitterSubclass, EventEmitter);
//     // @ts-ignore
//     var myEmitter = new EventEmitterSubclass();
//     myEmitter.on("foo", () => {});
//     myEmitter.emit("foo");
//   })();

//   await expectMaxObjectTypeCount(expect, "EventEmitter", startCount);
// });
