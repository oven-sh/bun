var assert = require("assert");

test("doesNotMatch does not throw when not matching", () => {
  assert.doesNotMatch("I will pass", /different/);
});

test("doesNotMatch throws when argument is not string", () => {
  expect(() => assert.doesNotMatch(123, /pass/)).toThrow(
    'The "string" argument must be of type string. Received type number',
  );
});

test("doesNotMatch throws when matching", () => {
  expect(() => assert.doesNotMatch("I will fail", /fail/, "doesNotMatch throws when matching")).toThrow(
    "doesNotMatch throws when matching",
  );
});
