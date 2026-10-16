/**
 * Build-config regression tests for cross-compiling Windows binaries from a
 * non-Windows host (scripts/build/config.ts + flags.ts), with a focus on the
 * LTO configuration: Windows x64 cross builds use ThinLTO with cross-language
 * (Rust↔C++) LTO through lld-link.
 *
 * These exercise the configure-time logic only — no compiler, sysroot, or
 * WebKit download is involved — so they run on every platform. Scenarios that
 * specifically cover the "windows target on a non-windows host" path are
 * skipped on Windows, where the same inputs intentionally resolve to the
 * native toolchain instead.
 */
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../../scripts/build/config.ts";
import { webkit } from "../../../scripts/build/deps/webkit.ts";
import { computeFlags } from "../../../scripts/build/flags.ts";
import { rustTarget } from "../../../scripts/build/rust.ts";

/** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang-cl",
    cxx: "/fake/llvm/bin/clang-cl",
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-lib",
    ranlib: undefined,
    ld: "/fake/llvm/bin/lld-link",
    ld64Lld: undefined,
    rustLlvmVersion: "23.1.1",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/llvm/bin/llvm-strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    readobj: "/fake/llvm/bin/llvm-readobj",
    objdump: "/fake/llvm/bin/llvm-objdump",
    cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
    dsymutil: undefined,
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: "/fake/llvm/bin/llvm-rc",
    mt: undefined,
    nasm: "/fake/bin/nasm",
    ...overrides,
  } as Toolchain;
}

/**
 * Shorthand: resolve a config for a Windows target the way the CI cross lane
 * does (`--profile=ci-build --os=windows --arch=<arch>`): Release + ci so
 * the LTO default applies, with an explicit fake sysroot so the local-build
 * "create one with xwin" error never triggers.
 */
function resolveWindowsCross(partial: PartialConfig = {}, toolchain = mockToolchain()): Config {
  return resolveConfig(
    {
      os: "windows",
      arch: "x64",
      buildType: "Release",
      ci: true,
      buildkite: false,
      winsysroot: "/fake/winsysroot",
      ...partial,
    },
    toolchain,
  );
}

describe.skipIf(isWindows)("Windows cross-compile LTO config (non-windows host)", () => {
  test("ci release x64 cross builds default to ThinLTO with cross-language LTO", () => {
    const cfg = resolveWindowsCross();
    expect(cfg.windows).toBe(true);
    expect(cfg.crossTarget).toBe("x86_64-pc-windows-msvc");
    // Rust↔C++ inlining comes with it: rustc emits bitcode (-Clinker-plugin-lto) and the
    // final lld-link runs one ThinLTO graph across both halves.
    expect(cfg.lto).toBe(true);
  });

  test("no -lto WebKit prebuilt exists for arm64 — LTO is forced off there", () => {
    // arm64: LLVM's CodeView emitter aborts on ARM64 NEON tuple registers
    // during LTO codegen, so oven-sh/WebKit ships no windows-arm64-lto.
    const arm64 = resolveWindowsCross({ arch: "aarch64" });
    expect(arm64.lto).toBe(false);
    // Forced off even when explicitly requested, so the WebKit fetch never
    // 404s on a tarball that doesn't exist.
    expect(resolveWindowsCross({ arch: "aarch64", lto: true }).lto).toBe(false);
  });

  test("local (non-ci) release builds are LTO too, unless turned off", () => {
    const local = resolveWindowsCross({ ci: false, baseline: false });
    expect(local.lto).toBe(true);
    expect(resolveWindowsCross({ ci: false, lto: false }).lto).toBe(false);
  });

  test("compile flags use clang-cl ThinLTO without whole-program vtables", () => {
    const flags = computeFlags(resolveWindowsCross({ lto: true, baseline: false }));
    expect(flags.cxxflags).toContain("-flto=thin");
    expect(flags.cflags).toContain("-flto=thin");
    // Every summaried module must agree on EnableSplitLTOUnit; rustc's
    // bitcode says 0, so the C/C++ side must too.
    expect(flags.cxxflags).toContain("-fno-split-lto-unit");
    expect(flags.cflags).toContain("-fno-split-lto-unit");
    // WPD drops vtable symbols that COFF associative COMDAT sections still
    // reference and the LTO codegen aborts — never passed on Windows.
    expect(flags.cxxflags).not.toContain("-fwhole-program-vtables");
    expect(flags.cxxflags).not.toContain("-fforce-emit-vtables");
    // The unix link-side LTO spellings must not leak into lld-link's flags
    // (everything after /link is parsed as MSVC-style options).
    expect(flags.ldflags.some(f => f.includes("-flto"))).toBe(false);
    expect(flags.ldflags.some(f => f.includes("--lto-O"))).toBe(false);

    // Non-LTO windows configs get none of the LTO flags.
    const plain = computeFlags(resolveWindowsCross({ lto: false }));
    expect(plain.cxxflags.some(f => f.includes("-flto"))).toBe(false);
    expect(plain.cxxflags).not.toContain("-fno-split-lto-unit");
  });

  test("the link uses the LLVM toolchain's lld-link, with and without LTO", () => {
    for (const lto of [true, false]) {
      expect(resolveWindowsCross({ lto, baseline: false }).ld).toBe("/fake/llvm/bin/lld-link");
    }
  });

  test("LTO selects the -lto WebKit prebuilt with a windows-keyed cache dir", () => {
    // Default windows x64 cross config (baseline=true, lto=true): every x64
    // WebKit is built at the nehalem floor, so the plain -lto tarball is the
    // one baseline fetches too.
    const def = webkit.source(resolveWindowsCross());
    if (def.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${def.kind}`);
    expect(def.url).toContain("bun-webkit-windows-amd64-lto.tar.gz");
    expect(def.destDir).toContain("-windows");
    expect(def.destDir).toEndWith("-lto");

    const plain = webkit.source(resolveWindowsCross({ lto: false }));
    if (plain.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${plain.kind}`);
    expect(plain.url).toContain("bun-webkit-windows-amd64.tar.gz");
    expect(plain.destDir).not.toEndWith("-lto");

    const arm64 = webkit.source(resolveWindowsCross({ arch: "aarch64" }));
    if (arm64.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${arm64.kind}`);
    expect(arm64.url).toContain("bun-webkit-windows-arm64.tar.gz");
  });

  test("rust side targets pc-windows-msvc triples", () => {
    const cfg = resolveWindowsCross();
    expect(rustTarget(cfg)).toBe("x86_64-pc-windows-msvc");
    expect(rustTarget(resolveWindowsCross({ arch: "aarch64" }))).toBe("aarch64-pc-windows-msvc");
  });

  test("linux LTO config uses ThinLTO with WPD and no-split-lto-unit", () => {
    const linux = resolveConfig(
      { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", ci: true, buildkite: false, linuxSysroot: "/fake" },
      mockToolchain({ cc: "/fake/llvm/bin/clang", cxx: "/fake/llvm/bin/clang++", ld: "/fake/llvm/bin/ld.lld" }),
    );
    expect(linux.lto).toBe(true);
    const linuxFlags = computeFlags(linux);
    expect(linuxFlags.cxxflags).toContain("-flto=thin");
    expect(linuxFlags.cxxflags).toContain("-fwhole-program-vtables");
    // rustc bitcode says EnableSplitLTOUnit=0; clang must match so lld doesn't
    // reject with "inconsistent LTO Unit splitting". WPD falls back to
    // index-only mode (still devirtualizes, just without the hybrid split).
    expect(linuxFlags.cxxflags).toContain("-fno-split-lto-unit");
  });
});
