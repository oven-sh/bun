import { test, describe, expect, it } from "bun:test";
// import { heapStats } from "bun:jsc";
// import { expectMaxObjectTypeCount, gc } from "harness";

// this is also testing that imports with default and named imports in the same statement work
// our transpiler transform changes this to a var with import.meta.require
import EventEmitter, { getEventListeners, captureRejectionSymbol } from "node:events";

describe("EventEmitter", () => {
  it("captureRejectionSymbol", () => {
    expect(EventEmitter.captureRejectionSymbol).toBeDefined();
    expect(captureRejectionSymbol).toBeDefined();
    expect(captureRejectionSymbol).toBe(EventEmitter.captureRejectionSymbol);
  });
  test("getEventListeners", () => {
    expect(getEventListeners(new EventEmitter(), "hey").length).toBe(0);
  });
  test("EventEmitter constructor", () => {
    var emitter = new EventEmitter();
    emitter.setMaxListeners(100);
    expect(emitter.getMaxListeners()).toBe(100);
  });

  test("EventEmitter.removeAllListeners()", () => {
    var emitter = new EventEmitter();
    var ran = false;
    emitter.on("hey", () => {
      ran = true;
    });
    emitter.removeAllListeners();
    expect(emitter.listenerCount("hey")).toBe(0);
    emitter.emit("hey");
    expect(ran).toBe(false);
    emitter.on("hey", () => {
      ran = true;
    });
    emitter.emit("hey");
    expect(ran).toBe(true);
    expect(emitter.listenerCount("hey")).toBe(1);
  });

  // These are also tests for the done() function in the test runner.
  test("EventEmitter emit (different tick)", done => {
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    queueMicrotask(() => {
      emitter.emit("wow");
    });
  });

  // Unlike Jest, bun supports async and done
  test("async EventEmitter emit (microtask)", async done => {
    await 1;
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    emitter.emit("wow");
  });

  test("async EventEmitter emit (microtask) after", async done => {
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    await 1;
    emitter.emit("wow");
  });

  test("EventEmitter emit (same tick)", done => {
    var emitter = new EventEmitter();

    emitter.on("wow", () => done());

    emitter.emit("wow");
  });

  test("EventEmitter emit (setTimeout task)", done => {
    var emitter = new EventEmitter();
    emitter.on("wow", () => done());
    setTimeout(() => emitter.emit("wow"), 1);
  });

  test("EventEmitter.on", () => {
    var myEmitter = new EventEmitter();
    expect(myEmitter.on("foo", () => {})).toBe(myEmitter);
  });

  test("EventEmitter.off", () => {
    var myEmitter = new EventEmitter();
    expect(myEmitter.off("foo", () => {})).toBe(myEmitter);
  });

  test("EventEmitter.once", () => {
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

  test("EventEmitter aliases", () => {
    expect(EventEmitter.prototype.addListener).toBe(EventEmitter.prototype.on);
    expect(EventEmitter.prototype.removeListener).toBe(EventEmitter.prototype.off);
  });

  test("EventEmitter.prependListener", () => {
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

  test("EventEmitter.prependOnceListener", () => {
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
    myEmitter.emit("foo");

    expect(order).toEqual([3, 2, 1, 4, 1, 4]);
  });

  test("EventEmitter.listeners", () => {
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

  test("EventEmitter.rawListeners", () => {
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

  test("EventEmitter.eventNames", () => {
    const myEmitter = new EventEmitter();
    expect(myEmitter.eventNames()).toEqual([]);
    myEmitter.on("foo", () => {});
    expect(myEmitter.eventNames()).toEqual(["foo"]);
    myEmitter.on("bar", () => {});
    expect(myEmitter.eventNames()).toEqual(["foo", "bar"]);
    myEmitter.off("foo", () => {});
    expect(myEmitter.eventNames()).toEqual(["bar"]);
  });
});

describe("EventEmitter error handling", () => {
  test('"error" basic situation', () => {
    const myEmitter = new EventEmitter();

    let stored;
    myEmitter.on("error", (err: Error) => {
      stored = err;
    });

    myEmitter.on("start", () => {
      throw new Error("whoops!");
    });

    myEmitter.emit("start");

    expect(stored).toBeInstanceOf(Error);
  });
});

describe("EventEmitter captureRejections", () => {
  //
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
    it(`${create.toString().slice(10, 40).replaceAll("\n", "\\n").trim()} should work`, () => {
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
