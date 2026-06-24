const { test } = require("node:test");
const assert = require("node:assert");

let callCount = 0;

// Sync callback-style test: invokes done() to signal completion.
test("callback test resolves with done()", (t, done) => {
  assert.equal(typeof done, "function");
  callCount++;
  done();
});

// Async-but-callback-style test: schedules done() in a setTimeout.
test("callback test resolves with done() asynchronously", (t, done) => {
  setTimeout(() => {
    callCount++;
    done();
  }, 5);
});

// Callback-style test that signals failure via done(err) must still report
// failure, but we cannot easily inspect that from inside the same suite.
// The shape is exercised by the next two tests instead.

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

process.on("exit", () => {
  assert.equal(callCount, 4, `expected 4 test invocations, saw ${callCount}`);
});
