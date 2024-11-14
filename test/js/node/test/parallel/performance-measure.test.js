//#FILE: test-performance-measure.js
//#SHA1: f049b29e11ba7864ddf502609caf424eccee7ca5
//-----------------
"use strict";

const { PerformanceObserver, performance } = require("perf_hooks");

const DELAY = 1000;
const ALLOWED_MARGIN = 10;

test("performance measures", done => {
  const expected = ["Start to Now", "A to Now", "A to B"];
  const obs = new PerformanceObserver(items => {
    items.getEntries().forEach(({ name, duration }) => {
      expect(duration).toBeGreaterThan(DELAY - ALLOWED_MARGIN);
      expect(expected.shift()).toBe(name);
    });
    if (expected.length === 0) {
      done();
    }
  });
  obs.observe({ entryTypes: ["measure"] });

  performance.mark("A");
  setTimeout(() => {
    performance.measure("Start to Now");
    performance.measure("A to Now", "A");

    performance.mark("B");
    performance.measure("A to B", "A", "B");
  }, DELAY);
});

//<#END_FILE: test-performance-measure.js
