import { expect, test } from "bun:test";

test("regression", () => {
  expect(() => require("./013880-fixture.cjs")).not.toThrow();
});
