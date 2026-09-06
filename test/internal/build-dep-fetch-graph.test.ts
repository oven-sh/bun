/**
 * The ninja shape of a fetched dependency (scripts/build/source.ts emitFetch).
 * A version bump must rebuild only what the bump changed, in the same ninja
 * run, without configure reading or deleting vendor/<dep>. That rests on:
 *
 * - two edges per dep: `plan` (download/extract beside the live tree, write
 *   deps/<dep>/sources.dd) and `dep` (sync in place, write .ref) which names
 *   sources.dd as its dyndep file and as an input;
 * - the sources some compile edge names as `$in` staying STATIC outputs of
 *   `dep` (a fresh checkout has no dyndep yet), and being listed in
 *   deps/static-outputs.txt so `plan` leaves them out of the dyndep file
 *   (ninja refuses a file with two producers) — one list for the whole graph,
 *   since a dep may compile a sibling's source;
 * - consumers waiting on the stamp order-only (`headerSignal`), the dyndep
 *   outputs + depfiles being what rebuilds them; a prebuilt dep, whose fetch
 *   rewrites headers ninja never hears about, keeps the implicit signal;
 * - a git clone found where the build's tree belongs being refused.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { lsqpack } from "../../scripts/build/deps/lsqpack.ts";
import { nodejsHeaders } from "../../scripts/build/deps/nodejs-headers.ts";
import { zstd } from "../../scripts/build/deps/zstd.ts";
import { describeError } from "../../scripts/build/error.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { registerAllRules } from "../../scripts/build/rules.ts";
import { resolveDep, writeFetchStaticOutputs, type ResolvedDep } from "../../scripts/build/source.ts";

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
function setup(root: string): { cfg: Config; n: Ninja; buildDir: string } {
  const buildDir = join(root, "build");
  const resolved = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const cfg: Config = { ...resolved, cwd: root, vendorDir: join(root, "vendor"), cacheDir: join(root, "cache") };
  const n = new Ninja({ buildDir });
  registerAllRules(n, cfg);
  return { cfg, n, buildDir };
}

/** Forward slashes: build.ninja spells relative paths natively (backslashes on Windows); compare in one form. */
const P = (path: string): string => path.replaceAll("\\", "/");

/** The `build` statement in build.ninja whose first output is `firstOutput` (buildDir-relative), joined onto one line. */
function edgeFor(ninjaText: string, firstOutput: string): string {
  const start = ninjaText.search(new RegExp(`^build ${RegExp.escape(firstOutput)}[ :]`, "m"));
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = ninjaText.slice(start);
  const next = rest.indexOf("\nbuild ", 1);
  return (next < 0 ? rest : rest.slice(0, next)).replaceAll("$\n", "").replace(/ +/g, " ");
}

describe("fetched dependency graph", () => {
  test("plan writes the dyndep file; dep syncs with it as dyndep and input; the tree's compiled sources stay static outputs", async () => {
    using dir = tempDir("dep-fetch-graph", {});
    const { cfg, n, buildDir } = setup(String(dir));
    const r = resolveDep(n, cfg, zstd, new Map()) as ResolvedDep;
    writeFetchStaticOutputs(cfg, [r]);
    await n.write();
    const text = P(readFileSync(join(buildDir, "build.ninja"), "utf8"));
    const tree = resolve(cfg.vendorDir, "zstd");

    const plan = edgeFor(text, "deps/zstd/sources.dd");
    expect(plan).toContain(": dep_fetch_plan ");
    expect(plan).toContain(`ddfile = ${P(join(buildDir, "deps/zstd/sources.dd"))}`);
    expect(plan).toContain(`static_outputs = ${P(join(buildDir, "deps/static-outputs.txt"))}`);
    expect(plan).toContain(`builddir = ${P(buildDir)}`);
    expect(plan).toContain("deps/static-outputs.txt"); // an input, so a new list re-plans

    const dep = edgeFor(text, P(relative(buildDir, join(tree, ".ref"))));
    expect(dep).toContain(": dep_fetch |");
    expect(dep).toContain("dyndep = deps/zstd/sources.dd");
    expect(dep).toMatch(/\| [^:]*deps\/zstd\/sources\.dd[^:]*\n?/); // implicit input too
    expect(dep).toContain(`${P(relative(buildDir, tree))}/lib/common/debug.c`); // a compiled source, static

    expect(r.fetchDeclares).toContain(join(tree, "lib/common/debug.c"));
    expect(readFileSync(join(buildDir, "deps/static-outputs.txt"), "utf8").split("\n")).toContain(
      join(tree, "lib/common/debug.c"),
    );
    expect(r.headerSignal).toBe("order-only");
    expect(r.outputs).toEqual([join(tree, ".ref")]);
  });

  test("the static-outputs list is the union over deps (a dep may compile a sibling's file)", () => {
    using dir = tempDir("dep-fetch-union", {});
    const { cfg, n, buildDir } = setup(String(dir));
    const a = resolveDep(n, cfg, lsqpack, new Map()) as ResolvedDep;
    const b = resolveDep(n, cfg, zstd, new Map()) as ResolvedDep;
    writeFetchStaticOutputs(cfg, [a, b]);
    const listed = readFileSync(join(buildDir, "deps/static-outputs.txt"), "utf8").split("\n").filter(Boolean);
    expect(listed).toEqual([...new Set([...a.fetchDeclares, ...b.fetchDeclares])].sort());
  });

  test("configure leaves an older tree in place (the fetch edge syncs it)", () => {
    using dir = tempDir("dep-fetch-older", {});
    const { cfg, n } = setup(String(dir));
    const tree = join(cfg.vendorDir, "zstd");
    mkdirSync(join(tree, "lib"), { recursive: true });
    writeFileSync(join(tree, ".ref"), "0123456789abcdef\n");
    writeFileSync(join(tree, "lib", "zstd.h"), "/* previous version */\n");
    resolveDep(n, cfg, zstd, new Map());
    expect(readFileSync(join(tree, "lib", "zstd.h"), "utf8")).toBe("/* previous version */\n");
    expect(readFileSync(join(tree, ".ref"), "utf8")).toBe("0123456789abcdef\n");
  });

  test("a git clone in the tree's place is refused at configure", () => {
    using dir = tempDir("dep-fetch-clone", {});
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

  test("a prebuilt dep keeps the implicit header signal and declares nothing", () => {
    using dir = tempDir("dep-fetch-prebuilt", {});
    const { cfg, n } = setup(String(dir));
    const r = resolveDep(n, cfg, nodejsHeaders, new Map()) as ResolvedDep;
    expect(r.headerSignal).toBe("implicit");
    expect(r.fetchDeclares).toEqual([]);
  });
});
