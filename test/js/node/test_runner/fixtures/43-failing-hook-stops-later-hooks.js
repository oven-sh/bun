// In Node v26.3.0 a hook that fails stops the hooks that are left in its list:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/test_runner/test.js#L1263-L1279
// `node --test` exits 1 for each top-level test and suite of this file when it
// is alone in a file, and the hooks print the same `ran:` lines.
const { test, describe, it, after, afterEach } = require("node:test");

const ran = name => console.log(`ran: ${name}`);
const fail = name => () => {
  ran(name);
  throw new Error(`${name} failed`);
};

test("an after hook of a test fails", t => {
  t.after(fail("after 1"));
  t.after(() => ran("after 2"));
});

describe("an afterEach hook fails", () => {
  afterEach(() => ran("outer afterEach"));

  describe("in a suite below", () => {
    afterEach(fail("inner afterEach 1"));
    afterEach(() => ran("inner afterEach 2"));

    // The after hooks of the test still run, and the test has failed by then.
    it("for a test with an after hook", t => {
      t.after(() => ran(`after, passed=${t.passed}`));
    });
  });
});

test("an after hook of an inline suite fails", async () => {
  describe("inline", () => {
    after(fail("suite after 1"));
    after(() => ran("suite after 2"));
    it("passes", () => {});
  });
});

// The hook that calls t.todo() or t.skip() does not run, so the failure counts.
test("an after hook of a test fails, and the next one calls t.todo()", t => {
  t.after(fail("after before todo"));
  t.after(() => t.todo());
});

test("an after hook of a subtest fails, and the next one calls t.todo()", async t => {
  await t.test("fails in its first after hook", t2 => {
    t2.after(fail("subtest after before todo"));
    t2.after(() => t2.todo());
  });
});

describe("an afterEach hook fails, and the next one calls t.skip()", () => {
  afterEach(fail("afterEach before skip"));
  afterEach(t => t.skip());
  it("fails", () => {});
});
