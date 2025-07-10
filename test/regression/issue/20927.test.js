import { expect, test } from "bun:test";

// This used to break in ASAN builds of Bun in CI due to LTO flags being passed
// to CMake. Specifically, the callback passed to `vm.deferredWorkTimer->scheduleWorkSoon(ticket, ...)`
// never gets called (see JSFinalizationRegistry.cpp in WebKit).
test("FinalizationRegistry callback should be called", async () => {
  const registry = new FinalizationRegistry(value => value(123));
  const promise = new Promise(resolve => registry.register({}, resolve));

  Bun.gc(true);
  await expect(promise).resolves.toBe(123);
});
