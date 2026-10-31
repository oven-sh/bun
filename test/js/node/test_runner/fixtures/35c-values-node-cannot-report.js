const test = require("node:test");
const assert = require("node:assert");

// bun only: values that Node's runner cannot report. Node marks the reason of an abort with a failure type, which
// throws a TypeError inside Node for a frozen reason and for a reason that is not an object. A thrown symbol ends
// Node's run() without a report.
function outcomes(t) {
  const seen = new Map();
  t.afterEach(ctx => {
    seen.set(ctx.name, { passed: ctx.passed, error: ctx.error });
  });
  return seen;
}

test("a thrown symbol is the cause of the error", async t => {
  const seen = outcomes(t);
  const symbol = Symbol("a symbol");
  await t.test("throws a symbol", { todo: true }, () => {
    throw symbol;
  });
  assert.strictEqual(seen.get("throws a symbol").error.message, "Symbol(a symbol)");
  assert.strictEqual(seen.get("throws a symbol").error.cause, symbol);
});

test("a frozen reason of an abort stays as it is, and a primitive reason is the cause of the error", async t => {
  const seen = outcomes(t);
  const frozen = Object.freeze(new Error("a frozen reason"));
  for (const [name, reason] of [
    ["frozen", frozen],
    ["string", "a string reason"],
  ]) {
    await t.test(name, { todo: true }, async st => {
      const controller = new AbortController();
      st.before(
        async () => {
          controller.abort(reason);
          await new Promise(resolve => setImmediate(resolve));
        },
        { signal: controller.signal },
      );
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    });
  }
  assert.strictEqual(seen.get("frozen").passed, false);
  assert.strictEqual(seen.get("frozen").error, frozen);
  assert.strictEqual(seen.get("string").passed, false);
  assert.strictEqual(seen.get("string").error.code, "ERR_TEST_FAILURE");
  assert.strictEqual(seen.get("string").error.cause, "a string reason");
});
