import { expect, test } from "bun:test";
import { tempDir } from "harness";

import { resolveConfig, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { computeFlags } from "../../scripts/build/flags.ts";
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
  linuxSysroot: "/fake/linux-sysroot",
};

function coverageFlagsOf(partial: PartialConfig): string[] {
  using dir = tempDir("build-fuzzilli-flags", {});
  const cfg = resolveConfig({ ...linux, buildDir: String(dir), ...partial }, toolchain);
  return computeFlags(cfg).cxxflags.filter(flag => flag.includes("sanitize-coverage"));
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

test("only --fuzzilli=on reports coverage", () => {
  expect(coverageFlagsOf({ fuzzilli: true })).toEqual(["-fsanitize-coverage=trace-pc-guard"]);
  expect(coverageFlagsOf({})).toEqual([]);
});
