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
import { readFileSync } from "node:fs";
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

/**
 * A release config for a unix target, resolved the way the CI lane does.
 *
 * freebsd passes an explicit fake sysroot for the same reason
 * resolveWindowsCross passes a fake winsysroot: without one, resolveConfig
 * falls back to detectFreebsdSysroot(), which probes the filesystem and
 * throws when nothing is there. Only the Linux build image provisions
 * /opt/freebsd-sysroot, so this test would otherwise pass there and throw on
 * the darwin and Windows test agents. An explicit path is used verbatim, so
 * it never has to exist.
 */
function resolveUnixRelease(os: "linux" | "freebsd"): Config {
  return resolveConfig(
    {
      os,
      arch: "x64",
      ...(os === "linux" ? { abi: "gnu" as const } : { freebsdSysroot: "/fake/freebsd-sysroot" }),
      buildType: "Release",
      ci: true,
      buildkite: false,
    },
    mockToolchain({ cc: "/fake/llvm/bin/clang", cxx: "/fake/llvm/bin/clang++", ld: "/fake/llvm/bin/ld.lld" }),
  );
}

describe("release binary-size flags", () => {
  test("the always-on strip step passes --strip-all alone", () => {
    // GNU strip's strip level is a last-flag-wins enum: binutils' objcopy.c
    // assigns `strip_symbols` for each of --strip-all / --strip-debug /
    // --strip-unneeded, so a trailing --strip-debug silently DOWNGRADES
    // --strip-all to debug-only and leaves the symbol table behind.
    // --discard-all (locals) is subsumed by --strip-all. Neither may come back.
    const strip = computeFlags(resolveUnixRelease("linux")).stripflags;
    expect(strip).toContain("--strip-all");
    expect(strip).not.toContain("--strip-debug");
    expect(strip).not.toContain("--discard-all");
  });

  test("linux links the GNU hash table only; FreeBSD keeps the SysV one too", () => {
    const linux = computeFlags(resolveUnixRelease("linux")).ldflags;
    expect(linux).toContain("-Wl,--hash-style=gnu");
    expect(linux).not.toContain("-Wl,--hash-style=both");

    // FreeBSD deliberately keeps both: freebsdVersion is overridable below
    // the 14.3 default, nothing here is validated on FreeBSD hardware, and
    // `both` is a strict superset of `gnu`, so it can only cost size.
    expect(computeFlags(resolveUnixRelease("freebsd")).ldflags).toContain("-Wl,--hash-style=both");
  });
});

describe("src/bun.ico", () => {
  test("is a PNG-in-ICO, not an uncompressed DIB", () => {
    // llvm-rc embeds the .ico bytes into the Windows resource section
    // verbatim (see emitWindowsResources in scripts/build/bun.ts), so the
    // file's own encoding is what ships. PNG-in-ICO has been the standard
    // container for 256px icons since Vista; storing the 256x256 frame as a
    // raw BITMAPINFOHEADER DIB instead costs ~258 KB in every bun.exe.
    const ico = readFileSync(join(import.meta.dir, "..", "..", "src", "bun.ico"));

    // ICONDIR: reserved must be 0, type 1 = icon.
    expect({ reserved: ico.readUInt16LE(0), type: ico.readUInt16LE(2) }).toEqual({ reserved: 0, type: 1 });
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);

    // Every frame's payload must be a PNG. A DIB frame would start with its
    // 40-byte BITMAPINFOHEADER (biSize = 0x28), which is what the old asset
    // carried and exactly what must not come back.
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let payloadBytes = 0;
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const bytesInRes = ico.readUInt32LE(entry + 8);
      const imageOffset = ico.readUInt32LE(entry + 12);
      expect(ico.subarray(imageOffset, imageOffset + PNG_MAGIC.length)).toEqual(PNG_MAGIC);
      payloadBytes += bytesInRes;
    }

    // Container integrity: header + directory + payloads account for the file.
    expect(6 + count * 16 + payloadBytes).toBe(ico.length);
    // A PNG-encoded 256px icon is tens of KB; the uncompressed DIB was 264 KB.
    expect(ico.length).toBeLessThan(64 * 1024);
  });
});
