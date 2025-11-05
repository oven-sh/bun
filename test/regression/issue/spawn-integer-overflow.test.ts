import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunExe } from "harness";

// This test reproduces an integer overflow panic in subprocess.zig:949
// When getArgv tries to compute: cmds_array.len + 2
// If cmds_array.len is close to max integer, this overflows

test("spawnSync should not panic on extremely large cmd array", () => {
  // The limit is 1024*1024 = 1048576 arguments
  // This should throw an error "cmd array is too large", NOT panic
  expect(() => {
    spawnSync({
      cmd: [bunExe(), ...Array(1048577).fill("-e")],
    });
  }).toThrow(/too large/);
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
