const { describe, test } = require("node:test");

// `t.signal` must abort when the test times out so in-flight work can be
// cancelled. The abort is the awaited condition: resolving from it lets the
// body settle once the runner has timed the test out, so the child exits.
test("signal aborts at the timeout", { timeout: 50 }, t => {
  const { promise, resolve } = Promise.withResolvers();
  // Hang guard: a body that never settles pins the child. If the abort
  // never fires, end the test ourselves so the missing marker is reported
  // as a plain assertion failure instead of a hung process.
  const guard = setTimeout(resolve, 5000);
  t.signal.addEventListener("abort", () => {
    console.log("TIMEOUT_SIGNAL_ABORTED name=" + t.signal.reason.name);
    clearTimeout(guard);
    resolve();
  });
  return promise;
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
