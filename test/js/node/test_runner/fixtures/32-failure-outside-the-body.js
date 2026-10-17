// Every test here must FAIL. Each failure has a falsy value and comes from
// outside the test body: the run of the test itself rejects, or the restore of
// a mock throws. Node v26.3.0 does not finish this file, so the verdicts are Bun's own.
const { test } = require("node:test");

// The `code` getter throws while the expectFailure validation reads the thrown
// object, so the run of the test rejects with `value`.
function rejectsRunWith(value) {
  return () => {
    throw {
      get code() {
        throw value;
      },
    };
  };
}

function restoreOfMockThrows(value) {
  return t => {
    let restoring = false;
    const object = new Proxy(
      { method() {} },
      {
        defineProperty(target, key, descriptor) {
          if (restoring) throw value;
          return Reflect.defineProperty(target, key, descriptor);
        },
      },
    );
    t.mock.method(object, "method");
    restoring = true;
  };
}

for (const [label, value] of [
  ["undefined", undefined],
  ["null", null],
  ["0", 0],
  ["false", false],
  ['""', ""],
]) {
  test(`the run of a test rejects with ${label}`, { expectFailure: /x/ }, rejectsRunWith(value));
  test(`the run of a subtest rejects with ${label}`, async t => {
    await t.test("subtest", { expectFailure: /x/ }, rejectsRunWith(value));
  });
  test(`the restore of a mock throws ${label}`, restoreOfMockThrows(value));
  test(`the restore of a mock in a subtest throws ${label}`, async t => {
    await t.test("subtest", restoreOfMockThrows(value));
  });
}
