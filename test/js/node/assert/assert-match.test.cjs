var assert = require("assert");

test("match does not throw when matching", () => {
  assert.match("I will pass", /pass/);
});

test("match throws when argument is not string", () => {
  expect(() => assert.match(123, /pass/)).toThrow('The "actual" argument must be of type string. Received type number');
});

test("match throws when not matching", () => {
  expect(() => assert.match("I will fail", /pass/, "match throws when not matching")).toThrow(
    "match throws when not matching",
  );
});
