// The public Promise methods are replaced before node:test loads, and they stay
// replaced. The runner must not keep one of them at load and call it later.
// Node v26.3.0 passes each test as it is.
const methods = [
  [Promise, "resolve"],
  [Promise, "reject"],
  [Promise, "race"],
  [Promise, "all"],
  [Promise, "allSettled"],
  [Promise, "any"],
  [Promise, "withResolvers"],
  [Promise.prototype, "then"],
  [Promise.prototype, "catch"],
  [Promise.prototype, "finally"],
];
const calls = [];
let recording = false;
for (const [object, name] of methods) {
  const original = object[name];
  object[name] = function (...args) {
    if (recording) calls.push(name);
    return Reflect.apply(original, this, args);
  };
}

const assert = require("node:assert");
const { test, describe, it, mock } = require("node:test");
const timers = require("node:timers/promises");

test("the record starts", () => {
  recording = true;
});

test("subtests", async t => {
  await t.test("sync", () => {});
  await t.test("async", async () => {
    await new Promise(resolve => setImmediate(resolve));
  });
  await t.test("done callback", (t, done) => {
    setImmediate(done);
  });
  await t.test("timeout", { timeout: 60_000 }, () => {});
  await t.test("skipped", { skip: true }, () => {});
});

describe("a suite", () => {
  it("has a test", () => {});
});

test("a suite declared in a running test", async () => {
  await describe("suite", async () => {
    it("child", () => {});
  });
});

test("a hook with a timeout", async t => {
  t.beforeEach(() => {}, { timeout: 60_000 });
  await t.test("subtest", () => {});
});

test("mock timers", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pending = timers.setTimeout(1000, "value");
  mock.timers.tick(1000);
  assert.strictEqual(await pending, "value");
  mock.timers.reset();
});

test("the runner made no call", () => {
  recording = false;
  assert.deepStrictEqual(calls, []);
});
