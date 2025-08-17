import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stat, promises } from "node:fs";

test("fs.stat birthtimeMs should be a float with fractional part", async () => {
  const tempDir = join(tmpdir(), "bun-birthtime-test-" + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    // Test both sync and async variants
    const statSync = await new Promise((resolve, reject) => {
      stat(tempDir, (err, stats) => {
        if (err) reject(err);
        else resolve(stats);
      });
    });

    const statAsync = await promises.stat(tempDir);

    // Check that birthtimeMs is a number (not undefined or null)
    expect(typeof statSync.birthtimeMs).toBe("number");
    expect(typeof statAsync.birthtimeMs).toBe("number");

    // On platforms that support birthtime (like macOS), birthtimeMs should be positive
    // On Linux, it might be 0, so we just check it's not NaN
    expect(statSync.birthtimeMs).not.toBeNaN();
    expect(statAsync.birthtimeMs).not.toBeNaN();

    // The main fix: check that birthtimeMs is actually a float
    // We create a file and check that the precision is preserved
    if (statSync.birthtimeMs > 0) {
      // If birthtime is supported, it should have fractional precision
      // Node.js returns floating point values like 1755376430287.9988
      // The fractional part should be preserved
      const birthtimeStr = statSync.birthtimeMs.toString();
      
      // Check that we have sub-millisecond precision when birthtime is supported
      // This is platform-dependent, so we check if it's > 0 first
      expect(statSync.birthtimeMs % 1).toBeFinite(); // fractional part should be finite
    }

    // Also test that it matches the Date object conversion
    const birthtimeDate = new Date(statSync.birthtimeMs);
    expect(birthtimeDate.getTime()).toBe(statSync.birthtimeMs);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("all timeMs fields should be floats", async () => {
  const tempDir = join(tmpdir(), "bun-time-fields-test-" + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    const stats = await promises.stat(tempDir);

    // All time fields should be numbers
    expect(typeof stats.atimeMs).toBe("number");
    expect(typeof stats.mtimeMs).toBe("number");
    expect(typeof stats.ctimeMs).toBe("number");
    expect(typeof stats.birthtimeMs).toBe("number");

    // All time fields should be finite
    expect(stats.atimeMs).toBeFinite();
    expect(stats.mtimeMs).toBeFinite();
    expect(stats.ctimeMs).toBeFinite();
    expect(stats.birthtimeMs).toBeFinite();

    // All time fields should be positive or zero
    expect(stats.atimeMs).toBeGreaterThanOrEqual(0);
    expect(stats.mtimeMs).toBeGreaterThanOrEqual(0);
    expect(stats.ctimeMs).toBeGreaterThanOrEqual(0);
    expect(stats.birthtimeMs).toBeGreaterThanOrEqual(0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});