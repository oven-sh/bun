import { npa } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("invalid url", () => {
  expect(() => npa("foo@gopher://goodluckwiththat")).toThrow();
});
