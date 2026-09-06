/**
 * A dependency bump (new pinned commit while the previous version's tree is
 * still in vendor/) must not wipe the tree, and must not recompile everything
 * that names the dep. scripts/build/source.ts reports such a dep as
 * `staleFetch` so build.ts syncs it in a fetch-only ninja pass before the main
 * one, and consumers wait on its fetch stamp ORDER-ONLY (`headerSignal`), so
 * only objects whose sources or headers actually changed rebuild. A prebuilt
 * dep, whose fetch edge rewrites headers during the main pass, keeps the
 * implicit signal. A git clone found where the build's own tree belongs is
 * refused with the --local-deps hint rather than touched.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { nodejsHeaders } from "../../scripts/build/deps/nodejs-headers.ts";
import { zstd } from "../../scripts/build/deps/zstd.ts";
import { describeError } from "../../scripts/build/error.ts";
import { expectedSourceIdentity } from "../../scripts/build/fetch-cli.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { registerAllRules } from "../../scripts/build/rules.ts";
import { resolveDep, type ResolvedDep } from "../../scripts/build/source.ts";

function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    readobj: "/fake/llvm/bin/llvm-readobj",
    objdump: "/fake/llvm/bin/llvm-objdump",
    dsymutil: undefined,
    lipo: undefined,
    installNameTool: undefined,
    codesign: undefined,
    rc: undefined,
    mt: undefined,
    nasm: "/fake/bin/nasm",
    perl: "/fake/bin/perl",
    ruby: "/fake/bin/ruby",
    python: "/fake/bin/python3",
    esbuild: "/fake/bin/esbuild",
    bun: "/fake/bin/bun",
    cargo: "/fake/bin/cargo",
    cargoHome: undefined,
    rustupHome: undefined,
    zig: "/fake/bin/zig",
    cmake: "/fake/bin/cmake",
    ccache: undefined,
    msvcLinker: undefined,
    winsysroot: undefined,
  };
}

/** A linux-x64 debug config rooted at `root`, so vendor/ is `root`/vendor (nothing is spawned or fetched). */
function setup(root: string): { cfg: Config; n: Ninja } {
  const buildDir = join(root, "build");
  const resolved = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const cfg: Config = { ...resolved, cwd: root, vendorDir: join(root, "vendor"), cacheDir: join(root, "cache") };
  const n = new Ninja({ buildDir });
  registerAllRules(n, cfg);
  return { cfg, n };
}

const zstdCommit = (cfg: Config) => {
  const s = zstd.source(cfg);
  if (s.kind !== "github") throw new Error("zstd is expected to be a github dep");
  return s.commit;
};

describe("stale dependency trees", () => {
  test("no tree on disk: nothing to sync first, consumers wait order-only", () => {
    using dir = tempDir("dep-stale-absent", {});
    const { cfg, n } = setup(String(dir));
    const r = resolveDep(n, cfg, zstd, new Map()) as ResolvedDep;
    expect(r.staleFetch).toBeUndefined();
    expect(r.headerSignal).toBe("order-only");
    expect(r.outputs).toEqual([resolve(cfg.vendorDir, "zstd", ".ref")]);
  });

  test("a tree at the pinned identity is current", () => {
    using dir = tempDir("dep-stale-current", {});
    const { cfg, n } = setup(String(dir));
    mkdirSync(join(cfg.vendorDir, "zstd"), { recursive: true });
    writeFileSync(join(cfg.vendorDir, "zstd", ".ref"), expectedSourceIdentity(zstdCommit(cfg), [], []) + "\n");
    const r = resolveDep(n, cfg, zstd, new Map()) as ResolvedDep;
    expect(r.staleFetch).toBeUndefined();
  });

  test("a tree from another commit is reported for the fetch pre-pass, not deleted", () => {
    using dir = tempDir("dep-stale-older", {});
    const { cfg, n } = setup(String(dir));
    const tree = join(cfg.vendorDir, "zstd");
    mkdirSync(join(tree, "lib"), { recursive: true });
    writeFileSync(join(tree, ".ref"), expectedSourceIdentity("0".repeat(40), [], []) + "\n");
    writeFileSync(join(tree, "lib", "zstd.h"), "/* previous version */\n");
    const r = resolveDep(n, cfg, zstd, new Map()) as ResolvedDep;
    expect(r.staleFetch).toBe(resolve(tree, ".ref"));
    expect(r.headerSignal).toBe("order-only");
    expect(Bun.file(join(tree, "lib", "zstd.h")).size).toBeGreaterThan(0); // configure left it alone
  });

  test("a tree with no stamp (interrupted sync) counts as stale", () => {
    using dir = tempDir("dep-stale-nostamp", {});
    const { cfg, n } = setup(String(dir));
    mkdirSync(join(cfg.vendorDir, "zstd", "lib"), { recursive: true });
    const r = resolveDep(n, cfg, zstd, new Map()) as ResolvedDep;
    expect(r.staleFetch).toBe(resolve(cfg.vendorDir, "zstd", ".ref"));
  });

  test("a git clone in the tree's place is refused, not synced over", () => {
    using dir = tempDir("dep-stale-clone", {});
    const { cfg, n } = setup(String(dir));
    mkdirSync(join(cfg.vendorDir, "zstd", ".git"), { recursive: true });
    let message = "";
    try {
      resolveDep(n, cfg, zstd, new Map());
    } catch (e) {
      message = describeError(e);
    }
    expect(message).toContain("is a git clone");
  });

  test("a prebuilt dep keeps the implicit header signal", () => {
    using dir = tempDir("dep-stale-prebuilt", {});
    const { cfg, n } = setup(String(dir));
    const r = resolveDep(n, cfg, nodejsHeaders, new Map()) as ResolvedDep;
    expect(r.headerSignal).toBe("implicit");
    expect(r.staleFetch).toBeUndefined();
  });
});
