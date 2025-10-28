// https://github.com/oven-sh/bun/issues/24147
// EventEmitter: this._events becomes undefined when removeAllListeners()
// called from event handler with removeListener meta-listener

import { expect, test } from "bun:test";
import { EventEmitter } from "events";

test("removeAllListeners() from event handler with removeListener meta-listener", () => {
  const emitter = new EventEmitter();

  emitter.on("test", () => {
    // This should not crash even though there are no 'foo' listeners
    emitter.removeAllListeners("foo");
  });

  // Register a removeListener meta-listener to trigger the bug
  emitter.on("removeListener", () => {});

  // This should not throw
  expect(() => emitter.emit("test")).not.toThrow();
});

test("removeAllListeners() with actual listeners to remove", () => {
  const emitter = new EventEmitter();
  let fooCallCount = 0;
  let removeListenerCallCount = 0;

  emitter.on("foo", () => fooCallCount++);
  emitter.on("foo", () => fooCallCount++);

  emitter.on("test", () => {
    // Remove all 'foo' listeners while inside an event handler
    emitter.removeAllListeners("foo");
  });

  // Track removeListener calls
  emitter.on("removeListener", () => {
    removeListenerCallCount++;
  });

  // Emit test event which triggers removeAllListeners
  emitter.emit("test");

  // Verify listeners were removed
  expect(emitter.listenerCount("foo")).toBe(0);

  // Verify removeListener was called twice (once for each foo listener)
  expect(removeListenerCallCount).toBe(2);

  // Verify foo listeners were never called
  expect(fooCallCount).toBe(0);
});

test("nested removeAllListeners() calls", () => {
  const emitter = new EventEmitter();
  const events: string[] = [];

  emitter.on("outer", () => {
    events.push("outer-start");
    emitter.removeAllListeners("inner");
    events.push("outer-end");
  });

  emitter.on("inner", () => {
    events.push("inner");
  });

  emitter.on("removeListener", type => {
    events.push(`removeListener:${String(type)}`);
  });

  // This should not crash
  expect(() => emitter.emit("outer")).not.toThrow();

  // Verify correct execution order
  expect(events).toEqual(["outer-start", "removeListener:inner", "outer-end"]);

  // Verify inner listeners were removed
  expect(emitter.listenerCount("inner")).toBe(0);
});
