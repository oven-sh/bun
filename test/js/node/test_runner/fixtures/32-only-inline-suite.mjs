// Passes as it is under `node --test --test-only`. Bun does not apply `only` to a suite that a running test declares.
import assert from "node:assert";
import { after, describe, test } from "node:test";

const seen = [];
after(() => assert.deepStrictEqual(seen, ["RAN inline suite > marker"]));

test.only("a suite declared inside a running test", async () => {
  await describe("inline suite", () => {
    test("declared before the marker", () => seen.push("RAN inline suite > declared before the marker"));
    test.only("marker", () => seen.push("RAN inline suite > marker"));
  });
  await describe("inline suite after a marker", () => {
    test("never", () => seen.push("RAN inline suite after a marker > never"));
  });
  await test("after the inline suites", () => seen.push("RAN after the inline suites"));
});
