// The second file of 32-mock-cannot-come-off-a.mjs. The first call of node:test
// in a file ends the file before it, so that call throws the error.
import assert from "node:assert";
import { test } from "node:test";
import { frozen, newer, older } from "./32-mock-cannot-come-off-shared.mjs";

let error;
try {
  test("not registered: the end of the first file throws", () => {});
} catch (thrown) {
  error = thrown;
}

test("the end of the first file throws after it took the other mocks off", t => {
  assert.deepStrictEqual(
    {
      error: `${error?.name}: ${error?.message}`,
      older: older.run(),
      frozen: frozen.run(),
      newer: newer.run(),
      ofFirstFile: typeof t.assert.ofFirstFile,
    },
    {
      error: "TypeError: Attempting to change configurable attribute of unconfigurable property.",
      older: "real",
      frozen: "mocked",
      newer: "real",
      ofFirstFile: "undefined",
    },
  );
});
