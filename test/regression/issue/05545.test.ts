import { describe, expect, test } from "bun:test";
import { getSupportedPlatforms } from "../../../packages/bun-release/src/platform";

// https://github.com/oven-sh/bun/issues/5545
//
// On Alpine (musl), `npm install -g bun` printed:
//   Failed to find package "@oven/bun-linux-x64". You may have used the "--no-optional" flag ...
// because the postinstall picker tried the glibc build before the musl build.
// The glibc binary is present in node_modules (npm installs both optionalDependencies
// since they share os/cpu) but cannot run on musl, so the first attempt always failed
// loudly before falling through.

describe("npm postinstall platform selection (issue #5545)", () => {
  test("musl hosts try the musl package first", () => {
    expect(getSupportedPlatforms("linux", "x64", "musl").map(p => p.bin)).toEqual([
      "bun-linux-x64-musl",
      "bun-linux-x64",
    ]);
    expect(getSupportedPlatforms("linux", "arm64", "musl").map(p => p.bin)).toEqual([
      "bun-linux-aarch64-musl",
      "bun-linux-aarch64",
    ]);
  });

  test("glibc hosts only try the glibc package", () => {
    expect(getSupportedPlatforms("linux", "x64", undefined).map(p => p.bin)).toEqual(["bun-linux-x64"]);
    expect(getSupportedPlatforms("linux", "arm64", undefined).map(p => p.bin)).toEqual(["bun-linux-aarch64"]);
  });

  test("other platforms are unaffected", () => {
    expect(getSupportedPlatforms("darwin", "arm64", undefined).map(p => p.bin)).toEqual(["bun-darwin-aarch64"]);
    expect(getSupportedPlatforms("darwin", "x64", undefined).map(p => p.bin)).toEqual(["bun-darwin-x64"]);
    expect(getSupportedPlatforms("win32", "x64", undefined).map(p => p.bin)).toEqual(["bun-windows-x64"]);
    expect(getSupportedPlatforms("win32", "arm64", undefined).map(p => p.bin)).toEqual(["bun-windows-aarch64"]);
    expect(getSupportedPlatforms("android", "arm64", "android").map(p => p.bin)).toEqual(["bun-linux-aarch64-android"]);
  });
});
