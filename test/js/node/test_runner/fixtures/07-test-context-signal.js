const { test } = require("node:test");

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
