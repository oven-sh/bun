/** Build-config regression tests for WebKit -mimalloc prebuilt selection:
 * the Linux glibc release default and its gating, the preview pin's
 * commit-to-tag mapping, and local-mode CMake options. Configure-time only. */
import { describe, expect, test } from "bun:test";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { webkit, WEBKIT_MIMALLOC_PREVIEW, WEBKIT_VERSION } from "../../scripts/build/deps/webkit.ts";

/** A fully-populated fake toolchain — resolveConfig never spawns any of these. */
function mockToolchain(): Toolchain {
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

describe("webkitMimalloc default and version pin", () => {
  test("Linux glibc release on the pinned prebuilt defaults on and pins the preview commit", () => {
    const cfg = resolveLinuxRelease();
    expect({ webkitMimalloc: cfg.webkitMimalloc, webkitVersion: cfg.webkitVersion }).toEqual({
      webkitMimalloc: true,
      webkitVersion: WEBKIT_MIMALLOC_PREVIEW.commit,
    });
  });

  test("prebuilt URL maps the preview commit to its PR-tagged release with the -mimalloc suffix", () => {
    const cfg = resolveLinuxRelease();
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/${WEBKIT_MIMALLOC_PREVIEW.tag}/bun-webkit-linux-amd64-mimalloc.tar.gz`,
    );
  });

  test("lto picks the -mimalloc-lto artifact (suffix order matches the release assets)", () => {
    const cfg = resolveLinuxRelease({ lto: true });
    expect(prebuiltUrlOf(cfg)).toEndWith("/bun-webkit-linux-amd64-mimalloc-lto.tar.gz");
  });

  test("prebuilt identity covers the -mimalloc suffix so toggling it re-downloads", () => {
    const src = webkit.source(resolveLinuxRelease());
    if (src.kind !== "prebuilt") throw new Error("expected prebuilt source");
    expect(src.identity).toBe(`${WEBKIT_MIMALLOC_PREVIEW.commit}-mimalloc`);
  });

  test.each([
    ["asan", { asan: true }],
    ["baseline", { baseline: true }],
    ["musl", { abi: "musl" }],
    ["debug", { buildType: "Debug" }],
    ["local WebKit", { webkit: "local" }],
    ["explicit --webkit-version", { webkitVersion: WEBKIT_VERSION }],
    ["explicit off", { webkitMimalloc: false }],
  ] as const)("stays off for %s", (_name, partial) => {
    const cfg = resolveLinuxRelease(partial as PartialConfig);
    expect(cfg.webkitMimalloc).toBe(false);
    expect(cfg.webkitVersion).toBe(WEBKIT_VERSION);
  });

  test("stays off for darwin targets", () => {
    const cfg = resolveConfig({ os: "darwin", arch: "aarch64", buildType: "Release" }, mockToolchain());
    expect(cfg.webkitMimalloc).toBe(false);
    expect(cfg.webkitVersion).toBe(WEBKIT_VERSION);
  });

  test("default-off combinations request the plain default-version tarball", () => {
    const cfg = resolveLinuxRelease({ webkitMimalloc: false });
    expect(prebuiltUrlOf(cfg)).toBe(
      `https://github.com/oven-sh/WebKit/releases/download/autobuild-${WEBKIT_VERSION}/bun-webkit-linux-amd64.tar.gz`,
    );
  });

  test("explicit on for an unsupported combination fails validation naming the constraint", () => {
    expect(() => resolveLinuxRelease({ abi: "musl", webkitMimalloc: true })).toThrow(
      /webkitMimalloc=true requires Linux glibc release non-asan non-baseline/,
    );
  });
});

describe("webkitMimalloc local-mode CMake options", () => {
  test("explicit on forwards USE_MIMALLOC and USE_EXTERNAL_MIMALLOC to the nested cmake", () => {
    const cfg = resolveLinuxRelease({ webkit: "local", webkitMimalloc: true });
    const build = webkit.build(cfg);
    if (build.kind !== "nested-cmake") throw new Error(`expected nested-cmake build, got ${build.kind}`);
    expect(build.args.USE_MIMALLOC).toBe("ON");
    expect(build.args.USE_EXTERNAL_MIMALLOC).toBe("ON");
  });

  test("local default stays on libpas (no mimalloc options)", () => {
    const cfg = resolveLinuxRelease({ webkit: "local" });
    const build = webkit.build(cfg);
    if (build.kind !== "nested-cmake") throw new Error(`expected nested-cmake build, got ${build.kind}`);
    expect(build.args).not.toContainKeys(["USE_MIMALLOC", "USE_EXTERNAL_MIMALLOC"]);
  });
});
