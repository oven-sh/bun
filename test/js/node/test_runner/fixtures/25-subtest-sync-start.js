// Node starts a subtest's body synchronously at the t.test() call when the
// parent has a free concurrency slot (Test.start() calls run() directly). All
// assertions pass verbatim on the node v26.3.0 binary.
const assert = require("node:assert");
const { test } = require("node:test");

test("a subtest's synchronous body runs before t.test() returns", async t => {
  let x = 0;
  const p = t.test("sub", () => {
    x = 1;
  });
  assert.strictEqual(x, 1, "the subtest body must have run at the t.test() call");
  await p;
});

test("the synchronous prefix of an async subtest body runs before t.test() returns", async t => {
  let x = 0;
  const p = t.test("sub", async () => {
    x = 1;
    await 0;
    x = 2;
  });
  assert.strictEqual(x, 1);
  await p;
  assert.strictEqual(x, 2);
});

test("a second subtest in the same tick is queued behind the first", async t => {
  const order = [];
  t.test("a", async () => {
    order.push("a:start");
    await new Promise(resolve => setImmediate(resolve));
    order.push("a:end");
  });
  t.test("b", () => {
    order.push("b");
  });
  // The first subtest started inline and now occupies the single slot; the
  // second is deferred until it finishes.
  assert.deepStrictEqual(order, ["a:start"]);
  t.after(() => {
    assert.deepStrictEqual(order, ["a:start", "a:end", "b"]);
  });
});

test("awaiting a subtest frees the slot so the next one starts inline", async t => {
  const order = [];
  await t.test("a", () => {
    order.push("a");
  });
  assert.deepStrictEqual(order, ["a"]);
  t.test("b", () => {
    order.push("b");
  });
  assert.deepStrictEqual(order, ["a", "b"]);
});

test("a subtest of a subtest also starts synchronously", async t => {
  const order = [];
  const p = t.test("outer", t2 => {
    order.push("outer:start");
    t2.test("inner", () => {
      order.push("inner");
    });
    order.push("outer:end");
  });
  assert.deepStrictEqual(order, ["outer:start", "inner", "outer:end"]);
  await p;
});

test("a before hook defers the subtest body but runs its own body inline", async t => {
  const order = [];
  t.before(() => {
    order.push("before");
  });
  assert.deepStrictEqual(order, ["before"]);
  const p = t.test("sub", () => {
    order.push("sub");
  });
  assert.deepStrictEqual(order, ["before"]);
  await p;
  assert.deepStrictEqual(order, ["before", "sub"]);
});

test("a done-callback subtest body runs before t.test() returns", async t => {
  let x = 0;
  const p = t.test("sub", (_t2, done) => {
    x = 1;
    done();
  });
  assert.strictEqual(x, 1);
  await p;
});
