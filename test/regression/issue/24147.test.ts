import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

describe("EventEmitter - issue 24147", () => {
  test("removeAllListeners() called from event handler with removeListener meta-listener should not crash", () => {
    const emitter = new EventEmitter();

    emitter.on("test", () => {
      emitter.removeAllListeners("foo");
    });

    emitter.on("removeListener", () => {});

    // Should not throw TypeError: undefined is not an object
    expect(() => {
      emitter.emit("test");
    }).not.toThrow();
  });

  test("removeAllListeners() should work correctly with removeListener meta-listener", () => {
    const emitter = new EventEmitter();
    let testCalled = false;
    let removeListenerCalled = false;

    emitter.on("test", () => {
      testCalled = true;
      emitter.removeAllListeners("foo");
    });

    emitter.on("removeListener", () => {
      removeListenerCalled = true;
    });

    emitter.on("foo", () => {});

    emitter.emit("test");

    expect(testCalled).toBe(true);
    expect(emitter.listenerCount("foo")).toBe(0);
  });

  test("_events should remain intact after removeAllListeners in nested call", () => {
    const emitter = new EventEmitter();

    emitter.on("test", () => {
      emitter.removeAllListeners("foo");
      // _events should still be accessible
      expect(emitter.eventNames()).toBeDefined();
    });

    emitter.on("removeListener", () => {});

    emitter.emit("test");

    // Should still be able to add listeners after
    emitter.on("bar", () => {});
    expect(emitter.listenerCount("bar")).toBe(1);
  });

  test("removeAllListeners() without event name should work with removeListener meta-listener", () => {
    const emitter = new EventEmitter();

    emitter.on("test", () => {
      emitter.removeAllListeners(); // Remove ALL listeners
    });

    emitter.on("removeListener", () => {});

    emitter.on("foo", () => {});
    emitter.on("bar", () => {});

    expect(() => {
      emitter.emit("test");
    }).not.toThrow();

    // All listeners except removeListener should be removed
    expect(emitter.eventNames()).toEqual(["removeListener"]);
  });

  test("multiple nested removeAllListeners calls should work", () => {
    const emitter = new EventEmitter();

    emitter.on("test", () => {
      emitter.removeAllListeners("foo");
      emitter.removeAllListeners("bar");
      emitter.removeAllListeners("baz");
    });

    emitter.on("removeListener", () => {});

    emitter.on("foo", () => {});
    emitter.on("bar", () => {});
    emitter.on("baz", () => {});

    expect(() => {
      emitter.emit("test");
    }).not.toThrow();

    expect(emitter.listenerCount("foo")).toBe(0);
    expect(emitter.listenerCount("bar")).toBe(0);
    expect(emitter.listenerCount("baz")).toBe(0);
  });
});
