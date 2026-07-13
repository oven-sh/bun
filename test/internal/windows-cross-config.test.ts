/**
 * Build-config regression tests for cross-compiling Windows binaries from a
 * non-Windows host (scripts/build/config.ts + flags.ts), with a focus on the
 * LTO configuration: Windows x64 cross builds use ThinLTO with cross-language
 * (Rust↔C++) LTO through rustc's bundled lld-link.
 *
 * These exercise the configure-time logic only — no compiler, sysroot, or
 * WebKit download is involved — so they run on every platform. Scenarios that
 * specifically cover the "windows target on a non-windows host" path are
 * skipped on Windows, where the same inputs intentionally resolve to the
 * native toolchain instead.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { join } from "node:path";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { webkit } from "../../scripts/build/deps/webkit.ts";
import { computeFlags } from "../../scripts/build/flags.ts";
import { rustCanCrossFromLinux, rustTarget } from "../../scripts/build/rust.ts";

/** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang-cl",
    cxx: "/fake/llvm/bin/clang-cl",
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-lib",
    ranlib: undefined,
    ld: "/fake/llvm/bin/lld-link",
    ld64Lld: undefined,
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/llvm/bin/llvm-strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    dsymutil: undefined,
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    bindgen: undefined,
    hostCc: undefined,
    hostCxx: undefined,
    msvcLinker: undefined,
    rc: "/fake/llvm/bin/llvm-rc",
    mt: undefined,
    nasm: "/fake/bin/nasm",
    ...overrides,
  };
}

/**
 * Shorthand: resolve a config for a Windows target the way the CI cross lane
 * does (`--profile=ci-release --os=windows --arch=<arch>`): Release + ci so
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
  test("ci release x64 cross builds default to non-LTO; --lto=on opts into ThinLTO with cross-language LTO", () => {
    const cfg = resolveWindowsCross();
    expect(cfg.windows).toBe(true);
    expect(cfg.crossTarget).toBe("x86_64-pc-windows-msvc");
    // Not the default: LLVM's ThinLTO backends miscompile JSC on x86-64 at
    // -O1+ (see the ltoDefault comment in config.ts).
    expect(cfg.lto).toBe(false);
    expect(cfg.crossLangLto).toBe(false);

    // The toolchain support is still wired up behind --lto=on.
    const opted = resolveWindowsCross({ lto: true });
    expect(opted.lto).toBe(true);
    // Rust↔C++ inlining: rustc emits bitcode (-Clinker-plugin-lto) and the
    // final lld-link runs one ThinLTO graph across both halves.
    expect(opted.crossLangLto).toBe(true);
  });

  test("no -lto WebKit prebuilt exists for arm64 or baseline — LTO is forced off there", () => {
    // arm64: LLVM's CodeView emitter aborts on ARM64 NEON tuple registers
    // during LTO codegen, so oven-sh/WebKit ships no windows-arm64-lto.
    const arm64 = resolveWindowsCross({ arch: "aarch64" });
    expect(arm64.lto).toBe(false);
    expect(arm64.crossLangLto).toBe(false);

    // baseline: no windows-amd64-baseline-lto variant.
    const baseline = resolveWindowsCross({ baseline: true });
    expect(baseline.lto).toBe(false);

    // Forced off even when explicitly requested, so the WebKit fetch never
    // 404s on a tarball that doesn't exist.
    expect(resolveWindowsCross({ arch: "aarch64", lto: true }).lto).toBe(false);
    expect(resolveWindowsCross({ baseline: true, lto: true }).lto).toBe(false);
  });

  test("local (non-ci) release builds stay non-LTO unless asked", () => {
    const local = resolveWindowsCross({ ci: false });
    expect(local.lto).toBe(false);
    const explicit = resolveWindowsCross({ ci: false, lto: true });
    expect(explicit.lto).toBe(true);
    expect(explicit.crossLangLto).toBe(true);
  });

  test("compile flags use clang-cl ThinLTO without whole-program vtables", () => {
    const flags = computeFlags(resolveWindowsCross({ lto: true }));
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

  test("the link uses rustc's lld-link sibling when rustc's LLVM is newer than clang's", () => {
    // resolveConfig swaps cfg.ld so lld-link can read the LLVM-22 bitcode
    // rustc emits under -Clinker-plugin-lto (bitcode is forward-compatible
    // only). rustc's gcc-ld/ ships every lld flavor; windows needs the
    // lld-link sibling of the host-flavored rust-lld that findRustLld()
    // resolves.
    using dir = tempDir("win-cross-rust-lld", {
      "gcc-ld/ld.lld": "",
      "gcc-ld/lld-link": "",
    });
    const rustLld = join(String(dir), "gcc-ld", "ld.lld");
    const cfg = resolveWindowsCross({ lto: true }, mockToolchain({ rustLld, rustLlvmVersion: "22.1.4" }));
    expect(cfg.ld).toBe(join(String(dir), "gcc-ld", "lld-link"));
    // Cargo-driven links (bun_shim_impl.exe) must NOT follow the swap: rustc
    // treats a linker inside its own gcc-ld/ as rust-lld and prepends
    // `-flavor link`, which breaks the wrapper. They keep the host lld-link.
    expect(cfg.msvcLinker).toBe("/fake/llvm/bin/lld-link");

    // Without LTO there's no bitcode skew to work around — keep the host
    // LLVM's lld-link.
    const plain = resolveWindowsCross({ lto: false }, mockToolchain({ rustLld, rustLlvmVersion: "22.1.4" }));
    expect(plain.ld).toBe("/fake/llvm/bin/lld-link");

    // If rustc's gcc-ld/ ever stops shipping lld-link, fall back to the host
    // lld-link — validateBunConfig() then reports the version skew at
    // configure time instead of an opaque "Invalid record" at link time.
    using bare = tempDir("win-cross-rust-lld-bare", { "gcc-ld/ld.lld": "" });
    const bareCfg = resolveWindowsCross(
      { lto: true },
      mockToolchain({ rustLld: join(String(bare), "gcc-ld", "ld.lld"), rustLlvmVersion: "22.1.4" }),
    );
    expect(bareCfg.ld).toBe("/fake/llvm/bin/lld-link");
  });

  test("LTO selects the -lto WebKit prebuilt with a windows-keyed cache dir", () => {
    const lto = webkit.source(resolveWindowsCross({ lto: true }));
    if (lto.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${lto.kind}`);
    expect(lto.url).toContain("bun-webkit-windows-amd64-lto.tar.gz");
    expect(lto.destDir).toContain("-windows");
    expect(lto.destDir).toEndWith("-lto");

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
    // The shared CI rust-only box intentionally does NOT take windows targets
    // (no winsysroot provisioned there) — the cross lanes do the full build,
    // including the cargo step, on their own agent.
    expect(rustCanCrossFromLinux(cfg)).toBe(false);
  });

  test("linux LTO config is unaffected", () => {
    const linux = resolveConfig(
      { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", ci: true, buildkite: false },
      mockToolchain({ cc: "/fake/llvm/bin/clang", cxx: "/fake/llvm/bin/clang++", ld: "/fake/llvm/bin/ld.lld" }),
    );
    expect(linux.lto).toBe(true);
    const linuxFlags = computeFlags(linux);
    expect(linuxFlags.cxxflags).toContain("-flto=full");
    expect(linuxFlags.cxxflags).toContain("-fwhole-program-vtables");
    expect(linuxFlags.cxxflags).not.toContain("-fno-split-lto-unit");
  });
});
