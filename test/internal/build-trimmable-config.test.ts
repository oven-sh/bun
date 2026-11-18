/**
 * No build configuration links an executable `--trim` can work on (`Config.trimmable`). What such a link is compiled
 * with, and the map that scripts/build/trim/link.ts reads. Configure-time logic only: no compiler and no download.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows } from "harness";

import {
  linksWithLld,
  resolveConfig,
  type Config,
  type PartialConfig,
  type Toolchain,
} from "../../scripts/build/config.ts";
import { computeFlags, linkerMapOutputs, linkerMapPath, writesLinkerMap } from "../../scripts/build/flags.ts";
import { getProfile, type ProfileName } from "../../scripts/build/profiles.ts";
import { cargoBuildInvocation } from "../../scripts/build/rust.ts";

/** Both resolve on every host: a sysroot's path is only recorded, never opened. */
const linux = { os: "linux", arch: "x64", abi: "gnu", linuxSysroot: "/fake/linux-sysroot" } satisfies PartialConfig;
const freebsd = { os: "freebsd", arch: "x64", freebsdSysroot: "/fake/freebsd" } satisfies PartialConfig;

/** A fully-populated fake toolchain: resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
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
  } as Toolchain;
}

const resolve = (partial: PartialConfig, trimmable = true): Config => ({
  ...resolveConfig({ buildType: "Release", ...partial }, mockToolchain()),
  trimmable,
});

describe.skipIf(isWindows)("trimmable build config", () => {
  const targets: PartialConfig[] = [
    linux,
    freebsd,
    { os: "windows", arch: "x64", winsysroot: "/fake/winsysroot" },
    ...(isMacOS ? [] : [{ os: "darwin", arch: "aarch64" } satisfies PartialConfig]),
  ];

  test.each(targets)("$os links with lld and writes a linker map", partial => {
    const cfg = resolve(partial);
    expect(linksWithLld(cfg)).toBe(true);
    expect(writesLinkerMap(cfg)).toBe(true);
    expect(linkerMapOutputs(cfg).length).toBeGreaterThan(0);
  });

  test("freebsd passes the map flag to the linker", () => {
    const cfg = resolve(freebsd);
    expect(computeFlags(cfg).ldflags).toContain(`-Wl,-Map=${linkerMapPath(cfg)}`);
  });

  test("with LTO, C is compiled so that each c-function of src/trim/features stays a function", () => {
    const keepsFunction = "-force-attribute=us_nq_loop_drain:noinline";
    const flagsOf = (partial: PartialConfig, trimmable?: boolean) =>
      computeFlags(resolve({ ...linux, ...partial }, trimmable));
    expect(flagsOf({ lto: true }).cflags).toContain(keepsFunction);
    expect(flagsOf({ lto: true }).cxxflags).not.toContain(keepsFunction);
    expect(flagsOf({ lto: false }).cflags).not.toContain(keepsFunction);
    expect(flagsOf({ lto: true }, false).cflags).not.toContain(keepsFunction);
  });

  test("without LTO over the crates, rustc gives no section the names of two functions", () => {
    const keepsFunctionsApart = "-Zmerge-functions=disabled";
    const flagsOf = (partial: PartialConfig, trimmable?: boolean) =>
      cargoBuildInvocation(resolve({ ...linux, lto: false, ...partial }, trimmable)).rustflags;
    expect(flagsOf({ rustLto: false })).toContain(keepsFunctionsApart);
    expect(flagsOf({ rustLto: true })).not.toContain(keepsFunctionsApart);
    expect(flagsOf({ rustLto: false }, false)).not.toContain(keepsFunctionsApart);
  });

  test.each(["debug", "release", "ci-build"] satisfies ProfileName[])("is off in %s, as the compiler is", name => {
    const { trimmable, aot } = resolveConfig({ ...getProfile(name), ...linux }, mockToolchain());
    expect({ trimmable, aot }).toEqual({ trimmable: false, aot: false });
  });
});
