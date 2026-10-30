import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { computeFlags, fuzzilliCoverageFlags } from "../../scripts/build/flags.ts";
import { cargoBuildInvocation } from "../../scripts/build/rust.ts";

const toolchain = {
  cc: "/fake/llvm/bin/clang",
  cxx: "/fake/llvm/bin/clang++",
  clangVersion: "23.1.1",
  clangResourceDir: "/fake/llvm/lib/clang/23",
  ar: "/fake/llvm/bin/llvm-ar",
  ld: "/fake/llvm/bin/ld.lld",
  ld64Lld: "/fake/llvm/bin/ld64.lld",
  rustLlvmVersion: "23.1.1",
  strip: "/fake/bin/strip",
  llvmStrip: "/fake/llvm/bin/llvm-strip",
  nm: "/fake/llvm/bin/llvm-nm",
  readobj: "/fake/llvm/bin/llvm-readobj",
  objdump: "/fake/llvm/bin/llvm-objdump",
  cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
  dsymutil: "/fake/llvm/bin/dsymutil",
  bun: "/fake/bin/bun",
  jsRuntime: "/fake/bin/bun",
  esbuild: "/fake/bin/esbuild",
  cmake: "/fake/bin/cmake",
} as Toolchain;

/** linuxSysroot is a stub, so that resolveConfig accepts the target on every host. */
const linux: PartialConfig = {
  os: "linux",
  arch: "x64",
  abi: "gnu",
  buildType: "Release",
  webkit: "local",
  linuxSysroot: "/fake/linux-sysroot",
};

const listPath = join(import.meta.dir, "../../scripts/build/fuzzilli-compiler-coverage.txt");

/** The coverage flags of Bun's own sources, and those that deps/webkit.ts gives JavaScriptCore's. */
function coverageFlagsOf(partial: PartialConfig): { bun: string[]; engine: string[] } {
  using dir = tempDir("build-fuzzilli-flags", {});
  const cfg = resolveConfig({ ...linux, buildDir: String(dir), ...partial }, toolchain);
  const bun = computeFlags(cfg).cxxflags.filter(flag => flag.includes("sanitize-coverage"));
  return { bun, engine: fuzzilliCoverageFlags(cfg) };
}

function rustFlagsOf(partial: PartialConfig): string[] {
  using dir = tempDir("build-fuzzilli-flags", {});
  const cfg = resolveConfig({ ...linux, buildDir: String(dir), ...partial }, toolchain);
  return cargoBuildInvocation(cfg).env.CARGO_ENCODED_RUSTFLAGS.split("\x1f");
}

test("only --fuzzilli=on compiles the Rust code behind cfg(bun_fuzzilli)", () => {
  expect(rustFlagsOf({ fuzzilli: true })).toContain("--cfg=bun_fuzzilli");
  expect(rustFlagsOf({})).not.toContain("--cfg=bun_fuzzilli");
  expect(rustFlagsOf({})).toContain("--check-cfg=cfg(bun_fuzzilli)");
});

test("--fuzzilli=on reports coverage everywhere", () => {
  const flags = ["-fsanitize-coverage=trace-pc-guard"];
  expect(coverageFlagsOf({ fuzzilli: true })).toEqual({ bun: flags, engine: flags });
});

test("--fuzzilli-compiler-only=on limits coverage to the listed functions", () => {
  const flags = ["-fsanitize-coverage=trace-pc-guard", `-fsanitize-coverage-allowlist=${listPath}`];
  expect(coverageFlagsOf({ fuzzilli: true, fuzzilliCompilerOnly: true })).toEqual({ bun: flags, engine: flags });
});

test("a build without Fuzzilli has no coverage flags", () => {
  expect(coverageFlagsOf({ fuzzilliCompilerOnly: true })).toEqual({ bun: [], engine: [] });
});

test("an engine built from source gives the coverage flags to JavaScriptCore's sources", () => {
  const text = readFileSync(join(import.meta.dir, "../../scripts/build/deps/webkit.ts"), "utf8");
  expect(text).toContain('"-DBUILDING_JavaScriptCore", ...fuzzilliCoverageFlags(cfg)]');
});

test("the list names functions by their namespaces and takes every source file", () => {
  const lines = readFileSync(listPath, "utf8")
    .split("\n")
    .filter(line => line !== "" && !line.startsWith("#"));
  expect(lines[0]).toBe("src:*");
  for (const namespace of ["3JSC3AOT", "3JSC2B3"]) {
    for (const prefix of ["_ZN", "_ZNK", "_ZZN", "_ZZNK"]) expect(lines).toContain(`fun:${prefix}${namespace}*`);
  }
});
