/**
 * Build-config regression tests for cross-compiling Windows binaries from a
 * non-Windows host (scripts/build/config.ts + flags.ts), with a focus on the
 * LTO configuration: Windows cross builds use ThinLTO with cross-language
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
import { mimalloc } from "../../../scripts/build/deps/mimalloc.ts";
import { webkit } from "../../../scripts/build/deps/webkit.ts";
import { computeDepFlags, computeFlags } from "../../../scripts/build/flags.ts";
import { rustTarget } from "../../../scripts/build/rust.ts";
import type { DirectBuild } from "../../../scripts/build/source.ts";
import { arm64PointerLoads, weakReferencesToVariables } from "../../../scripts/build/verify-binary.ts";

/** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang-cl",
    cxx: "/fake/llvm/bin/clang-cl",
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-lib",
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

  test("ci release arm64 cross builds are LTO too, unless turned off", () => {
    expect(resolveWindowsCross({ arch: "aarch64" }).lto).toBe(true);
    expect(resolveWindowsCross({ arch: "aarch64", lto: false }).lto).toBe(false);
  });

  test("LTO leaves mimalloc out of line, also where it overrides nothing", () => {
    const freebsd = resolveConfig(
      { os: "freebsd", arch: "x64", buildType: "Release", freebsdSysroot: "/fake" },
      mockToolchain(),
    );
    const darwin = resolveConfig(
      { os: "darwin", arch: "aarch64", buildType: "Release" },
      mockToolchain({
        ld64Lld: "/fake/llvm/bin/ld64.lld",
        dsymutil: "/fake/llvm/bin/dsymutil",
        clangResourceDir: "/fake/llvm/lib/clang/23",
      }),
    );
    for (const cfg of [resolveWindowsCross(), resolveWindowsCross({ arch: "aarch64" }), freebsd, darwin]) {
      expect((mimalloc.build(cfg) as DirectBuild).cflags).toContain("-fno-builtin-malloc");
    }
  });

  test("C and C++ outline their atomics on arm64, as rustc does", () => {
    for (const compute of [computeFlags, computeDepFlags]) {
      const { cflags, cxxflags } = compute(resolveWindowsCross({ arch: "aarch64" }));
      expect(cflags).toContain("/clang:-moutline-atomics");
      expect(cxxflags).toContain("/clang:-moutline-atomics");
      expect(compute(resolveWindowsCross()).cxxflags).not.toContain("/clang:-moutline-atomics");
    }
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
    const def = webkit.source(resolveWindowsCross({ aot: false }));
    if (def.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${def.kind}`);
    expect(def.url).toContain("bun-webkit-windows-amd64-lto.tar.gz");
    expect(def.destDir).toContain("-windows");
    expect(def.destDir).toEndWith("-lto");

    const plain = webkit.source(resolveWindowsCross({ lto: false, aot: false }));
    if (plain.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${plain.kind}`);
    expect(plain.url).toContain("bun-webkit-windows-amd64.tar.gz");
    expect(plain.destDir).not.toEndWith("-lto");

    const arm64 = webkit.source(resolveWindowsCross({ arch: "aarch64", aot: false }));
    if (arm64.kind !== "prebuilt") throw new Error(`expected prebuilt WebKit source, got ${arm64.kind}`);
    expect(arm64.url).toContain("bun-webkit-windows-arm64-lto.tar.gz");
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

  test("a link that generates the crates' code merges functions that have the same body", () => {
    // rustc does so by default, in its own pipeline. Under -Clinker-plugin-lto the linker generates the crates'
    // code, and LLVM's default there is off.
    const elf = "-Wl,-mllvm,-enable-merge-functions";
    const coff = "/mllvm:-enable-merge-functions";
    const linuxLdflags = (partial: PartialConfig) =>
      computeFlags(
        resolveConfig(
          { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", ci: true, linuxSysroot: "/fake", ...partial },
          mockToolchain({ cc: "/fake/llvm/bin/clang", cxx: "/fake/llvm/bin/clang++", ld: "/fake/llvm/bin/ld.lld" }),
        ),
      ).ldflags;

    expect(linuxLdflags({})).toContain(elf);
    // The crates are bitcode in the link with the C/C++ LTO off too.
    expect(linuxLdflags({ lto: false })).toContain(elf);
    // rustc generates the code itself, so its own default holds.
    expect(linuxLdflags({ lto: false, rustLto: false })).not.toContain(elf);
    expect(linuxLdflags({ buildType: "Debug" })).not.toContain(elf);

    const windows = computeFlags(resolveWindowsCross({ baseline: false })).ldflags;
    expect(windows).toContain(coff);
    expect(windows).not.toContain(elf);
    expect(computeFlags(resolveWindowsCross({ lto: false, rustLto: false })).ldflags).not.toContain(coff);
  });
});

describe("the check for weak references that LLVM miscompiles on arm64", () => {
  /** Code at 0x140001000 and 0x140003000, data at 0x140002000. `instructions` begin the second section of code. */
  function image(instructions: number[]): Buffer {
    const bytes = Buffer.alloc(0x800);
    const header = 0x40;
    bytes.writeUInt32LE(header, 0x3c);
    bytes.writeUInt16LE(3, header + 6);
    bytes.writeUInt16LE(0xf0, header + 20);
    bytes.writeBigUInt64LE(0x140000000n, header + 48);
    [0x60000020, 0x40000040, 0x60000020].forEach((characteristics, index) => {
      const section = header + 24 + 0xf0 + index * 40;
      bytes.writeUInt32LE(0x100, section + 8);
      bytes.writeUInt32LE(0x1000 * (index + 1), section + 12);
      bytes.writeUInt32LE(0x200, section + 16);
      bytes.writeUInt32LE(0x200 * (index + 1), section + 20);
      bytes.writeUInt32LE(characteristics, section + 36);
    });
    instructions.forEach((instruction, index) => bytes.writeUInt32LE(instruction, 0x600 + index * 4));
    return bytes;
  }
  const adrpX1 = { thisPage: 0x90000001, data: 0xf0ffffe1, otherCode: 0xd0ffffe1 };
  const ldrX1 = 0xf9401421; // ldr x1, [x1, #0x28]
  const movX2 = 0xaa0003e2; // mov x2, x0

  test.each([
    ["a slot", [adrpX1.data, ldrX1], 1, []],
    ["a function", [adrpX1.thisPage, ldrX1], 1, ["0x140003004 loads from 0x140003028"]],
    ["a function before it", [adrpX1.otherCode, ldrX1], 1, ["0x140003004 loads from 0x140001028"]],
    ["a function, later", [adrpX1.thisPage, movX2, movX2, ldrX1], 1, ["0x14000300c loads from 0x140003028"]],
    [
      "a function, much later",
      [adrpX1.thisPage, ...Array(24).fill(movX2), ldrX1],
      1,
      ["0x140003064 loads from 0x140003028"],
    ],
    [
      "a function, behind a branch and a vector register",
      [adrpX1.thisPage, 0x54000041 /* b.ne */, 0xfd400041 /* ldr d1, [x2] */, ldrX1],
      1,
      ["0x14000300c loads from 0x140003028"],
    ],
    [
      "a function, behind what looks like a load of a pair into the register",
      [
        adrpX1.thisPage,
        0xa9000440 /* stp x0, x1, [x2] */,
        0x6d400440 /* ldp d0, d1, [x2] */,
        0xa9400c40 /* ldp x0, x3, [x2] */,
        0xc8230440 /* stxp w3, x0, x1, [x2] */,
        0xf9400440 /* ldr x0, [x2, #8] */,
        0x8b430440 /* add x0, x2, x3, lsr #1 */,
        ldrX1,
      ],
      1,
      ["0x14000301c loads from 0x140003028"],
    ],
    ["what the register holds next", [adrpX1.thisPage, 0xaa0003e1 /* mov x1, x0 */, ldrX1], 0, []],
    ["nothing", [adrpX1.thisPage, 0x9100a021 /* add x1, x1, #0x28 */], 0, []],
  ])("a load from %s", (_, instructions, pointerLoads, fromCode) => {
    expect(arm64PointerLoads(image(instructions))).toEqual({ pointerLoads, fromCode });
  });

  test.each([
    ["ldp x0, x1, [x2]", 0xa9400440],
    ["ldp x0, x1, [x2, #16]!", 0xa9c10440],
    ["ldp x0, x1, [x2], #16", 0xa8c10440],
    ["ldp w0, w1, [x2]", 0x29400440],
    ["ldnp x0, x1, [x2]", 0xa8400440],
    ["ldpsw x0, x1, [x2]", 0x69400440],
    ["ldxp x0, x1, [x2]", 0xc87f0440],
    ["ldaxp x0, x1, [x2]", 0xc87f8440],
  ])("a load from what %s puts in its second register", (_, pair) => {
    expect(arm64PointerLoads(image([adrpX1.thisPage, pair, ldrX1]))).toEqual({ pointerLoads: 0, fromCode: [] });
  });

  test.each(["\n", "\r\n"])("a reference to a variable, with lines that end in %j", end => {
    const references = ["variable", "constant", "func", "native", "missing"].map(
      name => `C:\\a.lib:a.obj:                  (undefined) weak external ${name}`,
    );
    const definitions = [
      "b.obj: ---------------- (LTO,DATA) external variable",
      "b.obj: ---------------- (LTO,RODATA) weak external constant",
      "b.obj: ---------------- (LTO,CODE) external func",
      "b.obj: ---------------- (LTO,DATA) external strong",
      "b.obj:                  (undefined) external strong",
      "c.obj: 00000000 00000000 R native",
    ];
    expect(weakReferencesToVariables([references.join(end) + end, definitions.join(end) + end])).toEqual([
      "variable in C:\\a.lib:a.obj",
      "constant in C:\\a.lib:a.obj",
    ]);
  });
});
