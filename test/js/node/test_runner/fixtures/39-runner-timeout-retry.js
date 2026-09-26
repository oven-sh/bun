const { test, after, afterEach } = require("node:test");
const assert = require("node:assert");

// node-test.test.ts runs this file with `--retry 1` and a short `--timeout`.
// The first attempt of F stays pending and the timeout ends it. The retry must
// start clean: its subtest runs, and its failure fails the retry.
const log = [];
let attempt = 0;

afterEach(t => {
  log.push(`afterEach(${t.name}) attempt=${attempt}`);
});

test("F", async t => {
  const n = ++attempt;
  if (n === 1) await new Promise(() => {});
  await t.test("check", () => {
    log.push(`check attempt=${n}`);
    assert.fail("the subtest of the retry fails");
  });
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
