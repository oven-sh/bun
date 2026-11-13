// The third file of 32-mock-cannot-come-off-a.mjs.
import assert from "node:assert";
import { test } from "node:test";
import { frozen, newer, older } from "./32-mock-cannot-come-off-shared.mjs";

test("the end of the second file does not throw the error of the first file again", () => {
  assert.deepStrictEqual([older.run(), frozen.run(), newer.run()], ["real", "mocked", "real"]);
});
