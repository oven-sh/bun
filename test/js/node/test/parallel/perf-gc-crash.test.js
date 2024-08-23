//#FILE: test-perf-gc-crash.js
//#SHA1: 376f73db023a0e22edee3e715b8b5999213b5c93
//-----------------
"use strict";

// Refers to https://github.com/nodejs/node/issues/39548

// The test fails if this crashes. If it closes normally,
// then all is good.

const { PerformanceObserver } = require("perf_hooks");

test("PerformanceObserver does not crash on multiple observe and disconnect calls", () => {
  // We don't actually care if the observer callback is called here.
  const gcObserver = new PerformanceObserver(() => {});

  expect(() => {
    gcObserver.observe({ entryTypes: ["gc"] });
    gcObserver.disconnect();
  }).not.toThrow();

  const gcObserver2 = new PerformanceObserver(() => {});

  expect(() => {
    gcObserver2.observe({ entryTypes: ["gc"] });
    gcObserver2.disconnect();
  }).not.toThrow();
});

//<#END_FILE: test-perf-gc-crash.js
