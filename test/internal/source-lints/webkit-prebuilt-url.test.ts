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
    clangVersion: "22.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/22",
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
  };
}

/** Shorthand: a Linux glibc x64 release target, abi pinned so host detection never runs. */
function resolveLinuxRelease(partial: PartialConfig = {}): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", lto: false, ...partial },
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
    const cfg = resolveLinuxRelease();
    expect(cfg.webkitVersion).toBe(WEBKIT_VERSION);
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64.tar.gz`,
    );
  });

  test("lto picks the -lto artifact from the same release tag", () => {
    const cfg = resolveLinuxRelease({ lto: true });
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-lto.tar.gz`,
    );
  });

  test("debug picks the -debug artifact from the same release tag", () => {
    const cfg = resolveConfig(
      { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", asan: false },
      mockToolchain(),
    );
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${defaultTag}/bun-webkit-linux-amd64-debug.tar.gz`,
    );
  });

  test("--webkit-version=<sha> uses the plain autobuild-<sha> tag", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const cfg = resolveLinuxRelease({ webkitVersion: sha });
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/autobuild-${sha}/bun-webkit-linux-amd64.tar.gz`,
    );
  });

  test("--webkit-version=autobuild-* is passed through verbatim", () => {
    const tag = "autobuild-preview-pr-999-deadbeef";
    const cfg = resolveLinuxRelease({ webkitVersion: tag });
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${tag}/bun-webkit-linux-amd64.tar.gz`,
    );
  });

  test("WEBKIT_VERSION is either a 40-hex sha or an autobuild-* tag", () => {
    expect(/^[0-9a-f]{40}$/.test(WEBKIT_VERSION) || WEBKIT_VERSION.startsWith("autobuild-")).toBe(true);
  });
});
