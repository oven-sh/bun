import { expect, test } from "bun:test";
import { describePlatform, platforms } from "../../../packages/bun-release/src/platform";

// upload-npm.ts writes `This is the ${describePlatform(platform)} binary for Bun, ...` as the
// package.json description of every @oven/bun-* package, so each entry in platform.ts has to
// describe its own target (they all used to be published as "the macOS arm64 binary").
test("describePlatform names the target of every platform package", () => {
  expect(Object.fromEntries(platforms.map(platform => [platform.bin, describePlatform(platform)]))).toEqual({
    "bun-darwin-aarch64": "macOS arm64",
    "bun-darwin-x64": "macOS x64",
    "bun-darwin-x64-baseline": "macOS x64",
    "bun-linux-aarch64": "Linux arm64",
    "bun-linux-x64": "Linux x64",
    "bun-linux-x64-baseline": "Linux x64",
    "bun-linux-aarch64-musl": "Linux arm64 (musl)",
    "bun-linux-x64-musl": "Linux x64 (musl)",
    "bun-linux-x64-musl-baseline": "Linux x64 (musl)",
    "bun-linux-aarch64-android": "Android arm64",
    "bun-linux-x64-android": "Android x64",
    "bun-freebsd-aarch64": "FreeBSD arm64",
    "bun-freebsd-x64": "FreeBSD x64",
    "bun-windows-x64": "Windows x64",
    "bun-windows-x64-baseline": "Windows x64",
    "bun-windows-aarch64": "Windows arm64",
  });
});
