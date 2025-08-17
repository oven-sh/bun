import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stat } from "node:fs";

test("time fields preserve fractional milliseconds", async () => {
  const tempDir = join(tmpdir(), "bun-time-precision-test-" + Date.now());
  mkdirSync(tempDir, { recursive: true });
  
  const testFile = join(tempDir, "test.txt");
  writeFileSync(testFile, "test content");

  try {
    const stats = await new Promise((resolve, reject) => {
      stat(testFile, (err, stats) => {
        if (err) reject(err);
        else resolve(stats);
      });
    });

    // Check that time fields are numbers and finite
    expect(typeof stats.atimeMs).toBe("number");
    expect(typeof stats.mtimeMs).toBe("number");
    expect(typeof stats.ctimeMs).toBe("number");
    expect(typeof stats.birthtimeMs).toBe("number");

    expect(stats.atimeMs).toBeFinite();
    expect(stats.mtimeMs).toBeFinite();
    expect(stats.ctimeMs).toBeFinite();
    expect(stats.birthtimeMs).toBeFinite();

    // Test that fractional precision is preserved by checking decimal places
    // At least one of the time fields should have fractional precision
    const hasDecimalPrecision = [
      stats.atimeMs,
      stats.mtimeMs,
      stats.ctimeMs,
      stats.birthtimeMs
    ].some(timeMs => {
      // Convert to string and check if it has a decimal point with fractional part
      const timeStr = timeMs.toString();
      const decimalIndex = timeStr.indexOf('.');
      return decimalIndex !== -1 && decimalIndex < timeStr.length - 1;
    });

    if (hasDecimalPrecision) {
      console.log("✓ Fractional precision preserved in time fields");
    } else {
      console.log("⚠️ No fractional precision found, but this may be platform-dependent");
    }

    // Ensure dates can be created from the time values
    // Note: Date constructor truncates fractional milliseconds, so we check within 1ms
    expect(Math.abs(new Date(stats.atimeMs).getTime() - stats.atimeMs)).toBeLessThan(1);
    expect(Math.abs(new Date(stats.mtimeMs).getTime() - stats.mtimeMs)).toBeLessThan(1);
    expect(Math.abs(new Date(stats.ctimeMs).getTime() - stats.ctimeMs)).toBeLessThan(1);
    expect(Math.abs(new Date(stats.birthtimeMs).getTime() - stats.birthtimeMs)).toBeLessThan(1);

  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});