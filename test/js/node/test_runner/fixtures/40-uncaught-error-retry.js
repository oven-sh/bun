const { test, after } = require("node:test");
const assert = require("node:assert");

// node-test.test.ts runs this file with `--retry 1`. A rejection that nothing
// handles ends the first attempt of R while its body is pending. That body
// settles during the retry. Its late completion must not complete the retry,
// which fails on its own.
const log = [];
let attempt = 0;
let releaseFirst;
const turn = () => new Promise(resolve => setImmediate(resolve));

test("R", async () => {
  const n = ++attempt;
  if (n === 1) {
    Promise.reject(new Error("rejected in attempt 1"));
    await new Promise(resolve => (releaseFirst = resolve));
    return;
  }
  releaseFirst();
  for (let i = 0; i < 3; i++) await turn();
  log.push("attempt 2 end");
  assert.fail("attempt 2 fails");
});

test("Z", () => {
  log.push("Z");
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
