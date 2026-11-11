// on() emits "newListener" whenever the table of listeners holds anything but undefined under that name, as node does.
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

test.each([
  [null, "newListener:y"],
  [0, "newListener:y"],
  [false, "newListener:y"],
  [undefined, ""],
])("the table of listeners holds %p under newListener", (value, expected) => {
  const emitter = new EventEmitter();
  emitter.on("x", () => {});
  (emitter as unknown as { _events: Record<string, unknown> })._events.newListener = value;
  const seen: string[] = [];
  emitter.emit = (name, ...rest) => (seen.push(String(name) + ":" + String(rest[0])), true);
  emitter.on("y", () => {});
  expect(seen.join()).toBe(expected);
});
