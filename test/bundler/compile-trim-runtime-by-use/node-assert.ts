// node:assert prints a diff: the native Myers diff
import assert from "node:assert";
try {
  assert.deepStrictEqual({ a: 1, b: [1, 2, 3], c: "x" }, { a: 1, b: [1, 2, 4], c: "y" });
} catch (error) {
  console.log((error as Error).message);
}
try {
  assert.strictEqual("one\ntwo\nthree\n", "one\n2\nthree\n");
} catch (error) {
  console.log((error as Error).message);
}
