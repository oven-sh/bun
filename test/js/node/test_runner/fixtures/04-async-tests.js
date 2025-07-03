const { describe, test, after } = require("node:test");
const assert = require("node:assert");

let callCount = 0;

function mustCall(fn) {
  try {
    fn();
  } finally {
    callCount++;
  }
}

test(
  "test with an async function",
  mustCall(async () => {
    const result = await Promise.resolve(42);
    assert.equal(result, 42);
  }),
);

test(
  "test with an async function that delays",
  mustCall(async () => {
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, 100));
    const end = Date.now();
    assert.ok(end - start > 10, "should wait at least 10ms");
  }),
);

describe("nested tests", () => {
  test(
    "nested test with an async function",
    mustCall(async () => {
      const result = await Promise.resolve(42);
      assert.equal(result, 42);
    }),
  );

  test(
    "nested test with an async function that delays",
    mustCall(async () => {
      const start = Date.now();
      await new Promise(resolve => setTimeout(resolve, 100));
      const end = Date.now();
      assert.ok(end - start > 10, "should wait at least 10ms");
    }),
  );
});

after(() => {
  assert.equal(callCount, 4);
});
