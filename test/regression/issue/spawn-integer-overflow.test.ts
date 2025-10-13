import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunExe } from "harness";

// This test reproduces an integer overflow panic in subprocess.zig:949
// When getArgv tries to compute: cmds_array.len + 2
// If cmds_array.len is close to max integer, this overflows

test("spawnSync should not panic on extremely large cmd array", () => {
  // Try to create an array large enough to cause integer overflow when adding 2
  // For a 32-bit length field, values near 2^32 - 1 would overflow
  // For practical purposes, we'll try a reasonably large array that might trigger the issue

  // This should throw an error (like ENOMEM or "too many args"), NOT panic
  expect(() => {
    spawnSync({
      cmd: [bunExe(), ...Array(1000000).fill("-e")],
    });
  }).toThrow();
});

test("spawnSync should handle empty cmd array gracefully", () => {
  // Empty arrays should also not panic
  expect(() => {
    spawnSync({
      cmd: [],
    });
  }).toThrow();
});

test("spawnSync should handle array with empty strings", () => {
  // Arrays of empty strings should not panic
  expect(() => {
    spawnSync({
      cmd: ["", "", ""],
    });
  }).toThrow();
});
