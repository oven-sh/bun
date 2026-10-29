// The test fails and leaves an interval running. node-test.test.ts runs this
// file with BUN_TEST_DRAIN_EVENT_LOOP=1, which run() sets for its children.
// The process must exit although the interval keeps the event loop alive.
const { test } = require(process.env.TEST_MODULE);

process.on("beforeExit", () => console.log("BEFORE_EXIT"));
process.on("exit", code => console.log("EXIT " + code));

test("fails and leaves an interval", () => {
  setInterval(() => {}, 1000);
  throw new Error("boom");
});
