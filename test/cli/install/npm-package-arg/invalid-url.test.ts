import { Npa } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("invalid url", () => {
  expect(() => Npa.npa("foo@gopher://goodluckwiththat")).toThrow();
});
