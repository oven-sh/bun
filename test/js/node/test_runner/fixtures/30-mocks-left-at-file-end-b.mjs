// The second file of 30-mocks-left-at-file-end-a.mjs.
import assert from "node:assert";
import { test } from "node:test";
import { expected, read, wrappedByNextFile } from "./30-mocks-left-at-file-end-shared.mjs";

// A module that wraps a method when it loads does this. It is before this
// file's first call of node:test, and that call ends the mocks of the first
// file. The mock of the first file must not stay inside the wrapper.
const runAtLoad = wrappedByNextFile.run;
wrappedByNextFile.run = function (...args) {
  return runAtLoad.apply(this, args);
};

test("the second file gets no mock of the first file", () => {
  assert.deepStrictEqual(read(), expected);
});
