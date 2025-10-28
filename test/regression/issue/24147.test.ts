import assert from "node:assert";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";

describe("EventEmitter - issue 24147", () => {
  test("removeAllListeners() called from event handler with removeListener meta-listener should not crash", () => {
    const emitter = new EventEmitter();

    emitter.on("test", () => {
      emitter.removeAllListeners("foo");
    });

    emitter.on("removeListener", () => {});

    // Should not throw TypeError: undefined is not an object
    assert.doesNotThrow(() => {
      emitter.emit("test");
    });
  });

  test("removeAllListeners() should work correctly with removeListener meta-listener", () => {
    const emitter = new EventEmitter();
    let testCalled = false;

    emitter.on("test", () => {
      testCalled = true;
      emitter.removeAllListeners("foo");
    });

    emitter.on("removeListener", () => {});

    emitter.on("foo", () => {});

    emitter.emit("test");

    assert.strictEqual(testCalled, true);
    assert.strictEqual(emitter.listenerCount("foo"), 0);
  });

  test("_events should remain intact after removeAllListeners in nested call", () => {
    const emitter = new EventEmitter();

    emitter.on("test", () => {
      emitter.removeAllListeners("foo");
      // _events should still be accessible
      assert.ok(emitter.eventNames());
    });

    emitter.on("removeListener", () => {});

    emitter.emit("test");

    // Should still be able to add listeners after
    emitter.on("bar", () => {});
    assert.strictEqual(emitter.listenerCount("bar"), 1);
  });

  test("removeAllListeners() without event name should work with removeListener meta-listener", () => {
    const emitter = new EventEmitter();

    emitter.on("test", () => {
      emitter.removeAllListeners(); // Remove ALL listeners
    });

    emitter.on("removeListener", () => {});

    emitter.on("foo", () => {});
    emitter.on("bar", () => {});

    assert.doesNotThrow(() => {
      emitter.emit("test");
    });

    // All listeners should be removed (including removeListener)
    assert.deepStrictEqual(emitter.eventNames(), []);
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

    assert.doesNotThrow(() => {
      emitter.emit("test");
    });

    assert.strictEqual(emitter.listenerCount("foo"), 0);
    assert.strictEqual(emitter.listenerCount("bar"), 0);
    assert.strictEqual(emitter.listenerCount("baz"), 0);
  });
});
