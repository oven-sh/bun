//#FILE: test-performance-nodetiming.js
//#SHA1: 7b861bd4f2035688c2cb23ff54525d8e039c2d23
//-----------------
"use strict";

const { performance } = require("perf_hooks");
const { isMainThread } = require("worker_threads");

describe("performance.nodeTiming", () => {
  const { nodeTiming } = performance;

  test("basic properties", () => {
    expect(nodeTiming.name).toBe("node");
    expect(nodeTiming.entryType).toBe("node");
  });

  test("timing values", () => {
    expect(nodeTiming.startTime).toBe(0);
    const now = performance.now();
    expect(nodeTiming.duration).toBeGreaterThanOrEqual(now);
  });

  test("milestone values order", () => {
    const keys = ["nodeStart", "v8Start", "environment", "bootstrapComplete"];
    for (let idx = 0; idx < keys.length; idx++) {
      if (idx === 0) {
        expect(nodeTiming[keys[idx]]).toBeGreaterThanOrEqual(0);
        continue;
      }
      expect(nodeTiming[keys[idx]]).toBeGreaterThan(nodeTiming[keys[idx - 1]]);
    }
  });

  test("loop milestones", () => {
    expect(nodeTiming.idleTime).toBe(0);
    if (isMainThread) {
      expect(nodeTiming.loopStart).toBe(-1);
    } else {
      expect(nodeTiming.loopStart).toBeGreaterThanOrEqual(nodeTiming.bootstrapComplete);
    }
    expect(nodeTiming.loopExit).toBe(-1);
  });

  test("idle time and loop exit", done => {
    setTimeout(() => {
      expect(nodeTiming.idleTime).toBeGreaterThanOrEqual(0);
      expect(nodeTiming.idleTime + nodeTiming.loopExit).toBeLessThanOrEqual(nodeTiming.duration);
      expect(nodeTiming.loopStart).toBeGreaterThanOrEqual(nodeTiming.bootstrapComplete);
      done();
    }, 1);
  });

  test("loop exit on process exit", done => {
    process.on("exit", () => {
      expect(nodeTiming.loopExit).toBeGreaterThan(0);
      done();
    });
    // Trigger process exit
    process.exit();
  });
});

//<#END_FILE: test-performance-nodetiming.js
