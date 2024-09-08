//#FILE: test-performanceobserver-gc.js
//#SHA1: 2a18df2fa465d96ec5c9ee5d42052c732c777e2b
//-----------------
"use strict";

// Verifies that setting up two observers to listen
// to gc performance does not crash.

const { PerformanceObserver } = require("perf_hooks");

test("Setting up two observers to listen to gc performance does not crash", () => {
  // We don't actually care if the callback is ever invoked in this test
  const obs = new PerformanceObserver(() => {});
  const obs2 = new PerformanceObserver(() => {});

  expect(() => {
    obs.observe({ type: "gc" });
    obs2.observe({ type: "gc" });
  }).not.toThrow();
});

//<#END_FILE: test-performanceobserver-gc.js
