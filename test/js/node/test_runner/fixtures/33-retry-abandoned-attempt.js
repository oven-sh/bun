// Run with `bun test --retry 1 --timeout 1`. bun:test's own timeout gives up on both attempts of the first test
// while their bodies are still waiting, and it does not tell node:test. The second test has no timeout.
const { test } = require("node:test");

const log = (...args) => console.log("OBS", ...args);
const goOn = Promise.withResolvers();
const over = Promise.withResolvers();
let attempts = 0;
let runs = 0;

test("abandoned twice", async t => {
  if (++attempts === 2) return new Promise(() => {});
  t.after(() => {
    log("t.after of the first attempt");
    over.resolve();
  });
  await goOn.promise;
  throw new Error("the first attempt fails long after it was replaced");
});

// The first attempt fails while this test is running. That failure belongs to an attempt that was replaced,
// so it must not reach bun:test, which would charge it to this test and run it again.
test("runs once", { timeout: Infinity }, async () => {
  runs++;
  goOn.resolve();
  await over.promise;
  log("runs once:", "attempts of the other test=" + attempts, "runs of this test=" + runs);
});
