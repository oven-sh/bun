const { test, before } = require("node:test");

before((t, done) => {
  setTimeout(() => done(new Error("boom from before done")), 5);
});

test("should not run because the before hook failed", () => {});
