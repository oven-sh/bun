import { expect, test } from "bun:test";
import { tempDir } from "harness";

import { binaryExpectations } from "../../scripts/build/binary-expectations.ts";
import {
  glibcLoadsPackedRelocations,
  resolveConfig,
  type Config,
  type PartialConfig,
  type Toolchain,
} from "../../scripts/build/config.ts";
import { computeFlags } from "../../scripts/build/flags.ts";

function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLlvmVersion: "23.1.1",
    rustSysroot: undefined,
    rustHostTriple: undefined,
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
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: undefined,
    nasm: undefined,
  };
}

function config(partial: PartialConfig, buildDir: string): Config {
  return resolveConfig(
    {
      os: "linux",
      arch: "x64",
      abi: "gnu",
      buildType: "Release",
      webkit: "local",
      buildDir,
      linuxSysroot: buildDir,
      ...partial,
    },
    mockToolchain(),
  );
}

const packs = "-Wl,-z,pack-relative-relocs";

test("--relr=on packs the relative relocations, with and without --hardened, and nothing else does", () => {
  using dir = tempDir("build-relr-option", {});
  for (const hardened of [false, true]) {
    expect(computeFlags(config({ relr: true, hardened }, String(dir))).ldflags).toContain(packs);
    expect(computeFlags(config({ hardened }, String(dir))).ldflags).not.toContain(packs);
  }
});

test("the file may then ask for a loader that reads them, and only then", () => {
  using dir = tempDir("build-relr-option", {});
  expect(binaryExpectations(config({ relr: true }, String(dir))).versionNames).toEqual(["GLIBC_ABI_DT_RELR"]);
  expect(binaryExpectations(config({}, String(dir))).versionNames).toEqual([]);
});

test("it is refused where the target is not Linux with glibc", () => {
  using dir = tempDir("build-relr-option", {});
  const sentence = /relr=true requires os=linux and abi=gnu/;
  expect(() => config({ relr: true, abi: "musl" }, String(dir))).toThrow(sentence);
  expect(() => config({ relr: true, os: "darwin", arch: "arm64", abi: undefined }, String(dir))).toThrow(sentence);
});

test("glibc reads them from 2.36 on", () => {
  expect(["2.17", "2.31", "2.35", "2.36", "2.41", "3.0"].map(glibcLoadsPackedRelocations)).toEqual([
    false,
    false,
    false,
    true,
    true,
    true,
  ]);
});
