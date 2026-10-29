// For `bun test --concurrent`. Every test but the last causes an uncaught error from something
// its body started, and ends a macrotask after the error.
const { describe, it, test } = require("node:test");

const later = resolve => setTimeout(resolve, 0);
const fired = [];

function uncaught(name, start) {
  const { promise, resolve: didFire } = Promise.withResolvers();
  fired.push(promise);
  return () =>
    new Promise(end => {
      start(() => {
        didFire();
        later(end);
      }, new Error(name));
    });
}

const fromATimer = (fail, error) =>
  setTimeout(() => {
    fail();
    throw error;
  }, 0);

const fromAPromise = (fail, error) => {
  fail();
  Promise.reject(error);
};

test("test() throws from a timer", uncaught("test() timer", fromATimer));
test("test() leaves a rejected promise", uncaught("test() promise", fromAPromise));

describe("suite", () => {
  it("it() throws from a timer", uncaught("it() timer", fromATimer));
  it("it() leaves a rejected promise", uncaught("it() promise", fromAPromise));
});

test("passes", async () => {
  await Promise.all(fired);
  await new Promise(later);
});
