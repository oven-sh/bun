/** Build-config regression tests for WebKit prebuilt URL computation: default
 * WEBKIT_VERSION is used as the release tag; --webkit-version overrides still
 * hit the plain `autobuild-<sha>` tag. Configure-time only. */
import { describe, expect, test } from "bun:test";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../../scripts/build/config.ts";
import { webkit, WEBKIT_VERSION } from "../../../scripts/build/deps/webkit.ts";

/** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
function mockToolchain(): Toolchain {
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
  };
}

/** Shorthand: a Linux glibc x64 release target. linuxSysroot stubbed so the
 * cross-arch block in resolveConfig never throws on a non-x64-glibc host. */
function resolveLinuxRelease(partial: PartialConfig = {}): Config {
  return resolveConfig(
    {
      os: "linux",
      arch: "x64",
      abi: "gnu",
      buildType: "Release",
      lto: false,
      baseline: false,
      linuxSysroot: "/fake/linux-sysroot",
      ...partial,
    },
    mockToolchain(),
  );
}

function prebuiltUrlOf(cfg: Config): string {
  const src = webkit.source(cfg);
  if (src.kind !== "prebuilt") throw new Error(`expected prebuilt source, got ${src.kind}`);
  return src.url;
}

describe("WebKit prebuilt URL", () => {
  // Mirrors prebuiltUrl(): 40-hex shas get the autobuild- prefix, tags pass
  // through, so these assertions hold for both WEBKIT_VERSION forms.
  const defaultTag = WEBKIT_VERSION.startsWith("autobuild-") ? WEBKIT_VERSION : `autobuild-${WEBKIT_VERSION}`;

  test("default webkitVersion is used as the release tag", () => {
    const cfg = resolveLinuxRelease({ aot: false });
    expect(cfg.webkitVersion).toBe(WEBKIT_VERSION);
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64.tar.gz`,
    );
  });

  test("lto picks the -lto artifact from the same release tag", () => {
    const cfg = resolveLinuxRelease({ lto: true, aot: false });
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-lto.tar.gz`,
    );
  });

  test("debug picks the -debug-aot artifact from the same release tag", () => {
    const cfg = resolveConfig(
      { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", asan: false, baseline: false, linuxSysroot: "/fake" },
      mockToolchain(),
    );
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-debug-aot.tar.gz`,
    );
  });

  test("every variant is built with JavaScriptCore's ahead-of-time compiler", () => {
    const suffixOf = (partial: PartialConfig) =>
      prebuiltUrlOf(resolveLinuxRelease(partial)).match(/bun-webkit-linux-amd64(.*)\.tar\.gz$/)?.[1];
    expect({
      release: suffixOf({}),
      lto: suffixOf({ lto: true }),
      ltoHardened: suffixOf({ lto: true, hardened: true }),
      hardened: suffixOf({ hardened: true }),
      asan: suffixOf({ asan: true }),
      assertions: suffixOf({ assertions: true }),
      fuzzilli: suffixOf({ assertions: true, fuzzilli: true }),
    }).toEqual({
      release: "-aot",
      lto: "-lto-aot",
      ltoHardened: "-lto-hardened-aot",
      hardened: "-hardened-aot",
      asan: "-asan-aot",
      assertions: "-assertions-aot",
      fuzzilli: "-assertions-coverage-aot",
    });
  });

  test("baseline does not affect the suffix (every x64 WebKit is built at the nehalem floor)", () => {
    expect(prebuiltUrlOf(resolveLinuxRelease({ lto: true, baseline: true, aot: false }))).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-lto.tar.gz`,
    );
    expect(prebuiltUrlOf(resolveLinuxRelease({ asan: true, baseline: true }))).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-asan-aot.tar.gz`,
    );
  });

  test("--hardened=on takes the hardened prebuilt where one is published", () => {
    expect(prebuiltUrlOf(resolveLinuxRelease({ hardened: true }))).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-hardened-aot.tar.gz`,
    );
    expect(prebuiltUrlOf(resolveLinuxRelease({ hardened: true, lto: true, aot: false }))).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-lto-hardened.tar.gz`,
    );
    const others = [
      { arch: "aarch64" },
      { buildType: "Debug" },
      { asan: true },
      { assertions: true },
      { fuzzilli: true },
    ];
    for (const other of others as PartialConfig[]) {
      expect(() => resolveLinuxRelease({ hardened: true, ...other })).toThrow("or webkit=local");
      expect(resolveLinuxRelease({ hardened: true, webkit: "local", ...other }).hardened).toBe(true);
    }
    expect(() => resolveLinuxRelease({ hardened: true, abi: "musl" })).toThrow("or webkit=local");
  });

  test("a build with the ahead-of-time compiler is called -aot, and only what ships comes without it", () => {
    const name = (partial: PartialConfig) => prebuiltUrlOf(resolveLinuxRelease(partial)).split("/").pop();
    expect(name({})).toBe("bun-webkit-linux-amd64-aot.tar.gz");
    expect(name({ lto: true })).toBe("bun-webkit-linux-amd64-lto-aot.tar.gz");
    expect(name({ lto: true, hardened: true })).toBe("bun-webkit-linux-amd64-lto-hardened-aot.tar.gz");
    for (const other of [
      { asan: true },
      { assertions: true },
      { fuzzilli: true },
      { hardened: true },
    ] as PartialConfig[]) {
      expect(name(other)).toEndWith("-aot.tar.gz");
      expect(() => name({ ...other, aot: false })).toThrow("without the ahead-of-time compiler");
    }
  });

  test("--webkit-version=<sha> uses the plain autobuild-<sha> tag", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const cfg = resolveLinuxRelease({ webkitVersion: sha, aot: false });
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/autobuild-${sha}/bun-webkit-linux-amd64.tar.gz`,
    );
  });

  test("--webkit-version=autobuild-* is passed through verbatim", () => {
    const tag = "autobuild-preview-pr-999-deadbeef";
    const cfg = resolveLinuxRelease({ webkitVersion: tag, aot: false });
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${tag}/bun-webkit-linux-amd64.tar.gz`,
    );
  });

  test("WEBKIT_VERSION is either a 40-hex sha or an autobuild-* tag", () => {
    expect(/^[0-9a-f]{40}$/.test(WEBKIT_VERSION) || WEBKIT_VERSION.startsWith("autobuild-")).toBe(true);
  });
});
