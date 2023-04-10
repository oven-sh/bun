import { test, describe, expect, it } from "bun:test";
import { heapStats } from "bun:jsc";
import { expectMaxObjectTypeCount, gc } from "harness";
// this is also testing that imports with default and named imports in the same statement work
// our transpiler transform changes this to a var with import.meta.require
// import EventEmitter, { getEventListeners, captureRejectionSymbol } from "node:events";
import EventEmitter, { getEventListeners, captureRejectionSymbol } from "../../../../src/bun.js/events.exports.mjs";

describe("EventEmitter", () => {
  it("captureRejectionSymbol", () => {
    expect(EventEmitter.captureRejectionSymbol).toBeDefined();
    expect(captureRejectionSymbol).toBeDefined();
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

test("EventEmitter.on", () => {
  var myEmitter = new EventEmitter();
  expect(myEmitter.on("foo", () => {})).toBe(myEmitter);
});

test("EventEmitter.off", () => {
  var myEmitter = new EventEmitter();
  expect(myEmitter.off("foo", () => {})).toBe(myEmitter);
});

// Internally, EventEmitter has a JSC::Weak with the thisValue of the listener
test("EventEmitter GCs", async () => {
  gc();

  const startCount = heapStats().objectTypeCounts["EventEmitter"] ?? 0;
  (function () {
    function EventEmitterSubclass(this: any) {
      EventEmitter.call(this);
    }

    Object.setPrototypeOf(EventEmitterSubclass.prototype, EventEmitter.prototype);
    Object.setPrototypeOf(EventEmitterSubclass, EventEmitter);
    // @ts-ignore
    var myEmitter = new EventEmitterSubclass();
    myEmitter.on("foo", () => {});
    myEmitter.emit("foo");
  })();

  await expectMaxObjectTypeCount(expect, "EventEmitter", startCount);
});
