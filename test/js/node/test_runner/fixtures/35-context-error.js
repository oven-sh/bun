const test = require("node:test");
const assert = require("node:assert");

// context.error is an ERR_TEST_FAILURE error. The value that the test threw is
// its `cause`. Each failing subtest is `todo`, so that it does not fail its
// parent, and an afterEach hook of the parent reads its outcome.
function outcomes(t) {
  const seen = new Map();
  t.afterEach(ctx => {
    seen.set(ctx.name, { passed: ctx.passed, error: ctx.error });
  });
  return seen;
}

const todo = { todo: true };

test("a passing test has no error", async t => {
  const seen = outcomes(t);
  await t.test("passes", () => {});
  assert.deepStrictEqual(seen.get("passes"), { passed: true, error: null });
});

test("the thrown value is the cause of the error", async t => {
  const seen = outcomes(t);
  const boom = new Error("boom");
  const inner = new Error("inner");
  const outer = new Error("outer", { cause: inner });
  const object = { a: 1 };
  await t.test("throws an error", todo, () => {
    throw boom;
  });
  await t.test("rejects", todo, async () => {
    throw boom;
  });
  await t.test("calls back with an error", todo, (_, done) => {
    done(boom);
  });
  await t.test("throws an error that has a cause", todo, () => {
    throw outer;
  });
  await t.test("throws a string", todo, () => {
    throw "a string";
  });
  await t.test("throws an object", todo, () => {
    throw object;
  });
  await t.test("throws undefined", todo, () => {
    throw undefined;
  });
  await t.test("throws an object that cannot print itself", todo, () => {
    throw {
      [Symbol.for("nodejs.util.inspect.custom")]() {
        throw new Error("from the custom inspect function");
      },
    };
  });

  for (const name of ["throws an error", "rejects", "calls back with an error"]) {
    const { passed, error } = seen.get(name);
    assert.strictEqual(passed, false, name);
    assert.strictEqual(error.code, "ERR_TEST_FAILURE", name);
    assert.strictEqual(error.failureType, "testCodeFailure", name);
    assert.strictEqual(error.message, "boom", name);
    assert.strictEqual(error.cause, boom, name);
  }
  assert.strictEqual(seen.get("throws an error that has a cause").error.cause, outer);
  assert.strictEqual(seen.get("throws an error that has a cause").error.cause.cause, inner);
  assert.strictEqual(seen.get("throws a string").error.message, "a string");
  assert.strictEqual(seen.get("throws a string").error.cause, "a string");
  assert.strictEqual(seen.get("throws an object").error.message, "{ a: 1 }");
  assert.strictEqual(seen.get("throws an object").error.cause, object);
  assert.strictEqual(seen.get("throws undefined").error.message, "undefined");
  assert.strictEqual(seen.get("throws undefined").error.cause, undefined);
  assert.strictEqual(seen.get("throws undefined").error.failureType, "testCodeFailure");
  assert.match(seen.get("throws an object that cannot print itself").error.message, /Symbol\(nodejs\.util\.inspect\.custom\)/);
});

test("the error has the shape of Node's ERR_TEST_FAILURE", async t => {
  const seen = outcomes(t);
  await t.test("throws", todo, () => {
    throw new Error("boom");
  });
  const { error } = seen.get("throws");
  assert.ok(error instanceof Error);
  assert.strictEqual(error.constructor, Error);
  assert.strictEqual(error.name, "Error");
  assert.strictEqual(String(error), "Error [ERR_TEST_FAILURE]: boom");
  assert.deepStrictEqual(Object.keys(error), ["code", "failureType", "cause"]);
  assert.ok(error.stack.startsWith("Error [ERR_TEST_FAILURE]: boom"));
});

test("a failure that the runner makes has its message as the cause", async t => {
  const seen = outcomes(t);
  await t.test("plan mismatch", todo, st => {
    st.plan(2);
  });
  await t.test("plan twice", todo, st => {
    st.plan(1);
    st.plan(1);
  });
  await t.test("timeout", { todo: true, timeout: 5 }, () => new Promise(() => {}));
  await t.test("callback twice", todo, (_, done) => {
    done();
    done();
  });
  await t.test("callback and promise", todo, async (_, done) => {
    done();
  });
  await t.test("plan timeout", todo, st => {
    st.plan(1, { wait: 5 });
  });

  const expected = {
    "plan mismatch": ["testCodeFailure", "plan expected 2 assertions but received 0"],
    "plan twice": ["testCodeFailure", "cannot set plan more than once"],
    "timeout": ["testTimeoutFailure", "test timed out after 5ms"],
    "callback twice": ["multipleCallbackInvocations", "callback invoked multiple times"],
    "callback and promise": ["callbackAndPromisePresent", "passed a callback but also returned a Promise"],
    "plan timeout": ["testTimeoutFailure", "plan timed out after 5ms with 0 assertions when expecting 1"],
  };
  for (const [name, [failureType, message]] of Object.entries(expected)) {
    const { passed, error } = seen.get(name);
    assert.strictEqual(passed, false, name);
    assert.strictEqual(error.code, "ERR_TEST_FAILURE", name);
    assert.strictEqual(error.failureType, failureType, name);
    assert.strictEqual(error.message, message, name);
    assert.strictEqual(error.cause, message, name);
  }
  // The runner throws these two into the test. The stack has the frame of the call.
  assert.ok(seen.get("plan twice").error.stack.includes(__filename));
  assert.ok(seen.get("callback twice").error.stack.includes(__filename));
});

test("a hook failure is a hookFailed error, and its cause is the thrown value", async t => {
  const seen = outcomes(t);
  const fromBeforeEach = new Error("from beforeEach");
  t.beforeEach(ctx => {
    if (ctx.name === "beforeEach throws") throw fromBeforeEach;
  });
  await t.test("beforeEach throws", todo, () => {});
  const { passed, error } = seen.get("beforeEach throws");
  assert.strictEqual(passed, false);
  assert.strictEqual(error.code, "ERR_TEST_FAILURE");
  assert.strictEqual(error.failureType, "hookFailed");
  assert.strictEqual(error.message, "failed running beforeEach hook");
  assert.strictEqual(error.cause, fromBeforeEach);
});

test("a hook that times out is hookFailed, and its cause is the message of the timeout", async t => {
  const seen = outcomes(t);
  t.beforeEach(() => new Promise(() => {}), { timeout: 5 });
  await t.test("child", todo, () => {});
  const { passed, error } = seen.get("child");
  assert.strictEqual(passed, false);
  assert.strictEqual(error.failureType, "hookFailed");
  assert.strictEqual(error.message, "failed running beforeEach hook");
  assert.strictEqual(error.cause, "test timed out after 5ms");
});

test("a failed after hook is hookFailed", async t => {
  const fromAfter = new Error("from after");
  let ctx;
  await t.test("after throws", todo, st => {
    ctx = st;
    st.after(() => {
      throw fromAfter;
    });
  });
  assert.strictEqual(ctx.passed, false);
  assert.strictEqual(ctx.error.code, "ERR_TEST_FAILURE");
  assert.strictEqual(ctx.error.failureType, "hookFailed");
  assert.strictEqual(ctx.error.message, "failed running after hook");
  assert.strictEqual(ctx.error.cause, fromAfter);
});

test("a before hook that a running test creates fails that test with what the hook threw", async t => {
  const seen = outcomes(t);
  const fromBefore = new Error("from before");
  const reason = new Error("the reason of the abort");
  // Each body waits, so that the hook ends before the test does.
  await t.test("throws", todo, async st => {
    st.before(() => {
      throw fromBefore;
    });
    await new Promise(resolve => setImmediate(resolve));
  });
  await t.test("aborts", todo, async st => {
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
  const thrown = seen.get("throws");
  assert.strictEqual(thrown.passed, false);
  assert.strictEqual(thrown.error.failureType, "testCodeFailure");
  assert.strictEqual(thrown.error.message, "from before");
  assert.strictEqual(thrown.error.cause, fromBefore);
  // Node stores the reason of an abort as it is.
  assert.strictEqual(seen.get("aborts").passed, false);
  assert.strictEqual(seen.get("aborts").error, reason);
});

test("expectFailure", async t => {
  const seen = outcomes(t);
  const boom = new Error("boom");
  await t.test("fails as expected", { expectFailure: true }, () => {
    throw boom;
  });
  await t.test("passes", { expectFailure: true, todo: true }, () => {});
  await t.test("fails with another error", { expectFailure: /nope/, todo: true }, () => {
    throw boom;
  });

  assert.strictEqual(seen.get("fails as expected").passed, true);
  assert.strictEqual(seen.get("fails as expected").error.cause, boom);
  assert.strictEqual(seen.get("passes").passed, false);
  assert.strictEqual(seen.get("passes").error.failureType, "expectedFailure");
  assert.strictEqual(seen.get("passes").error.message, "test was expected to fail but passed");
  const mismatch = seen.get("fails with another error");
  assert.strictEqual(mismatch.passed, false);
  assert.strictEqual(mismatch.error.failureType, "testCodeFailure");
  assert.strictEqual(mismatch.error.message, "The test failed, but the error did not match the expected validation");
  assert.strictEqual(mismatch.error.cause.code, "ERR_ASSERTION");
});

test("the first failure stays", async t => {
  const fromBody = new Error("from the body");
  let seen;
  await t.test("body and after hook throw", todo, st => {
    st.after(() => {
      seen = st.error;
      throw new Error("from the after hook");
    });
    throw fromBody;
  });
  assert.strictEqual(seen.cause, fromBody);
});
