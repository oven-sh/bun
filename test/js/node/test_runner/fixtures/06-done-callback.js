// Test file for done callback functionality in node:test
const test = require("node:test");
const assert = require("node:assert");

// Basic done callback test
test("should support done callback", (t, done) => {
  setTimeout(() => {
    assert.ok(true);
    done();
  }, 10);
});

// Done callback with error
test("should support done callback with error", (t, done) => {
  setTimeout(() => {
    try {
      assert.strictEqual(1, 1);
      done();
    } catch (err) {
      done(err);
    }
  }, 10);
});

// Done callback without error - should pass
test("should handle done without error", (t, done) => {
  setTimeout(() => {
    done(); // No error = test passes
  }, 10);
});

// Hook with done callback
test.before(done => {
  setTimeout(() => {
    done();
  }, 5);
});

test.after(done => {
  setTimeout(() => {
    done();
  }, 5);
});

test.beforeEach(done => {
  setTimeout(() => {
    done();
  }, 5);
});

test.afterEach(done => {
  setTimeout(() => {
    done();
  }, 5);
});

// Regular test without done callback (should still work)
test("should support regular async test with promise", async t => {
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(true);
});

// Regular test without done callback (synchronous)
test("should support regular sync test", t => {
  assert.ok(true);
});

// Multiple async operations with done
test("should handle multiple async operations", (t, done) => {
  let count = 0;
  setTimeout(() => {
    count++;
    if (count === 1) {
      assert.strictEqual(count, 1);
      done();
    }
  }, 10);
});
