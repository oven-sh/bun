// Node runs the body when the name argument is undefined/null/number/boolean/
// Symbol, naming the test from fn.name (or <anonymous>). Bun previously dropped
// the callback for any non-string/non-function/non-object name and registered a
// body-less always-passing test.
const { test, describe, it } = require("node:test");

let ran = 0;
const mark = expectedName => {
  return function named(t) {
    ran++;
    t.assert.equal(t.name, expectedName);
  };
};

// No body at all: Node names it <anonymous>, not the internal noop's name.
test({ skip: false });
test(undefined, mark("named"));
test(null, mark("named"));
test(12345, mark("named"));
test(true, mark("named"));
test(Symbol("x"), mark("named"));
test("", mark("named"));
// Three-arg form: a non-string name must not stop options/fn from being read.
test(42, { skip: false }, mark("named"));
test(null, null, mark("named"));

describe(42, () => {
  it("child of numeric describe", t => {
    ran++;
    t.assert.equal(t.name, "child of numeric describe");
  });
});

test("all bodies ran", t => {
  t.assert.equal(ran, 9);
});
