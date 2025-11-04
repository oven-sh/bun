// this runs with bun:test, but it's not named .test.ts because it is meant to be run in CI by bun-main.test.ts, not on its own

import { test, expect } from "bun:test";

test("Bun.main override from previous test is not visible", () => {
  // bun-main-test-fixture-1.ts overrode this value
  expect(Bun.main).toEndWith("bun-main-test-fixture-2.ts");
});
