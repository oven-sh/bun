// Passes as it is under `node --test --test-only`. A declaration under the flag does not use a `Promise.resolve`, a `then` or an `Object.prototype` property that the file set.
import assert from "node:assert";
import { after, test } from "node:test";

let parentEnded = false;
let ranWithPrototypeProperty = false;
after(() =>
  assert.deepStrictEqual(
    { parentEnded, ranWithPrototypeProperty },
    { parentEnded: true, ranWithPrototypeProperty: true },
  ),
);

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

// The options of a `.only` declaration have no prototype, so `skip` is not read from Object.prototype.
Object.prototype.skip = true;
try {
  test.only("declared while Object.prototype has a skip property", () => {
    ranWithPrototypeProperty = true;
  });
} finally {
  delete Object.prototype.skip;
}
