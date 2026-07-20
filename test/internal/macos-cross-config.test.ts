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
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { webkit } from "../../scripts/build/deps/webkit.ts";
import { parsePackedFeaturesList } from "../../scripts/build/features-json.ts";
import { computeFlags, DARWIN_STACK_SIZE } from "../../scripts/build/flags.ts";
import { MACOS_SDK_VERSION, macosSdkCachePath, resolveMacosSdkPath } from "../../scripts/build/macos-sdk.ts";
import { rustTarget } from "../../scripts/build/rust.ts";
import { machoEntitlementsPlist, machoPostlinkCommand } from "../../scripts/build/shims.ts";

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

  test("sanitizers are forced off for darwin cross builds; LTO is not", () => {
    const cfg = resolveDarwin({ asan: true, lto: true });
    // No darwin ASAN runtime dylibs in a Linux LLVM install.
    expect(cfg.asan).toBe(false);
    expect(cfg.lto).toBe(true);
    // Cross-language LTO tracks lto, same as Linux: rustc's gcc-ld/ld64.lld
    // (the Mach-O flavor of rust-lld) handles the bitcode-version skew.
    expect(cfg.crossLangLto).toBe(true);
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

  test("arm64 cross links reserve an ad-hoc code signature; x64 ships unsigned", () => {
    // arm64 macOS refuses to exec unsigned binaries, so the linker must emit
    // an LC_CODE_SIGNATURE for macho-postlink to replace after the stack-size
    // patch. x64 deliberately ships unsigned, matching the native x64 build
    // (Apple's ld only auto-signs arm64) — the CodeDirectory would cost ~0.8%
    // of the binary for nothing.
    expect(computeFlags(resolveDarwin()).ldflags).toContain("-Wl,-adhoc_codesign");
    expect(computeFlags(resolveDarwin({ arch: "x64" })).ldflags).not.toContain("-Wl,-adhoc_codesign");
  });

  test("cross release links get safe ICF backed by the address-significance table", () => {
    // Apple's ld has no ICF, so this is an lld-only win. `safe` needs the
    // __llvm_addrsig section from -faddrsig (off by default for Mach-O,
    // unlike ELF) to know which functions never have their address taken —
    // without it lld treats everything as address-significant and folds
    // nothing.
    const release = computeFlags(resolveDarwin());
    expect(release.cflags).toContain("-faddrsig");
    expect(release.ldflags).toContain("-Wl,--icf=safe");

    // Debug: no ICF (matches the Linux gating), but the addrsig table is
    // harmless and keeps the compile flags identical across profiles.
    const debug = computeFlags(resolveDarwin({ buildType: "Debug", assertions: true }));
    expect(debug.cflags).toContain("-faddrsig");
    expect(debug.ldflags).not.toContain("-Wl,--icf=safe");
  });

  test("link and strip commands run macho-postlink with the stack size and entitlements", () => {
    // ld64.lld doesn't implement -stack_size and the linker's ad-hoc
    // signature carries no entitlements — both are fixed up post-link by
    // shims/macho-postlink.c, appended to the link/strip rule commands.
    const release = resolveDarwin();
    const releaseCmd = machoPostlinkCommand(release);
    expect(releaseCmd).toStartWith(" && ");
    expect(releaseCmd).toContain(`macho-postlink $out --stack-size=${DARWIN_STACK_SIZE}`);
    expect(releaseCmd).toContain(`--entitlements=${join(release.cwd, "entitlements.plist")}`);
    // The linker flag stays (it self-obsoletes the workaround once ld64.lld
    // implements it) and must agree with what the patcher writes.
    expect(computeFlags(release).ldflags).toContain(`-Wl,-stack_size,${DARWIN_STACK_SIZE}`);

    // x64 ships unsigned: the stack size is still patched but no
    // entitlements are embedded (there is no signature to embed them into).
    const x64Cmd = machoPostlinkCommand(resolveDarwin({ arch: "x64" }));
    expect(x64Cmd).toContain(`macho-postlink $out --stack-size=${DARWIN_STACK_SIZE}`);
    expect(x64Cmd).not.toContain("--entitlements");

    // Debug builds sign with the debug entitlements (adds get-task-allow /
    // cs.debugger so lldb can attach), mirroring scripts/trace.sh.
    const debug = resolveDarwin({ buildType: "Debug", assertions: true });
    expect(machoEntitlementsPlist(debug)).toBe(join(debug.cwd, "entitlements.debug.plist"));

    // Both plists must exist — the link command references them by path.
    expect(existsSync(machoEntitlementsPlist(release))).toBe(true);
    expect(existsSync(machoEntitlementsPlist(debug))).toBe(true);
  });

  test("native links don't get a postlink command", () => {
    const linux = resolveConfig(
      { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", linuxSysroot: "/fake" },
      mockToolchain({ ld64Lld: undefined, llvmStrip: undefined, dsymutil: undefined }),
    );
    expect(machoPostlinkCommand(linux)).toBe("");
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

  test("linux configs don't pick up darwin cross machinery", () => {
    const cfg = resolveConfig(
      { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", linuxSysroot: "/fake" },
      mockToolchain({ ld64Lld: undefined, llvmStrip: undefined, dsymutil: undefined }),
    );
    expect(cfg.osxSysroot).toBeUndefined();
    expect(cfg.ld).toBe("/fake/llvm/bin/ld.lld");

    const flags = computeFlags(cfg);
    expect(flags.cxxflags.some(f => f.includes("apple-macosx"))).toBe(false);
    expect(flags.cxxflags).not.toContain("-isysroot");
    expect(flags.cxxflags).not.toContain("-nostdinc");
  });
});

describe("host-side features.json for cross-compiled binaries", () => {
  // Cross lanes can't run the binary they just linked, so features.json is
  // generated by parsing PACKED_FEATURES_LIST out of src/analytics/lib.rs
  // instead of asking the binary. The list maps crash-report bit indices to
  // feature names — order matters. This pins the parser against what the
  // *actual* binary built from the same source tree reports, so a macro
  // reshape that breaks the parser fails here instead of silently shipping
  // a misaligned feature table.
  test("parsed feature list matches crash_handler.getFeatureData() exactly", async () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    const parsed = parsePackedFeaturesList(repoRoot);
    expect(parsed.length).toBeGreaterThan(0);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { crash_handler } = require("bun:internal-for-testing"); console.log(JSON.stringify(crash_handler.getFeatureData().features));`,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      expect(stderr).toBe("");
    }
    expect(exitCode).toBe(0);
    expect(parsed).toEqual(JSON.parse(stdout));
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

  test("a stale cached SDK does not shadow the pinned version", () => {
    using dir = tempDir("macos-sdk-stale-cache", {});
    const cacheDir = join(String(dir), "cache");
    // Leftover auto-download from an older MACOS_SDK_VERSION pin.
    const stale = makeFakeSdk(cacheDir, "MacOSX14.0.sdk");
    const previous = process.env.MACOS_SDK_PATH;
    delete process.env.MACOS_SDK_PATH;
    try {
      const resolved = resolveMacosSdkPath(undefined, cacheDir, String(dir));
      // The stale download must never win — after a version bump the pinned
      // SDK is fetched instead of silently reusing the old one (which would
      // surface as undefined-symbol link errors, not a clear message).
      expect(resolved).not.toBe(stale);
      if (resolved.startsWith(String(dir))) {
        // No SDK installed under /opt on this machine, so the cache-dir
        // fallback was taken: it must be the pinned path.
        expect(resolved).toBe(macosSdkCachePath(cacheDir));
      }
    } finally {
      if (previous !== undefined) process.env.MACOS_SDK_PATH = previous;
    }
  });
});
