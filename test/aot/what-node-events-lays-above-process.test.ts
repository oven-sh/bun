import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";

// The compiler takes a read of such a name off `process` for a look at what stands above it. The table of built-ins lists them: b.inheritsFromUnknown() in src/codegen/builtins/host/process.builtins.ts.
test("_eventsCount is the one name that process has from node:events alone", () => {
  const native = Object.getPrototypeOf(process);
  expect(Object.getPrototypeOf(native)).toBe(EventEmitter.prototype);
  const found = Object.getOwnPropertyNames(EventEmitter.prototype);
  expect(found.filter(name => !Object.hasOwn(native, name) && !Object.hasOwn(process, name))).toEqual(["_eventsCount"]);
});
