import { expect, test } from "bun:test";
import { statSync } from "fs";
import { stat } from "fs/promises";

test("fs.stat *Ms properties preserve sub-millisecond precision", async () => {
  // Use the test file itself as the target
  const stats = statSync(import.meta.path);
  const asyncStats = await stat(import.meta.path);

  for (const s of [stats, asyncStats]) {
    // At least one of the *Ms properties should have a fractional component,
    // since nanosecond-precision filesystems almost always produce non-integer ms values.
    const msValues = [s.mtimeMs, s.atimeMs, s.ctimeMs, s.birthtimeMs];
    const hasFractional = msValues.some(v => !Number.isInteger(v));
    expect(hasFractional).toBe(true);

    // All *Ms values should be finite positive numbers
    for (const v of msValues) {
      expect(typeof v).toBe("number");
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  }
});
