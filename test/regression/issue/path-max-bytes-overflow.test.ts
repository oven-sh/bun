// https://github.com/oven-sh/bun/issues/XXXXX
// Regression test for PathBuffer overflow on Windows
// When a path is exactly MAX_PATH_BYTES (98302 on Windows), the null terminator
// would be written out of bounds, causing a panic.

import { expect, test } from "bun:test";
import fs from "fs";
import { isWindows } from "harness";

test("path exactly MAX_PATH_BYTES should not panic", () => {
  if (!isWindows) {
    return; // This bug is Windows-specific
  }

  // On Windows, MAX_PATH_BYTES = 32767 * 3 + 1 = 98302
  const MAX_PATH_BYTES = 98302;

  // Create a path that's exactly MAX_PATH_BYTES
  // Use a simple pattern to make it look like a valid path
  const longPath = "C:\\" + "a".repeat(MAX_PATH_BYTES - 3);

  expect(longPath.length).toBe(MAX_PATH_BYTES);

  // This should throw an error about the path being too long,
  // not panic with "index out of bounds"
  expect(() => {
    fs.existsSync(longPath);
  }).toThrow();
});

test("path just under MAX_PATH_BYTES should work or error gracefully", () => {
  if (!isWindows) {
    return; // This bug is Windows-specific
  }

  // On Windows, MAX_PATH_BYTES = 32767 * 3 + 1 = 98302
  const MAX_PATH_BYTES = 98302;

  // Create a path that's just under MAX_PATH_BYTES
  const longPath = "C:\\" + "a".repeat(MAX_PATH_BYTES - 4);

  expect(longPath.length).toBe(MAX_PATH_BYTES - 1);

  // This should work without panicking
  // It will return false since the path doesn't exist, but shouldn't panic
  expect(() => {
    const result = fs.existsSync(longPath);
    // We expect this to be false (path doesn't exist)
    expect(result).toBe(false);
  }).not.toThrow();
});
