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
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";

import { generateCargoConfig } from "../../../scripts/build/cargo-config.ts";
import { registerCompileRules } from "../../../scripts/build/compile.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../../scripts/build/config.ts";
import { webkit } from "../../../scripts/build/deps/webkit.ts";
import { BuildError } from "../../../scripts/build/error.ts";
import { computeFlags } from "../../../scripts/build/flags.ts";
import { Ninja } from "../../../scripts/build/ninja.ts";
import { rustTarget } from "../../../scripts/build/rust.ts";
import { registerDepRules, resolveDep } from "../../../scripts/build/source.ts";
import {
  ensureWindowsSysroot,
  publishToCache,
  stagingBeside,
  UCRT_SERVICING_VERSION,
  windowsSysrootCachePath,
} from "../../../scripts/build/winsysroot.ts";

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
    rc: "/fake/llvm/bin/llvm-rc",
    mt: undefined,
    nasm: "/fake/bin/nasm",
    ...overrides,
  };
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
    expect(cfg.lto).toBe(true);
    // Rust↔C++ inlining: rustc emits bitcode (-Clinker-plugin-lto) and the
    // final lld-link runs one ThinLTO graph across both halves.
    expect(cfg.crossLangLto).toBe(true);
  });

  test("no -lto WebKit prebuilt exists for arm64 — LTO is forced off there", () => {
    // arm64: LLVM's CodeView emitter aborts on ARM64 NEON tuple registers
    // during LTO codegen, so oven-sh/WebKit ships no windows-arm64-lto.
    const arm64 = resolveWindowsCross({ arch: "aarch64" });
    expect(arm64.lto).toBe(false);
    expect(arm64.crossLangLto).toBe(false);
    // Forced off even when explicitly requested, so the WebKit fetch never
    // 404s on a tarball that doesn't exist.
    expect(resolveWindowsCross({ arch: "aarch64", lto: true }).lto).toBe(false);
  });

  test("local (non-ci) release builds are LTO too, unless turned off", () => {
    const local = resolveWindowsCross({ ci: false, baseline: false });
    expect(local.lto).toBe(true);
    expect(local.crossLangLto).toBe(true);
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
    const cfg = resolveWindowsCross(
      { lto: true, baseline: false },
      mockToolchain({ rustLld, rustLlvmVersion: "22.1.4" }),
    );
    expect(cfg.ld).toBe(join(String(dir), "gcc-ld", "lld-link"));
    // rustc-driven links (the .bin/ shim's executable) must NOT follow the swap: rustc
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
      { lto: true, baseline: false },
      mockToolchain({ rustLld: join(String(bare), "gcc-ld", "ld.lld"), rustLlvmVersion: "22.1.4" }),
    );
    expect(bareCfg.ld).toBe("/fake/llvm/bin/lld-link");
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

// Only the refusals: an accepted fetch is a download from Microsoft.
describe("Microsoft's licenses", () => {
  const sysroot = basename(windowsSysrootCachePath("/"));
  const cachedSysroot = {
    [`${sysroot}/Windows Kits/10/Include/10.0.1/um/windows.h`]: "",
    [`${sysroot}/Windows Kits/10/Lib/10.0.1/um/x64/kernel32.lib`]: "",
    [`${sysroot}/VC/Tools/MSVC/14.0/include/atlstr.h`]: "",
  };
  const cachedUcrt = {
    [`ucrt-servicing-${UCRT_SERVICING_VERSION}/x64/libucrt.lib`]: "",
    [`ucrt-servicing-${UCRT_SERVICING_VERSION}/x64/ucrt.lib`]: "",
  };
  /** What `ensureWindowsSysroot` says to a person's build that has `cacheDir` and has not accepted anything. */
  const ensure = (cacheDir: string): Promise<unknown> =>
    ensureWindowsSysroot({
      ...resolveWindowsCross({ ci: false }),
      cacheDir,
      winsysroot: windowsSysrootCachePath(cacheDir),
    }).then(
      () => "nothing to fetch",
      error => error,
    );

  test("only CI accepts them without being told to", () => {
    expect(resolveWindowsCross({ ci: false }).acceptMicrosoftLicenses).toBe(false);
    expect(resolveWindowsCross({ ci: false, acceptMicrosoftLicenses: true }).acceptMicrosoftLicenses).toBe(true);
    expect(resolveWindowsCross({ ci: true }).acceptMicrosoftLicenses).toBe(true);
    expect(resolveWindowsCross({ ci: false, buildkite: true }).acceptMicrosoftLicenses).toBe(true);
  });

  test("an empty cache fails the build, naming both and the flag, with nothing fetched", async () => {
    using dir = tempDir("winsysroot", {});
    const error = await ensure(String(dir));
    expect(error).toBeInstanceOf(BuildError);
    expect((error as BuildError).hint).toContain("https://go.microsoft.com/fwlink/?LinkId=2086102");
    expect((error as BuildError).hint).toContain("https://aka.ms/WinSDKLicenseURL");
    expect((error as BuildError).hint).toContain("--accept-microsoft-licenses");
    expect(readdirSync(String(dir))).toEqual([]);
  });

  test("so does a cache with the sysroot but not the serviced UCRT, which is a download of its own", async () => {
    using dir = tempDir("winsysroot", cachedSysroot);
    expect(await ensure(String(dir))).toBeInstanceOf(BuildError);
    expect(readdirSync(String(dir))).toEqual([sysroot]);
  });

  test("a cache with both is not asked about", async () => {
    using dir = tempDir("winsysroot", { ...cachedSysroot, ...cachedUcrt });
    expect(await ensure(String(dir))).toBe("nothing to fetch");
  });
});

describe("publishing a fetch to a cache other builds share", () => {
  const isComplete = (dir: string) => existsSync(join(dir, "done"));
  const publish = (dir: string) => publishToCache(join(dir, "staged"), join(dir, "dest"), isComplete);

  test("puts it where there is nothing, or something unfinished", () => {
    using dir = tempDir("publish", { "staged/done": "", "staged/from": "this build", "dest/half": "" });
    publish(String(dir));
    expect(readdirSync(join(String(dir), "dest")).sort()).toEqual(["done", "from"]);
    expect(existsSync(join(String(dir), "staged"))).toBe(false);
  });

  test("leaves alone what a faster build published, which that build is reading by now", () => {
    using dir = tempDir("publish", {
      "staged/done": "",
      "staged/from": "this build",
      "dest/done": "",
      "dest/from": "the faster build",
    });
    publish(String(dir));
    expect(readFileSync(join(String(dir), "dest", "from"), "utf8")).toBe("the faster build");
  });

  test("says so when it cannot, and nobody else has", () => {
    using dir = tempDir("publish", { "dest/half": "" });
    expect(() => publish(String(dir))).toThrow(BuildError);
  });

  /** A rename that fails with `code` the first `failures` times it is asked. */
  const reluctant = (code: string, failures: number) => {
    const rename = Object.assign(
      (from: string, to: string) => {
        if (++rename.calls <= failures) throw Object.assign(new Error(code), { code });
        renameSync(from, to);
      },
      { calls: 0 },
    );
    return rename;
  };

  test("tries again while something holds the new files open, as an antivirus does on Windows", () => {
    using dir = tempDir("publish", { "staged/done": "" });
    const rename = reluctant("EPERM", 2);
    publishToCache(join(String(dir), "staged"), join(String(dir), "dest"), isComplete, rename);
    expect(rename.calls).toBe(3);
    expect(isComplete(join(String(dir), "dest"))).toBe(true);
  });

  test("does not try again what trying again cannot help", () => {
    using dir = tempDir("publish", { "staged/done": "" });
    const rename = reluctant("ENOSPC", 1);
    expect(() => publishToCache(join(String(dir), "staged"), join(String(dir), "dest"), isComplete, rename)).toThrow(
      BuildError,
    );
    expect(rename.calls).toBe(1);
  });
});

describe("the directory a fetch is staged in", () => {
  test("is this process's own, and empty even if one of that name was left", () => {
    using dir = tempDir("staging", { [`dest.staging-${process.pid}/left`]: "" });
    const staging = stagingBeside(join(String(dir), "dest"));
    expect(staging).toBe(join(String(dir), `dest.staging-${process.pid}`));
    expect(readdirSync(staging)).toEqual([]);
  });

  test("replaces what interrupted fetches left, and leaves alone a fetch that is running", () => {
    const gone = Bun.spawnSync({ cmd: [bunExe(), "-e", ""], env: bunEnv }).pid;
    using dir = tempDir("staging", {
      [`dest.staging-${gone}/dl/package`]: "",
      [`dest.staging-${process.ppid}/dl/package`]: "",
      "dest.staging-notapid/x": "",
      [`other.staging-${gone}/x`]: "",
      "dest/x": "",
    });
    stagingBeside(join(String(dir), "dest"));
    expect(readdirSync(String(dir)).sort()).toEqual(
      ["dest", `dest.staging-${process.pid}`, `dest.staging-${process.ppid}`, `other.staging-${gone}`].sort(),
    );
  });
});

describe("Windows sysroot flags", () => {
  const on = (os: "windows" | "linux", root: string): Config => ({
    ...resolveWindowsCross(),
    host: { os, arch: "x64", exeSuffix: os === "windows" ? ".exe" : "" },
    winsysroot: `${root}winsysroot`,
    cacheDir: `${root}cache`,
  });

  test("are quoted for the shell of the host that runs them", () => {
    const windows = computeFlags(on("windows", "C:\\build cache\\"));
    expect(windows.cflags).toContain('"C:\\build cache\\winsysroot"');
    expect(windows.ldflags).toContain('"/winsysroot:C:\\build cache\\winsysroot"');
    expect(windows.ldflags.filter(f => f.includes("ucrt-servicing"))).toEqual([
      expect.stringMatching(/^"\/libpath:C:\\build cache\\cache.ucrt-servicing-[\d.]+.x64"$/),
    ]);

    const linux = computeFlags(on("linux", "/build cache/"));
    expect(linux.cflags).toContain("'/build cache/winsysroot'");
    expect(linux.ldflags).toContain("'/winsysroot:/build cache/winsysroot'");
  });

  // Unset, clang-cl finds an installed Visual Studio and links its CRT instead, and nothing fails.
  test("the link sets LIB on a Windows host, where the driver would otherwise look for Visual Studio", () => {
    const linkCommand = (cfg: Config) => {
      const n = new Ninja({ buildDir: cfg.buildDir });
      registerCompileRules(n, cfg);
      const lines = n.toString().split("\n");
      return lines[lines.indexOf("rule link") + 1]!.trim();
    };
    const driver = "/fake/llvm/bin/clang-cl /nologo -fuse-ld=lld";
    expect(linkCommand(on("windows", "C:\\build cache\\"))).toStartWith(
      `command = cmd /c "set "LIB=C:\\build cache\\winsysroot"&& ${driver} `,
    );
    expect(linkCommand(on("linux", "/cache/"))).toStartWith(`command = ${driver} `);
    expect(linkCommand({ ...on("windows", "C:\\"), winsysroot: undefined })).toStartWith(`command = ${driver} `);
  });

  test("cargo run by hand on a Windows host links its build scripts and proc-macros the same way", () => {
    using dir = tempDir("cargo-config", {});
    const generated = (cfg: Config) => readFileSync(generateCargoConfig({ ...cfg, cwd: String(dir) }), "utf8");
    expect(generated(on("windows", "C:\\build cache\\"))).toContain(
      [
        "[target.x86_64-pc-windows-msvc]  # host",
        'linker = "/fake/llvm/bin/lld-link"',
        'rustflags = ["-C", "link-arg=/winsysroot:C:\\\\build cache\\\\winsysroot"]',
      ].join("\n"),
    );
    expect(generated(on("linux", "/cache/"))).not.toContain("windows-msvc");
    expect(generated({ ...on("windows", "C:\\"), winsysroot: undefined })).not.toContain("windows-msvc");
  });

  test("a dependency cargo builds gets it in CARGO_ENCODED_RUSTFLAGS, which replaces that file's rustflags", () => {
    const cargoEdge = (base: Config) => {
      const cfg = { ...base, cargo: "/fake/bin/cargo" };
      const n = new Ninja({ buildDir: cfg.buildDir });
      registerDepRules(n, cfg);
      resolveDep(
        n,
        cfg,
        {
          name: "lolhtml",
          source: () => ({ kind: "github-archive", repo: "example/example", commit: "0".repeat(40) }),
          build: () => ({ kind: "cargo", manifestDir: ".", libName: "example" }),
          provides: () => ({ libs: [], includes: [] }),
        },
        new Map(),
      );
      return n.toString().replace(/ \$\n +/g, " ");
    };
    // CI's path remapping is what sets the variable, so that is when the file's flags are lost.
    const withSysroot = cargoEdge(on("windows", "C:\\cache\\"));
    expect(withSysroot).toContain("--remap-path-prefix=");
    expect(withSysroot).toContain("-Clink-arg=/winsysroot:C:\\cache\\winsysroot");
    expect(cargoEdge({ ...on("windows", "C:\\cache\\"), winsysroot: undefined })).not.toContain("winsysroot");
  });

  test("are absent from a build against the installed toolset", () => {
    const flags = computeFlags({ ...on("windows", "C:\\"), winsysroot: undefined });
    expect([...flags.cflags, ...flags.ldflags].filter(f => /winsysroot|ucrt-servicing/.test(f))).toEqual([]);
  });
});
