/**
 * What a build for Windows on a Windows host links against
 * (scripts/build/config.ts): the pinned sysroot the shipped binary is built
 * with, not what the machine has installed. Configure-time logic only, so no
 * compiler runs and nothing is fetched. `resolveConfig` asks the machine what
 * the host is, so these need a Windows one; windows-cross-config.test.ts
 * covers the other hosts.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { locations } from "../../scripts/build/ci-images/spec.ts";
import { resolveConfig, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { windowsSysrootCachePath } from "../../scripts/build/winsysroot.ts";

/** A fully-populated fake toolchain. */
const toolchain: Toolchain = {
  cc: "/fake/llvm/bin/clang-cl",
  cxx: "/fake/llvm/bin/clang-cl",
  hostCc: undefined,
  hostCxx: undefined,
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
};

const native = (partial: PartialConfig = {}) =>
  resolveConfig({ arch: "x64", buildType: "Debug", ...partial }, toolchain);

describe.skipIf(!isWindows)("a build for Windows on Windows", () => {
  let provisioned: string | undefined;
  beforeEach(() => {
    provisioned = process.env.WINDOWS_SYSROOT;
    delete process.env.WINDOWS_SYSROOT;
  });
  afterEach(() => {
    delete process.env.WINDOWS_SYSROOT;
    if (provisioned !== undefined) process.env.WINDOWS_SYSROOT = provisioned;
  });

  test("uses the sysroot a CI image has, else the one in the build cache, and is not a cross-compile", () => {
    const cfg = native();
    const baked = locations.windowsSysroot.windows;
    expect(cfg.winsysroot).toBe(
      existsSync(join(baked, "Windows Kits", "10", "Include")) ? baked : windowsSysrootCachePath(cfg.cacheDir),
    );
    expect(cfg.crossTarget).toBeUndefined();
  });

  test("uses the sysroot WINDOWS_SYSROOT names, ahead of either", () => {
    using dir = tempDir("winsysroot", { "Windows Kits/10/Include/keep": "" });
    process.env.WINDOWS_SYSROOT = String(dir);
    expect(native().winsysroot).toBe(String(dir));
  });

  test("uses the sysroot it is given", () => {
    expect(native({ winsysroot: "C:\\elsewhere" }).winsysroot).toBe("C:\\elsewhere");
    const cfg = native({ winsysroot: "elsewhere" });
    expect(cfg.winsysroot).toBe(resolve(cfg.cwd, "elsewhere"));
  });

  test("uses the installed toolset with a local WebKit, which msbuild compiles against it", () => {
    expect(native({ webkit: "local" }).winsysroot).toBeUndefined();
  });

  test("has rustc link with lld-link either way: link.exe is Visual Studio's", () => {
    expect(native().msvcLinker).toBe(toolchain.ld);
    expect(native({ webkit: "local" }).msvcLinker).toBe(toolchain.ld);
  });
});

test("the fetched sysroot's directory is named for what is in it", () => {
  expect(windowsSysrootCachePath("/cache")).toMatch(/[\\/]cache[\\/]winsysroot-10\.[\d.]+-14\.[\d.]+$/);
});
