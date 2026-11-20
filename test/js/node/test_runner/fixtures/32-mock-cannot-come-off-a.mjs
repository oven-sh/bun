// node-test.test.ts runs this file, then 32-mock-cannot-come-off-b.mjs and
// -c.mjs, in one `bun test` process. This file leaves three mocks and freezes
// the object of the second one, so the end of the file cannot put that method
// back. The other two mocks must still come off, and the error must not
// come again at the end of every later file.
import assert from "node:assert";
import { mock, test, assert as testAssert } from "node:test";
import { frozen, newer, older } from "./32-mock-cannot-come-off-shared.mjs";

testAssert.register("ofFirstFile", () => {});

test("leaves three mocks, and freezes the object of the second", t => {
  assert.strictEqual(typeof t.assert.ofFirstFile, "function");
  mock.method(older, "run", () => "mocked");
  mock.method(frozen, "run", () => "mocked");
  mock.method(newer, "run", () => "mocked");
  Object.freeze(frozen);
  assert.deepStrictEqual([older.run(), frozen.run(), newer.run()], ["mocked", "mocked", "mocked"]);
});
