/**
 * Build-config regression tests for cross-compiling macOS binaries from a
 * non-darwin host (scripts/build/config.ts + flags.ts + macos-sdk.ts).
 *
 * These exercise the configure-time logic only — no compiler or SDK download
 * is involved — so they run on every platform. Scenarios that specifically
 * cover the "darwin target on a non-darwin host" path are skipped on macOS,
 * where the same inputs intentionally resolve to the native toolchain instead.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, tempDir } from "harness";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { webkit } from "../../scripts/build/deps/webkit.ts";
import { computeFlags } from "../../scripts/build/flags.ts";
import { MACOS_SDK_VERSION, macosSdkCachePath, resolveMacosSdkPath } from "../../scripts/build/macos-sdk.ts";
import { rustCanCrossFromLinux, rustTarget } from "../../scripts/build/rust.ts";

/** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-ar",
    ranlib: "/fake/llvm/bin/llvm-ranlib",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
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
    mt: undefined,
    nasm: undefined,
    ...overrides,
  };
}

/** Shorthand: resolve a config for a darwin target (cross on non-darwin hosts). */
function resolveDarwin(partial: PartialConfig = {}, toolchain = mockToolchain()): Config {
  return resolveConfig({ os: "darwin", arch: "aarch64", buildType: "Release", ...partial }, toolchain);
}

describe.skipIf(isMacOS)("macOS cross-compile config (non-darwin host)", () => {
  test("darwin target resolves to a cross-compile with ld64.lld and llvm-strip", () => {
    const cfg = resolveDarwin();
    expect(cfg.darwin).toBe(true);
    expect(cfg.crossTarget).toBe("arm64-apple-macosx");
    expect(cfg.osxDeploymentTarget).toBe("13.0");
    expect(cfg.osxSysroot).toBeDefined();
    expect(cfg.ld).toBe("/fake/llvm/bin/ld64.lld");
    expect(cfg.strip).toBe("/fake/llvm/bin/llvm-strip");

    const x64 = resolveDarwin({ arch: "x64" });
    expect(x64.crossTarget).toBe("x86_64-apple-macosx");
  });

  test("sanitizers and cross-language LTO are forced off for darwin cross builds", () => {
    const cfg = resolveDarwin({ asan: true, lto: true });
    expect(cfg.asan).toBe(false);
    expect(cfg.lto).toBe(true);
    expect(cfg.crossLangLto).toBe(false);
  });

  test("requires ld64.lld and llvm-strip from the toolchain", () => {
    expect(() => resolveDarwin({}, mockToolchain({ ld64Lld: undefined }))).toThrow(/ld64\.lld/);
    expect(() => resolveDarwin({}, mockToolchain({ llvmStrip: undefined }))).toThrow(/llvm-strip/);
  });

  test("rust-only mode skips SDK resolution (no Mach-O tools needed)", () => {
    const cfg = resolveDarwin({ mode: "rust-only" }, mockToolchain({ ld64Lld: undefined, llvmStrip: undefined }));
    expect(cfg.crossTarget).toBe("arm64-apple-macosx");
    expect(cfg.osxSysroot).toBeUndefined();
  });

  test("deployment target is overridable", () => {
    const cfg = resolveDarwin({ osxDeploymentTarget: "14.0" });
    expect(cfg.osxDeploymentTarget).toBe("14.0");
  });

  test("compile and link flags target the SDK through ld64.lld", () => {
    const cfg = resolveDarwin();
    const flags = computeFlags(cfg);

    expect(flags.cxxflags).toContain("--target=arm64-apple-macosx");
    expect(flags.cxxflags).toContain("-isysroot");
    expect(flags.cxxflags).toContain(`-mmacosx-version-min=${cfg.osxDeploymentTarget}`);
    // C++ uses Apple's libc++/libc headers from the SDK exclusively — every
    // default include dir is dropped so nothing from the build machine
    // (LLVM's libc++, a GCC libstdc++ install) can leak into the compile.
    expect(flags.cxxflags).toContain("-nostdinc");
    expect(flags.cxxflags).toContain(join(String(cfg.osxSysroot), "usr", "include", "c++", "v1"));
    expect(flags.cxxflags).toContain(join(String(cfg.osxSysroot), "usr", "include"));
    expect(flags.cxxflags).toContain(join(String(cfg.clangResourceDir), "include"));
    // No sanitizer runtimes exist for darwin targets in a Linux LLVM install.
    expect(flags.cxxflags.filter(f => f.startsWith("-fsanitize"))).toBeEmpty();

    expect(flags.ldflags).toContain("--target=arm64-apple-macosx");
    expect(flags.ldflags).toContain(`--ld-path=${cfg.ld}`);
    expect(flags.ldflags).toContain("-mlinker-version=705");
    // Apple-ld-only flag; ld64.lld parses it as -l d_new.
    expect(flags.ldflags).not.toContain("-Wl,-ld_new");
  });

  test("the __BUN sectalign workaround applies to x64 only", () => {
    const arm64 = computeFlags(resolveDarwin());
    const x64 = computeFlags(resolveDarwin({ arch: "x64" }));
    expect(x64.ldflags).toContain("-Wl,-sectalign,__BUN,__bun,0x1000");
    expect(arm64.ldflags).not.toContain("-Wl,-sectalign,__BUN,__bun,0x1000");
  });

  test("rust side cross-compiles to apple-darwin triples from linux", () => {
    const cfg = resolveDarwin();
    expect(rustTarget(cfg)).toBe("aarch64-apple-darwin");
    expect(rustCanCrossFromLinux(cfg)).toBe(true);
    expect(rustTarget(resolveDarwin({ arch: "x64" }))).toBe("x86_64-apple-darwin");
  });

  test("WebKit prebuilt resolves to the macOS tarball with a macos-keyed cache dir", () => {
    const cfg = resolveDarwin();
    const source = webkit.source(cfg);
    if (source.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${source.kind}`);
    expect(source.url).toContain("bun-webkit-macos-arm64.tar.gz");
    expect(source.destDir).toContain("-macos-arm64");

    const x64 = webkit.source(resolveDarwin({ arch: "x64" }));
    if (x64.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${x64.kind}`);
    expect(x64.url).toContain("bun-webkit-macos-amd64.tar.gz");
  });

  test("native linux configs are unaffected", () => {
    const cfg = resolveConfig(
      { os: "linux", arch: "x64", abi: "gnu", buildType: "Release" },
      mockToolchain({ ld64Lld: undefined, llvmStrip: undefined, dsymutil: undefined }),
    );
    expect(cfg.crossTarget).toBeUndefined();
    expect(cfg.osxSysroot).toBeUndefined();
    expect(cfg.ld).toBe("/fake/llvm/bin/ld.lld");
    expect(cfg.strip).toBe("/fake/bin/strip");

    const flags = computeFlags(cfg);
    expect(flags.cxxflags.some(f => f.includes("apple-macosx"))).toBe(false);
    expect(flags.cxxflags).not.toContain("-isysroot");
    expect(flags.cxxflags).not.toContain("-nostdinc");
  });
});

describe("macOS SDK resolution", () => {
  /** Minimal directory layout resolveMacosSdkPath() recognizes as an SDK. */
  function makeFakeSdk(root: string, name: string): string {
    const sdk = join(root, name);
    mkdirSync(join(sdk, "usr", "include", "sys"), { recursive: true });
    writeFileSync(join(sdk, "usr", "include", "sys", "syscall.h"), "#define SYS_fake 0\n");
    return sdk;
  }

  test("an explicit path must point at an SDK", () => {
    using dir = tempDir("macos-sdk-explicit", {});
    const sdk = makeFakeSdk(String(dir), "MacOSX15.5.sdk");
    expect(resolveMacosSdkPath(sdk, join(String(dir), "cache"), String(dir))).toBe(sdk);
    expect(() => resolveMacosSdkPath(join(String(dir), "nope"), join(String(dir), "cache"), String(dir))).toThrow(
      /macOS SDK not found/,
    );
  });

  test("MACOS_SDK_PATH is honored", () => {
    using dir = tempDir("macos-sdk-env", {});
    const sdk = makeFakeSdk(String(dir), "MacOSX14.5.sdk");
    const previous = process.env.MACOS_SDK_PATH;
    process.env.MACOS_SDK_PATH = sdk;
    try {
      expect(resolveMacosSdkPath(undefined, join(String(dir), "cache"), String(dir))).toBe(sdk);
    } finally {
      if (previous === undefined) delete process.env.MACOS_SDK_PATH;
      else process.env.MACOS_SDK_PATH = previous;
    }
  });

  test("falls back to an installed SDK or the pinned cache-dir download path", () => {
    using dir = tempDir("macos-sdk-fallback", {});
    const cacheDir = join(String(dir), "cache");
    const previous = process.env.MACOS_SDK_PATH;
    delete process.env.MACOS_SDK_PATH;
    try {
      const resolved = resolveMacosSdkPath(undefined, cacheDir, String(dir));
      // Machines with an SDK under /opt (or a previously cached download) get
      // that; everything else gets the deterministic auto-download location.
      if (resolved !== macosSdkCachePath(cacheDir)) {
        expect(existsSync(join(resolved, "usr", "include"))).toBe(true);
      } else {
        expect(resolved).toBe(join(cacheDir, `MacOSX${MACOS_SDK_VERSION}.sdk`));
      }
    } finally {
      if (previous !== undefined) process.env.MACOS_SDK_PATH = previous;
    }
  });
});
