// node-test.test.ts runs this with `--retry=1`. bun:test runs a failed test
// again, and the subtests of the first attempt do not run again: what they
// failed with has to last until the second attempt ends.
const { test } = require("node:test");

const fail = message => () => {
  throw new Error(message);
};

test("a subtest fails, then its parent calls t.skip()", async t => {
  await t.test("fails", fail("subtest"));
  t.skip();
});

test("a subtest calls t.skip() and then throws", async t => {
  await t.test("skips then throws", t2 => {
    t2.skip();
    throw new Error("subtest");
  });
});

let attempts = 0;
test("a test with a passing subtest throws on its first attempt only", async t => {
  await t.test("passes", () => {});
  if (++attempts === 1) throw new Error("first attempt");
});
