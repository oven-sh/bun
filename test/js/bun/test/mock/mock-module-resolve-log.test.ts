import { expect, mock, test } from "bun:test";

// Regression test: mock.module() with a non-existent specifier must not crash
// when module resolution triggers auto-install and the package manager uses
// a stale log pointer from the resolver's stack frame.
test("mock.module with non-existent specifier does not crash", async () => {
  mock.module("this-package-does-not-exist-abcdef123", () => ({ a: 1 }));
  const mod = await import("this-package-does-not-exist-abcdef123");
  expect(mod.a).toBe(1);
});
