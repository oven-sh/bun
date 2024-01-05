var assert = require("assert");

test("doesNotMatch does not throw when not matching", () => {
  assert.doesNotMatch('I will pass', /different/);
});

test("doesNotMatch throws when argument is not string", () => {
  try {
    assert.doesNotMatch(123, /pass/);
    expect.unreachable();
  } catch (e) {}
});

test("doesNotMatch throws when matching", () => {
  try {
    assert.doesNotMatch('I will fail', /fail/);
    expect.unreachable();
  } catch (e) {}
});
