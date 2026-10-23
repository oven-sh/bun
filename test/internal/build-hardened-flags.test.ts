import { expect, test } from "bun:test";
import { tempDir } from "harness";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { mimalloc } from "../../scripts/build/deps/mimalloc.ts";
import {
  computeDepFlags,
  computeFlags,
  computeHardeningFlags,
  hardeningFlags,
  safeStackDependencies,
  safeStackFlags,
} from "../../scripts/build/flags.ts";
import { cargoBuildInvocation } from "../../scripts/build/rust.ts";
import type { DirectBuild } from "../../scripts/build/source.ts";

function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
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
    ...overrides,
  };
}

function linuxConfig(partial: PartialConfig, buildDir: string, toolchain = mockToolchain()): Config {
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
    toolchain,
  );
}

function everyFlagOf(cfg: Config) {
  const own = computeFlags(cfg);
  const dependencies = computeDepFlags(cfg);
  return {
    c: own.cflags,
    cxx: own.cxxflags,
    dependencyC: dependencies.cflags,
    dependencyCxx: dependencies.cxxflags,
    link: own.ldflags,
    rust: cargoBuildInvocation(cfg).env.CARGO_ENCODED_RUSTFLAGS.split("\x1f"),
    allocator: Object.entries((mimalloc.build(cfg) as DirectBuild).defines ?? {}).map(
      ([name, value]) => name + "=" + value,
    ),
  };
}

const compilerFlags = [
  "-fstack-protector-strong",
  "-D_FORTIFY_SOURCE=2",
  "-fstack-clash-protection",
  "-ftrivial-auto-var-init=zero",
  "-ftrivial-auto-var-init-max-size=4096",
  "-fno-delete-null-pointer-checks",
  "-fno-strict-overflow",
  "-fno-strict-aliasing",
  "-fsanitize=array-bounds",
  "-fsanitize-trap=array-bounds",
  "-D_GLIBCXX_ASSERTIONS=1",
  "-fPIE",
  "-DBUN_HARDENED=1",
  "-DENABLE_AOT_POSITION_INDEPENDENT_IMAGE=1",
];
function patchesOfAllocator(cfg: Config): string[] {
  const patches = mimalloc.patches ?? [];
  return typeof patches === "function" ? patches(cfg) : patches;
}

const rustFlags = [
  "-Crelocation-model=pie",
  "--cfg=bun_hardened",
  "-Zstack-protector=strong",
  "-Coverflow-checks=on",
  "-Zub-checks=yes",
];
const linkFlags = ["-pie", "-Wl,-z,now", "-Wl,-z,relro", "-Wl,-z,separate-code", "-Wl,-z,noexecstack"];

test("--hardened=on gives every C and C++ source, every crate and the link its mitigations", () => {
  using dir = tempDir("build-hardened-flags", {});
  const cfg = linuxConfig({ hardened: true }, String(dir));
  const flags = everyFlagOf(cfg);
  expect(hardeningFlags).toEqual(compilerFlags);
  expect(computeHardeningFlags(cfg)).toEqual(compilerFlags);
  for (const list of [flags.c, flags.cxx, flags.dependencyC, flags.dependencyCxx]) {
    expect(list).toEqual(expect.arrayContaining(compilerFlags));
    for (const flag of ["-fno-stack-protector", "-fno-pic", "-fno-pie"]) expect(list).not.toContain(flag);
  }
  expect(flags.rust).toEqual(expect.arrayContaining(rustFlags));
  expect(flags.link).toEqual(expect.arrayContaining(linkFlags));
  expect(flags.allocator).toContain("MI_SECURE=1");
  expect(patchesOfAllocator(cfg)).toContain("patches/mimalloc/secure-guard-pages-are-protected.patch");
  expect(patchesOfAllocator(cfg)).toContain("patches/mimalloc/environment-sets-sizes-and-pace-only.patch");
});

test("only a build with the ahead-of-time compiler patches what the allocator does in every free", () => {
  using dir = tempDir("build-allocator-patches", {});
  const forCompiler = ["patches/mimalloc/hand-out-last-freed.patch", "patches/mimalloc/hand-out-resident-slices.patch"];
  const withCompiler = patchesOfAllocator(linuxConfig({ aot: true }, String(dir)));
  const withoutCompiler = patchesOfAllocator(linuxConfig({ aot: false }, String(dir)));
  expect(withCompiler).toEqual(expect.arrayContaining(forCompiler));
  expect(withoutCompiler).toEqual(withCompiler.filter(patch => !forCompiler.includes(patch)));
});

test("a build without --hardened has none of them", () => {
  using dir = tempDir("build-hardened-flags-off", {});
  const cfg = linuxConfig({}, String(dir));
  const flags = everyFlagOf(cfg);
  expect(computeHardeningFlags(cfg)).toEqual([]);
  const all = Object.values(flags).flat();
  for (const flag of [...compilerFlags, ...rustFlags, ...linkFlags, "MI_SECURE=1"]) expect(all).not.toContain(flag);
  expect(flags.c).toContain("-fno-stack-protector");
  expect(patchesOfAllocator(cfg)).not.toContain("patches/mimalloc/environment-sets-sizes-and-pace-only.patch");
});

test("only --require-mdwe=off lets a hardened build's executables start on a kernel without PR_SET_MDWE", () => {
  using dir = tempDir("build-hardened-flags-mdwe", {});
  const startsWithout = "--cfg=bun_starts_without_mdwe";
  expect(everyFlagOf(linuxConfig({ hardened: true }, String(dir))).rust).not.toContain(startsWithout);
  expect(everyFlagOf(linuxConfig({ hardened: true, requireMdwe: false }, String(dir))).rust).toContain(startsWithout);
  expect(everyFlagOf(linuxConfig({}, String(dir))).rust).not.toContain(startsWithout);
  expect(() => linuxConfig({ requireMdwe: true }, String(dir))).toThrow("requireMdwe=true requires hardened=true");
});

test("only --lock-environment=off lets tests steer a hardened build by the environment", () => {
  using dir = tempDir("build-hardened-flags-environment", {});
  const patch = "patches/mimalloc/environment-sets-sizes-and-pace-only.patch";
  const locked = linuxConfig({ hardened: true }, String(dir));
  expect(everyFlagOf(locked).rust).toContain("--cfg=bun_locked_environment");
  expect(everyFlagOf(locked).cxx).toContain("-DBUN_LOCKED_ENVIRONMENT=1");
  // What the first compiles calls a function of each of the other two.
  expect(patchesOfAllocator(locked)).toContain(patch);
  for (const cfg of [
    linuxConfig({ hardened: true, lockEnvironment: false }, String(dir)),
    linuxConfig({}, String(dir)),
  ]) {
    expect(everyFlagOf(cfg).rust).not.toContain("--cfg=bun_locked_environment");
    expect(everyFlagOf(cfg).cxx).not.toContain("-DBUN_LOCKED_ENVIRONMENT=1");
    expect(patchesOfAllocator(cfg)).not.toContain(patch);
  }
  expect(() => linuxConfig({ lockEnvironment: true }, String(dir))).toThrow(
    "lockEnvironment=true requires hardened=true",
  );
});

test("--guarded-pages is on with --hardened=on, and either can be had without the other where WebKit is compiled too", () => {
  using dir = tempDir("build-hardened-flags-guarded-pages", {});
  const define = "-DENABLE_AOT_GUARDED_PAGES=1";
  for (const partial of [{ hardened: true }, { guardedPages: true }] as PartialConfig[]) {
    const flags = everyFlagOf(linuxConfig(partial, String(dir)));
    for (const list of [flags.c, flags.cxx, flags.dependencyC, flags.dependencyCxx]) expect(list).toContain(define);
  }
  for (const partial of [{}, { hardened: true, guardedPages: false }] as PartialConfig[])
    expect(Object.values(everyFlagOf(linuxConfig(partial, String(dir)))).flat()).not.toContain(define);
  expect(everyFlagOf(linuxConfig({ hardened: true, webkit: "prebuilt" }, String(dir))).cxx).toContain(define);
  for (const partial of [{ guardedPages: true }, { hardened: true, guardedPages: false }] as PartialConfig[])
    expect(() => linuxConfig({ ...partial, webkit: "prebuilt" }, String(dir))).toThrow("requires webkit=local");
});

test("_FORTIFY_SOURCE is left out where nothing is optimized or ASan checks the same calls", () => {
  using dir = tempDir("build-hardened-flags-fortify", {});
  const others = compilerFlags.filter(flag => flag !== "-D_FORTIFY_SOURCE=2");
  for (const partial of [{ buildType: "Debug" }, { asan: true }] as PartialConfig[]) {
    const cfg = linuxConfig({ hardened: true, ...partial }, String(dir));
    expect(computeHardeningFlags(cfg)).toEqual(others);
    expect(everyFlagOf(cfg).c).not.toContain("-D_FORTIFY_SOURCE=2");
  }
});

test("--hardened=on is refused where nothing can be hardened", () => {
  using dir = tempDir("build-hardened-flags-refused", {});
  for (const partial of [
    { os: "darwin", arch: "aarch64", abi: undefined },
    { abi: "android", arch: "aarch64" },
  ] as PartialConfig[])
    expect(() => linuxConfig({ hardened: true, ...partial }, String(dir))).toThrow("hardened=true requires os=linux");
});

test("--hardened=on strips with llvm-strip, which keeps PT_GNU_RELRO, or not at all", () => {
  using dir = tempDir("build-hardened-flags-strip", {});
  for (const arch of ["x64", "aarch64"] as const)
    expect(linuxConfig({ hardened: true, arch }, String(dir)).strip).toBe("/fake/llvm/bin/llvm-strip");
  expect(() => linuxConfig({ hardened: true }, String(dir), mockToolchain({ llvmStrip: undefined }))).toThrow(
    "hardened=true requires llvm-strip",
  );
  expect(linuxConfig({}, String(dir), mockToolchain({ llvmStrip: undefined })).strip).toEndWith("strip");
});

const librariesThatCallBackIntoJavaScript = ["boringssl", "cares", "lsquic", "lsqpack", "sqlite", "tinycc"];

test("the libraries that never call back into JavaScript keep their arrays on a second stack", () => {
  using dir = tempDir("build-hardened-flags-safe-stack", {});
  const on = linuxConfig({ hardened: true }, String(dir));
  const off = linuxConfig({}, String(dir));
  expect(safeStackDependencies).toContain("zlib");
  for (const name of safeStackDependencies) {
    expect(safeStackFlags(on, name)).toEqual(["-fsanitize=safe-stack"]);
    expect(safeStackFlags(off, name)).toEqual([]);
  }
  for (const name of [...librariesThatCallBackIntoJavaScript, "mimalloc", "WebKit"])
    expect(safeStackFlags(on, name)).toEqual([]);
  expect(everyFlagOf(on).cxx).toContain("-DBUN_SAFE_STACK=1");
  expect(everyFlagOf(on).dependencyC).not.toContain("-fsanitize=safe-stack");
  expect(Object.values(everyFlagOf(off)).flat()).not.toContain("-DBUN_SAFE_STACK=1");
  const withAddressSanitizer = linuxConfig({ hardened: true, asan: true }, String(dir));
  expect(safeStackFlags(withAddressSanitizer, "zlib")).toEqual([]);
  expect(everyFlagOf(withAddressSanitizer).cxx).not.toContain("-DBUN_SAFE_STACK=1");
});
