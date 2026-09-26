const { test } = require("node:test");

// bun:test fails the running test for an error thrown outside its promise, and
// node:test winds the innermost running test down. Nothing on the way may turn
// that failure into a pass or drop the error: the innermost test can be a todo
// or an expectFailure subtest while the error belongs to its parent, and the
// test can have called t.skip() or t.todo().

// Runs `fail` from a timer callback and settles only after it, so the error
// always arrives while the awaiting body is pending.
function pendingUntilAfter(fail) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => {
    setTimeout(resolve, 1);
    fail();
  }, 1);
  return promise;
}

test("a todo subtest is pending", async t => {
  await t.test("wip", { todo: true }, async () => {
    await pendingUntilAfter(() => {
      throw new Error("thrown while a todo subtest was pending");
    });
  });
});

test("an expectFailure subtest is pending", async t => {
  await t.test("xfail", { expectFailure: true }, async () => {
    await pendingUntilAfter(() => {
      throw new Error("thrown while an expectFailure subtest was pending");
    });
  });
});

test("after t.skip()", async t => {
  t.skip();
  await pendingUntilAfter(() => {
    throw new Error("thrown after t.skip()");
  });
});

test("after t.todo()", async t => {
  t.todo();
  await pendingUntilAfter(() => {
    throw new Error("thrown after t.todo()");
  });
});

test("expectFailure", { expectFailure: true }, async () => {
  await pendingUntilAfter(() => {
    throw new Error("thrown in an expectFailure test");
  });
});
