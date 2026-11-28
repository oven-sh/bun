// The third file of 30-mocks-left-at-file-end-a.mjs.
import assert from "node:assert";
import { test } from "node:test";
import { expected, read } from "./30-mocks-left-at-file-end-shared.mjs";

test("the third file gets no mock of the first file", () => {
  assert.deepStrictEqual(read(), expected);
});
