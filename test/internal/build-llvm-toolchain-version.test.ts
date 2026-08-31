/**
 * resolveLlvmToolchain() (scripts/build/tools.ts) must version-check clang
 * and clang++ the same way. With several LLVM installs on one machine (a
 * newer default under the bare names, the pinned major under suffixed
 * names), the clang lookup rejects the default and falls through to
 * clang-<major>, but an unchecked clang++ lookup takes the bare name from
 * the newer install. That mixes two compiler majors in one build
 * (oven-sh/bun#41000).
 *
 * The fake tools are shell scripts that print a version string; PATH and
 * the toolchain's search paths point only at them, so no real LLVM
 * install on the test machine can win.
 */
import { afterEach, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { LLVM_VERSION, resolveLlvmToolchain } from "../../scripts/build/tools.ts";

const llvmMajor = LLVM_VERSION.split(".")[0];

const savedEnv = { PATH: process.env.PATH, CARGO_HOME: process.env.CARGO_HOME };
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function fakeTool(version: string): string {
  return `#!/bin/sh\nprintf 'version %s\\n' '${version}'\n`;
}

test.skipIf(isWindows)("clang++ is version-checked so cc and cxx come from the same LLVM major", () => {
  // Two installs visible through one bin dir, as on gentoo in #41000: the
  // bare names are a newer default install, the suffixed names the pinned one.
  const tools: Record<string, string> = {
    "bin/clang": fakeTool("99.0.0"),
    [`bin/clang-${llvmMajor}`]: fakeTool(LLVM_VERSION),
    "bin/clang++": fakeTool("99.0.0"),
    [`bin/clang++-${llvmMajor}`]: fakeTool(LLVM_VERSION),
    "bin/ld.lld": fakeTool(LLVM_VERSION),
    "bin/llvm-ar": fakeTool(LLVM_VERSION),
    "bin/llvm-ranlib": fakeTool(LLVM_VERSION),
    "bin/strip": fakeTool(LLVM_VERSION),
  };
  using dir = tempDir("build-llvm-version", tools);
  const bin = join(String(dir), "bin");
  for (const name of Object.keys(tools)) chmodSync(join(String(dir), name), 0o755);
  process.env.PATH = bin;
  // Keep findRustLld() away from the machine's real rustc.
  process.env.CARGO_HOME = String(dir);

  const llvm = resolveLlvmToolchain("linux", "x64", "linux", [bin]);
  expect({ cc: llvm.cc, cxx: llvm.cxx, clangVersion: llvm.clangVersion }).toEqual({
    cc: join(bin, `clang-${llvmMajor}`),
    cxx: join(bin, `clang++-${llvmMajor}`),
    clangVersion: LLVM_VERSION,
  });
});
