import { expect, test } from "bun:test";
import { isGlibc, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

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
  expect(() => config({ relr: true, os: "darwin", arch: "aarch64", abi: undefined }, String(dir))).toThrow(sentence);
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

// With --relr the build asks the host's glibc for its version, to know whether the host can run the binary for the
// smoke test. A getconf that fails says there is no such glibc. One that was killed has not said that, and the ask
// fails configure (scripts/build/probe.ts).
test.skipIf(!isGlibc)("the host's glibc is asked through getconf, and no answer is not a no", () => {
  using dir = tempDir("build-relr-getconf", {
    "reads-them/getconf": "#!/bin/sh\necho 'glibc 2.36'\n",
    "too-old/getconf": "#!/bin/sh\necho 'glibc 2.35'\n",
    "fails/getconf": "#!/bin/sh\nexit 1\n",
    // `kill` is not a builtin of every shell, and PATH is the fixture's.
    "killed/getconf": "#!/bin/sh\nPATH=/bin:/usr/bin\nkill -KILL $$\n",
  });
  const canRunOnHost = (name: string) => {
    chmodSync(join(String(dir), name, "getconf"), 0o755);
    const { PATH } = process.env;
    process.env.PATH = join(String(dir), name);
    try {
      const arch = process.arch === "arm64" ? "aarch64" : "x64";
      return config({ relr: true, arch }, String(dir)).canRunOnHost;
    } finally {
      process.env.PATH = PATH;
    }
  };

  expect(["reads-them", "too-old", "fails"].map(canRunOnHost)).toEqual([true, false, false]);
  expect(() => canRunOnHost("killed")).toThrow("`getconf GNU_LIBC_VERSION` was killed by SIGKILL");
});
