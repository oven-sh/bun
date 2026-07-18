const { test, describe } = require("node:test");
const assert = require("node:assert");

const tick = () => new Promise(r => setImmediate(r));
async function until(cond) {
  for (let n = 0; n < 100 && !cond(); n++) await tick();
}

// Each subtest waits (bounded) for its sibling to have started. Under a pool
// of 2 or more both observe each other; under serial execution the first gives
// up without ever seeing the second and the assertion fails.
function interleaved(t, tag) {
  const started = [false, false];
  const body = i => async () => {
    started[i] = true;
    await until(() => started[1 - i]);
    assert.ok(started[1 - i], `${tag}: sibling never started (subtests ran serially)`);
  };
  return Promise.all([t.test(`${tag}-a`, body(0)), t.test(`${tag}-b`, body(1))]);
}

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

// `{concurrency: 2}`: subtests interleave and at most 2 run at once.
test("concurrency: 2 interleaves and caps", { concurrency: 2 }, async t => {
  await interleaved(t, "num");
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

// `true` is unbounded for a non-root test: all three children must be in
// flight at once (a cap of 2 would leave the third waiting and fail here).
test("concurrency: true is unbounded", { concurrency: true }, async t => {
  let started = 0;
  const body = async () => {
    started++;
    await until(() => started === 3);
    assert.strictEqual(started, 3, "true: not all three siblings were running");
  };
  await Promise.all([t.test("a", body), t.test("b", body), t.test("c", body)]);
});

// Node: "If unspecified, subtests inherit this value from their parent."
test("concurrency inheritance and explicit serial", { concurrency: 4 }, async t => {
  // A grandchild whose intermediate parent omits the option inherits 4.
  await t.test("inherit", ct => interleaved(ct, "inherit"));
  // An explicit value on the intermediate parent overrides it.
  await t.test("explicit-1", { concurrency: 1 }, ct => serial(ct));
  await t.test("explicit-false", { concurrency: false }, ct => serial(ct));
});

// A top-level test with no option inherits 1 from the root.
test("default concurrency is serial", t => serial(t));

// An inline describe() inside a concurrent parent: its children run as soon as
// the suite has a parent slot (not gated on every prior sibling), and honor
// the suite's own concurrency option.
test("inline suite under a concurrent parent", { concurrency: 3 }, async t => {
  const started = [false, false];
  const slow = t.test("slow", () => until(() => started[0]));
  describe("inner", { concurrency: 2 }, () => {
    const body = i => async () => {
      started[i] = true;
      await until(() => started[1 - i]);
      assert.ok(started[1 - i], "inline suite child ran serially");
    };
    test("x", body(0));
    test("y", body(1));
  });
  await slow;
  assert.ok(started[0], "inline suite child waited for an unrelated concurrent sibling");
});

// Bad values keep throwing Node's error codes.
test("concurrency validation", () => {
  assert.throws(() => test("bad", { concurrency: "x" }, () => {}), { code: "ERR_INVALID_ARG_TYPE" });
  for (const v of [-1, 0, NaN, Infinity, 1.5]) {
    assert.throws(() => test("bad", { concurrency: v }, () => {}), { code: "ERR_OUT_OF_RANGE" });
  }
});
