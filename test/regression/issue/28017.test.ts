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

  // Set known fractional timestamps: 1700000000.5005 seconds = 1700000000500.5 ms
  // Using .5005 (500.5ms) ensures clear sub-millisecond component (.5ms)
  // that survives filesystem round-trip even with microsecond-precision utimes.
  const fractionalTime = 1700000000.5005;
  utimesSync(filePath, fractionalTime, fractionalTime);

  const syncStats = statSync(filePath);
  const asyncStats = await stat(filePath);

  const expectedMs = fractionalTime * 1000; // 1700000000500.5

  for (const s of [syncStats, asyncStats]) {
    // atimeMs and mtimeMs should have fractional milliseconds
    expect(Number.isInteger(s.atimeMs)).toBe(false);
    expect(Number.isInteger(s.mtimeMs)).toBe(false);

    // Verify the values match what we set (within 0.05ms / 50 microsecond tolerance)
    expect(s.atimeMs).toBeCloseTo(expectedMs, 1);
    expect(s.mtimeMs).toBeCloseTo(expectedMs, 1);
  }
});
