import { spyOn, test } from "bun:test";

// The spies are laid before anything loads the library's safe collections, which copy what Set.prototype and Map.prototype hold under each key.
test("a safe set and a safe map step through what each key held when they were made", () => {
  const spies = {
    "Set.prototype[Symbol.iterator]": spyOn(Set.prototype, Symbol.iterator),
    "Set.prototype.keys": spyOn(Set.prototype, "keys"),
    "Set.prototype.values": spyOn(Set.prototype, "values"),
  };
  const { Readable, Writable } = require("node:stream");
  const source = new Readable({ read() {} });
  source.pipe(new Writable({ write() {} }));
  source.pipe(new Writable({ write() {} }));
  const writers = source._readableState.awaitDrainWriters;
  const steps = {
    "for of": () => {
      for (const _ of writers);
    },
    "keys()": () => [...writers.keys()],
    "values()": () => [...writers.values()],
  };
  for (const [step, take] of Object.entries(steps)) {
    const before = Object.values(spies).map(spy => spy.mock.calls.length);
    take();
    const called = Object.keys(spies).filter((name, index) => spies[name].mock.calls.length > before[index]);
    console.log(`${step}: ${called.join(", ") || "none of the three"}`);
  }
  for (const spy of Object.values(spies)) spy.mockRestore();
});
