// Test file for done callback error conditions in node:test
const test = require("node:test");
const assert = require("node:assert");

// This test should fail: done called with an error
test("should fail when done is called with error", (t, done) => {
  setTimeout(() => {
    done(new Error("Intentional failure"));
  }, 10);
});

// This test should fail: returning promise AND using done
test("should fail when both promise and done are used", (t, done) => {
  return Promise.resolve();
});

// This test should fail: calling done multiple times
test("should fail when done is called multiple times", (t, done) => {
  done();
  setTimeout(() => {
    done(); // Second call should throw
  }, 5);
});
