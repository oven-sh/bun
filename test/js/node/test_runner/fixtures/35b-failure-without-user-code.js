const test = require("node:test");
const assert = require("node:assert");

// The runner makes the error of a failed test without a call to user code.
test("a failure does not call Error.prepareStackTrace", async t => {
  const previous = Error.prepareStackTrace;
  let calls = 0;
  let afterRan = false;
  let seen;
  t.afterEach(ctx => {
    Error.prepareStackTrace = previous;
    seen = ctx.error;
  });
  const thrown = { thrown: "by the test" };
  await t.test("fails", { todo: true }, st => {
    st.after(() => {
      afterRan = true;
    });
    Error.prepareStackTrace = () => {
      calls++;
      throw new Error("from prepareStackTrace");
    };
    throw thrown;
  });
  assert.strictEqual(calls, 0);
  assert.strictEqual(afterRan, true);
  assert.strictEqual(seen.cause, thrown);
});

test("a failure does not call a patched Object.defineProperty", async t => {
  const original = Object.defineProperty;
  let calls = 0;
  let seen;
  t.afterEach(ctx => {
    Object.defineProperty = original;
    seen = ctx.error;
  });
  const thrown = new Error("thrown by the test");
  await t.test("fails", { todo: true }, () => {
    Object.defineProperty = () => {
      calls++;
      throw new Error("from the patched Object.defineProperty");
    };
    throw thrown;
  });
  assert.strictEqual(calls, 0);
  assert.strictEqual(seen.cause, thrown);
});
