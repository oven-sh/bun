const { test, describe } = require("node:test");
const assert = require("node:assert");

const tick = () => new Promise(r => setImmediate(r));

// Each subtest waits (bounded) for its sibling to have started. Under a pool
// of 2 or more both observe each other; under serial execution the first gives
// up without ever seeing the second and the assertion fails.
function interleaved(t, tag) {
  const started = [false, false];
  const body = i => async () => {
    started[i] = true;
    for (let n = 0; n < 200 && !started[1 - i]; n++) await tick();
    assert.ok(started[1 - i], `${tag}: sibling never started (subtests ran serially)`);
  };
  return Promise.all([t.test(`${tag}-a`, body(0)), t.test(`${tag}-b`, body(1))]);
}

test("parent with concurrency: 2 interleaves subtests", { concurrency: 2 }, async t => {
  await interleaved(t, "num");
});

// `true` is unbounded for a non-root test: three children must all be in
// flight at once (a cap of 2 would leave the third waiting and fail here).
test("parent with concurrency: true runs every subtest at once", { concurrency: true }, async t => {
  let started = 0;
  const body = async () => {
    started++;
    for (let n = 0; n < 200 && started < 3; n++) await tick();
    assert.strictEqual(started, 3, "true: not all three siblings were running");
  };
  await Promise.all([t.test("a", body), t.test("b", body), t.test("c", body)]);
});

test("concurrency caps the number of subtests running at once", { concurrency: 2 }, async t => {
  let active = 0;
  let max = 0;
  const body = async () => {
    active++;
    if (active > max) max = active;
    await tick();
    await tick();
    active--;
  };
  await Promise.all([t.test("a", body), t.test("b", body), t.test("c", body), t.test("d", body), t.test("e", body)]);
  assert.strictEqual(max, 2);
});

// A subtest's second body must not start before the first has finished.
function serial(t) {
  let aDone = false;
  const a = t.test("a", async () => {
    await tick();
    aDone = true;
  });
  const b = t.test("b", () => assert.strictEqual(aDone, true));
  return Promise.all([a, b]);
}

test("default concurrency is serial", t => serial(t));
test("concurrency: false is serial", { concurrency: false }, t => serial(t));

// Node: "If unspecified, subtests inherit this value from their parent." A
// grandchild whose intermediate parent omits the option must inherit 4.
test("unspecified concurrency inherits from the parent", { concurrency: 4 }, async t => {
  await t.test("mid", ct => interleaved(ct, "inherit"));
  // An explicit value on the intermediate parent overrides the inherited one.
  await t.test("mid-serial", { concurrency: 1 }, ct => serial(ct));
});

// An inline describe() inside a running test honors its own concurrency option.
test("inline suite with concurrency interleaves its children", async t => {
  const started = [false, false];
  describe("inner", { concurrency: 2 }, () => {
    const body = i => async () => {
      started[i] = true;
      for (let n = 0; n < 200 && !started[1 - i]; n++) await tick();
      assert.ok(started[1 - i], "inline suite child ran serially");
    };
    test("x", body(0));
    test("y", body(1));
  });
  t.after(() => assert.deepStrictEqual(started, [true, true]));
});

// An inline suite inside a concurrent parent runs its children once it has a
// parent slot; it is not gated on every prior sibling of the parent settling.
test("inline suite is not gated on the parent's prior concurrent siblings", { concurrency: 3 }, async t => {
  let suiteChildRan = false;
  const releaseSlow = Promise.withResolvers();
  const slow = t.test("slow", () => releaseSlow.promise);
  describe("inner", () => {
    test("x", () => {
      suiteChildRan = true;
      releaseSlow.resolve();
    });
  });
  await slow;
  assert.ok(suiteChildRan, "inline suite child waited for an unrelated concurrent sibling");
});

// Bad values keep throwing Node's error codes.
test("concurrency validation", () => {
  assert.throws(() => test("bad", { concurrency: "x" }, () => {}), { code: "ERR_INVALID_ARG_TYPE" });
  for (const v of [-1, 0, NaN, Infinity, 1.5]) {
    assert.throws(() => test("bad", { concurrency: v }, () => {}), { code: "ERR_OUT_OF_RANGE" });
  }
});
