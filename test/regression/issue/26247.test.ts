import type { Build } from "bun";
import { expect, test } from "bun:test";

// This test verifies that all valid compile target strings are accepted by the Build.Target type.
// See https://github.com/oven-sh/bun/issues/26247

test("Build.Target type accepts all valid compile target strings", () => {
  // This is a compile-time type-check test. If this file compiles without TypeScript errors,
  // the Build.Target type correctly includes all valid target string variants.

  const validTargets: Build.Target[] = [
    // darwin variants
    "bun-darwin-x64",
    "bun-darwin-arm64",
    "bun-darwin-x64-baseline",
    "bun-darwin-x64-modern",
    "bun-darwin-arm64-baseline",
    "bun-darwin-arm64-modern",

    // linux without libc
    "bun-linux-x64",
    "bun-linux-arm64",

    // linux with libc
    "bun-linux-x64-glibc",
    "bun-linux-x64-musl",
    "bun-linux-arm64-glibc",
    "bun-linux-arm64-musl",

    // linux with SIMD (without libc) - this was the original issue #26247
    "bun-linux-x64-baseline",
    "bun-linux-x64-modern",
    "bun-linux-arm64-baseline",
    "bun-linux-arm64-modern",

    // linux with SIMD and libc
    "bun-linux-x64-baseline-glibc",
    "bun-linux-x64-baseline-musl",
    "bun-linux-x64-modern-glibc",
    "bun-linux-x64-modern-musl",
    "bun-linux-arm64-baseline-glibc",
    "bun-linux-arm64-baseline-musl",
    "bun-linux-arm64-modern-glibc",
    "bun-linux-arm64-modern-musl",

    // windows variants
    "bun-windows-x64",
    "bun-windows-x64-baseline",
    "bun-windows-x64-modern",
  ];

  // All strings should be valid targets at the type level (compilation check)
  // and they should all be strings
  for (const target of validTargets) {
    expect(typeof target).toBe("string");
  }

  // Verify count
  expect(validTargets.length).toBe(27);
});
