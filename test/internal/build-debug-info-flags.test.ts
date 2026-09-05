/**
 * Pins the order of the debug-info flags in scripts/build/flags.ts.
 *
 * clang takes the debug-info level from the LAST -g flag on the command line,
 * and -glldb (a tuning flag) counts as one: it resets the level to full and,
 * for lldb tuning, to the standalone kind. The tables used to emit `-g1 ...
 * -glldb` for release builds, so `clang -###` showed
 * `-debug-info-kind=standalone` and every release TU (deps included) carried
 * full DWARF instead of the line tables the `-g1` entry asks for. The level
 * flag has to be the last -g flag the tables emit, for bun's own flags and for
 * the flags forwarded to deps.
 *
 * Pure config evaluation: no compiler needed, runs on every host.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, tempDir } from "harness";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { computeDepFlags, computeFlags } from "../../scripts/build/flags.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    readobj: "/fake/llvm/bin/llvm-readobj",
    objdump: "/fake/llvm/bin/llvm-objdump",
    cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    jsRuntimeArgv: ["/fake/bin/bun"],
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

/**
 * A linux-x64 target resolves on every host once it is told where its sysroot
 * is (the path is only recorded, never opened).
 */
function linuxConfig(partial: PartialConfig, buildDir: string): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildDir, linuxSysroot: buildDir, ...partial },
    mockToolchain(),
  );
}

/**
 * The -g flags that set the debug-info level or kind, in command-line order.
 * `-gz=` only selects section compression and is excluded.
 */
function levelFlags(flags: string[]): string[] {
  return flags.filter(f => f.startsWith("-g") && !f.startsWith("-gz"));
}

/** Every flag list a config produces that reaches a compiler: bun's C and C++ flags and the deps' C and C++ flags. */
function allCompileFlagLists(cfg: Config): string[][] {
  const bun = computeFlags(cfg);
  const deps = computeDepFlags(cfg);
  return [bun.cflags, bun.cxxflags, deps.cflags, deps.cxxflags];
}

describe("debug-info flag order", () => {
  test("release + LTO: -g1 is the last -g flag, after -glldb, for bun and for deps", () => {
    using dir = tempDir("build-debug-info", {});
    const cfg = linuxConfig({ buildType: "Release", lto: true }, String(dir));
    for (const flags of allCompileFlagLists(cfg)) {
      expect(levelFlags(flags)).toEqual(["-glldb", "-g1"]);
      // Line tables carry no types, so there is nothing to home.
      expect(flags).not.toContain("-fno-standalone-debug");
    }
  });

  test("release without LTO: full, homed debug info", () => {
    using dir = tempDir("build-debug-info", {});
    for (const partial of [
      { buildType: "Release", lto: false },
      { buildType: "Release", asan: true },
    ] as const) {
      const cfg = linuxConfig(partial, String(dir));
      expect(cfg.lto).toBe(false);
      for (const flags of allCompileFlagLists(cfg)) {
        expect(levelFlags(flags)).toEqual(["-glldb", "-g"]);
        expect(flags.indexOf("-gz=zstd")).toBe(flags.indexOf("-g") + 1);
        expect(flags).toContain("-fno-standalone-debug");
      }
    }
  });

  test("debug: -g3 is the last -g flag, after -glldb, homed, for bun and for deps", () => {
    using dir = tempDir("build-debug-info", {});
    const cfg = linuxConfig({ buildType: "Debug" }, String(dir));
    for (const flags of allCompileFlagLists(cfg)) {
      expect(levelFlags(flags)).toEqual(["-glldb", "-g3"]);
      // The compression flag stays attached to the level flag it belongs to.
      expect(flags.indexOf("-gz=zstd")).toBe(flags.indexOf("-g3") + 1);
      expect(flags).toContain("-fno-standalone-debug");
    }
  });

  // Cross-config path only: on macOS, resolveConfig({ os: "darwin" }) probes
  // xcode-select for the real SDK. The flag tables are the same either way.
  test.skipIf(isMacOS)("darwin release + LTO: the DWARF version flag comes first and -g1 still ends the list", () => {
    using dir = tempDir("build-debug-info", {});
    const cfg = resolveConfig(
      { os: "darwin", arch: "aarch64", buildType: "Release", lto: true, buildDir: String(dir) },
      mockToolchain(),
    );
    for (const flags of allCompileFlagLists(cfg)) {
      expect(levelFlags(flags)).toEqual(["-gdwarf-4", "-glldb", "-g1"]);
    }
  });
});
