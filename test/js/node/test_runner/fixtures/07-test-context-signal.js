const { describe, test } = require("node:test");

// `t.signal` must abort when the test times out so in-flight work can be
// cancelled. Resolving nothing, the body ends only via the timeout.
test("signal aborts at the timeout", { timeout: 50 }, t => {
  return new Promise(() => {
    t.signal.addEventListener("abort", () => {
      console.log("TIMEOUT_SIGNAL_ABORTED name=" + t.signal.reason.name);
    });
  });
});

// Node also aborts `t.signal` once the test completes normally.
test("signal aborts when the test ends", t => {
  t.signal.addEventListener("abort", () => {
    console.log("COMPLETION_SIGNAL_ABORTED");
  });
});

// A suite's signal is NOT aborted on a normal run. Node's abort lives at the
// end of Test#run and Suite#run never calls it, so only tests abort.
describe("suite signal is not aborted", s => {
  s.signal.addEventListener("abort", () => {
    console.log("SUITE_SIGNAL_ABORTED");
  });
  test("inner", () => {});
});
