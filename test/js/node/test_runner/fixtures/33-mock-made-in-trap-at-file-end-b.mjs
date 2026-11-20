// The second file of 33-mock-made-in-trap-at-file-end-a.mjs.
import assert from "node:assert";
import { test } from "node:test";
import { proxied, state } from "./33-mock-made-in-trap-at-file-end-shared.mjs";

test("the end of the file before made one mock, and ended", () => {
  assert.deepStrictEqual([state.made, proxied.run()], [1, "made in trap 1"]);
});
