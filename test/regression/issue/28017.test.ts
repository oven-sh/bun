import { expect, test } from "bun:test";
import { statSync, utimesSync } from "fs";
import { stat } from "fs/promises";
import { tempDir } from "harness";
import { join } from "path";

test("fs.stat *Ms properties preserve sub-millisecond precision", async () => {
  using dir = tempDir("stat-ms-precision", {
    "test.txt": "hello",
  });

  const filePath = join(String(dir), "test.txt");

  // Set known fractional timestamps: 1700000000.123456 seconds = 1700000000123.456 ms
  const fractionalTime = 1700000000.123456;
  utimesSync(filePath, fractionalTime, fractionalTime);

  const syncStats = statSync(filePath);
  const asyncStats = await stat(filePath);

  for (const s of [syncStats, asyncStats]) {
    // atimeMs and mtimeMs should have fractional milliseconds
    expect(Number.isInteger(s.atimeMs)).toBe(false);
    expect(Number.isInteger(s.mtimeMs)).toBe(false);

    // Verify the values match what we set (within microsecond tolerance)
    const expectedMs = fractionalTime * 1000; // 1700000000123.456
    expect(s.atimeMs).toBeCloseTo(expectedMs, 3);
    expect(s.mtimeMs).toBeCloseTo(expectedMs, 3);
  }
});
