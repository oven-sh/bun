const { test } = require("node:test");
const assert = require("node:assert");

let callCount = 0;

// Sync callback-style test: invokes done() to signal completion.
test("callback test resolves with done()", (t, done) => {
  assert.equal(typeof done, "function");
  callCount++;
  done();
});

// Async-but-callback-style test: the test function returns a promise that
// resolves BEFORE done() is called. This proves the runner waits for done()
// and does not auto-complete on promise resolution: `sawDone` is only true
// once the deferred done() actually runs, and it is asserted on the next
// microtask-draining tick via a second callback test below.
let sawDone = false;
test("callback test waits for done() even when the body returns a promise", (t, done) => {
  // Returning a resolved promise must NOT complete the test; only done() may.
  return Promise.resolve().then(() => {
    setTimeout(() => {
      callCount++;
      sawDone = true;
      done();
    }, 5);
  });
});

// Runs after the previous test. If the runner had wrongly completed the
// prior test on promise-resolution (before done()), `sawDone` would still be
// false here, failing the assertion.
test("previous callback test only completed via done()", (t, done) => {
  assert.equal(sawDone, true, "async callback test completed before done() was called");
  callCount++;
  done();
});

// Existing (t) => {...} sync-style signature must keep working.
test("sync test without done() still passes", t => {
  assert.equal(typeof t.name, "string");
  callCount++;
});

// Existing async-function signature must keep working.
test("async test without done() still passes", async t => {
  await Promise.resolve();
  callCount++;
});

// Calling done() twice (or done() plus a thrown/rejected value) must not
// double-complete or double-count the test.
test("done() is idempotent", (t, done) => {
  callCount++;
  done();
  done();
});

process.on("exit", () => {
  assert.equal(callCount, 6, `expected 6 test invocations, saw ${callCount}`);
});
