// The file after 31-mock-again-before-restore-all-a.mjs.
import assert from "node:assert";
import { test } from "node:test";
import { service } from "./31-mock-again-before-restore-all-shared.mjs";

test("the next file gets the real method", () => {
  assert.strictEqual(service.run(), "real");
});
