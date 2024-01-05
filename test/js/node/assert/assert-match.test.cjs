var assert = require("assert");

test("match does not throw when matching", () => {
  assert.match('I will pass', /pass/);
});

test("match throws when argument is not string", () => {
  try {
    assert.match(123, /pass/);
    expect.unreachable();
  } catch (e) {}
});

test("match throws when not matching", () => {
  try {
    assert.match('I will fail', /pass/);
    expect.unreachable();
  } catch (e) {}
});
