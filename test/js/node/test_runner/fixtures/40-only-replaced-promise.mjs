// Passes as it is under `node --test --test-only`. A declaration that the filter drops does not call a `Promise.resolve` or a `then` that the file replaced.
import assert from "node:assert";
import { after, test } from "node:test";

let parentEnded = false;
after(() => assert.ok(parentEnded));

const { resolve } = Promise;
Promise.resolve = () => {
  throw new Error("the file replaced Promise.resolve");
};
let dropped;
try {
  dropped = test("dropped at top level", { only: false }, () => {});
} finally {
  Promise.resolve = resolve;
}
assert.strictEqual(typeof dropped.then, "function");

test.only("a filtered subtest", async t => {
  t.runOnly(true);
  const { then } = Promise.prototype;
  Promise.prototype.then = function () {
    throw new Error("the file replaced Promise.prototype.then");
  };
  let filtered;
  try {
    filtered = t.test("filtered", () => {});
  } finally {
    Promise.prototype.then = then;
  }
  await filtered;
  parentEnded = true;
});
