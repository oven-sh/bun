import { expect, mock, test } from "bun:test";
import { foo } from "./07823.fixture";

test("mock.restore() should restore original module behavior", async () => {
  // before mock - should return "original"
  expect(foo()).toBe("original");

  // mock the module
  mock.module("./07823.fixture", () => ({
    foo: () => "mocked",
  }));

  // after mock - should return "mocked"
  expect(foo()).toBe("mocked");

  // restore mock
  mock.restore();

  // after restore, reimport to get fresh module - should return "original" again
  const restored = await import("./07823.fixture?t=" + Date.now());
  expect(restored.foo()).toBe("original");
});
