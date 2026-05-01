// A fixture that tests that Jest globals are injected into the global scope
// even when the file is NOT the entrypoint of the test.

test.each([
  ["expect", expect],
  ["test", test],
  ["describe", describe],
  ["it", it],
  ["beforeEach", beforeEach],
  ["afterEach", afterEach],
  ["beforeAll", beforeAll],
  ["afterAll", afterAll],
  ["jest", jest],
])("that %s is defined", (_, global) => {
  expect(global).toBeDefined();
});

expect.extend({
  toBeOne(actual) {
    return {
      pass: actual === 1,
      message: () => `expected ${actual} to be 1`,
    };
  },
});
