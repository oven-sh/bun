import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

// Packages hold `emitter._events` and read it later. While other events are left, removing one deletes its key from
// that same object, as in Node.
function listen(names: (string | symbol | number)[]) {
  const emitter = new EventEmitter();
  const listeners = new Map<string | symbol | number, () => void>();
  for (const name of names) {
    const listener = () => {};
    listeners.set(name, listener);
    emitter.on(name as string, listener);
  }
  return { emitter, listeners, events: (emitter as any)._events as Record<PropertyKey, unknown> };
}

const tag = Symbol("tag");

test.each([
  ["a string", "first"],
  ["a symbol", tag],
  ["a number", 7],
] as const)("removeListener deletes %s from the object that _events was", (_, removed) => {
  const { emitter, listeners, events } = listen(["first", tag, 7, "last"]);
  emitter.removeListener(removed as string, listeners.get(removed)!);
  expect((emitter as any)._events).toBe(events);
  expect(removed in events).toBe(false);
  expect(Reflect.ownKeys(events)).toHaveLength(3);
  expect(emitter.eventNames()).toHaveLength(3);
});

test("off and removeAllListeners(type) keep the object too", () => {
  const { emitter, listeners, events } = listen(["first", "second", "third"]);
  emitter.off("second", listeners.get("second")!);
  expect((emitter as any)._events).toBe(events);
  expect(Object.keys(events)).toEqual(["first", "third"]);
  emitter.removeAllListeners("first");
  expect((emitter as any)._events).toBe(events);
  expect(Object.keys(events)).toEqual(["third"]);
});

test("the object stays the same where removeListener is listened for", () => {
  const { emitter, listeners, events } = listen(["first", "second"]);
  const seen: unknown[] = [];
  emitter.on("removeListener", name => seen.push(name, "first" in events, (emitter as any)._events === events));
  emitter.removeListener("first", listeners.get("first")!);
  expect(seen).toEqual(["first", false, true]);
  emitter.removeAllListeners("second");
  expect(seen).toEqual(["first", false, true, "second", false, true]);
  expect(Object.keys(events)).toEqual(["removeListener"]);
});

test("a listener added after a removal is seen through the object that was held", () => {
  const { emitter, listeners, events } = listen(["first", "second"]);
  emitter.removeListener("first", listeners.get("first")!);
  const later = () => {};
  emitter.on("later", later);
  expect(events.later).toBe(later);
  emitter.once("first", later);
  expect(Object.keys(events)).toEqual(["second", "later", "first"]);
});

test("many events", () => {
  const names = Array.from({ length: 24 }, (_, index) => "event" + index);
  const { emitter, listeners, events } = listen(names);
  for (const name of names.slice(0, 23)) {
    emitter.removeListener(name, listeners.get(name)!);
    expect((emitter as any)._events).toBe(events);
    expect(name in events).toBe(false);
  }
  expect(Object.keys(events)).toEqual(["event23"]);
});
