/**
 * Regression tests for ninja ordering of post-link steps (strip, smoke test,
 * dsymutil) in scripts/build/bun.ts.
 *
 * The smoke_test and dsymutil rule commands are wrapped through
 * `cfg.jsRuntime` (= process.execPath). When `bun` on PATH resolves inside the
 * build directory, that path is the strip output itself (build/release/bun),
 * and without an ordering edge ninja will run strip and the wrapper exec
 * concurrently, failing with "Permission denied" on the half-written file.
 *
 * These exercise the ninja-emission logic only (no compiler or ninja needed),
 * so they run on every host.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, tempDir } from "harness";
import { join, resolve } from "node:path";

import { emitPostLink } from "../../scripts/build/bun.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(overrides: Partial<Toolchain> = {}): Toolchain {
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
    cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: "/fake/bin/bun",
    jsRuntime: "/fake/bin/bun",
    jsRuntimeArgv: ["/fake/bin/bun"],
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

/**
 * Resolve a host-targeted config: no os/arch override, so `canRunOnHost` is
 * true and the smoke_test rule emits the real edge (not the phony short-circuit).
 */
function hostConfig(partial: PartialConfig, buildDir: string): Config {
  return resolveConfig(
    { buildDir, ...partial },
    // jsRuntime = the strip output: what resolveToolchain() produces when
    // `bun` on PATH resolves into build/release/.
    mockToolchain({ jsRuntime: join(buildDir, "bun") }),
  );
}

/** Find one build-edge line in the generated ninja text (continuations unwrapped). */
/**
 * The `build` line for `rule`, with the absolute-path alias Ninja.build()
 * declares for every build-dir output (`| /abs/build/<out>`) folded away so
 * the expectations read as `build <out>: <rule> <ins>`.
 */
function buildEdge(ninja: string, rule: string): string {
  const flat = ninja.replace(/ \$\n +/g, " ");
  const line = flat.split("\n").find(l => l.startsWith("build ") && l.includes(`: ${rule} `));
  if (line === undefined) throw new Error(`no '${rule}' edge in ninja output:\n${ninja}`);
  return line.replace(new RegExp(` \\| \\S+(?=: ${rule} )`), "");
}

describe("emitPostLink ninja ordering", () => {
  test("release smoke_test is ordered after strip", () => {
    using dir = tempDir("build-post-link", {});
    const buildDir = String(dir);
    const cfg = hostConfig({ buildType: "Release" }, buildDir);
    expect(cfg.canRunOnHost).toBe(true);

    const n = new Ninja({ buildDir });
    const exe = resolve(buildDir, `bun-profile${cfg.exeSuffix}`);
    const { strippedExe } = emitPostLink(n, cfg, exe, "bun-profile", [], [exe + ".o"]);
    const out = n.toString();

    expect(strippedExe).toBe(resolve(buildDir, `bun${cfg.exeSuffix}`));
    // strip writes `bun`; the smoke_test wrapper execs cfg.jsRuntime
    // (= `bun` here). Without `|| bun` ninja schedules them concurrently
    // and the wrapper sees a half-written file.
    expect(buildEdge(out, "smoke_test")).toBe(
      `build bun-profile.smoke-test-passed: smoke_test bun-profile${cfg.exeSuffix} || bun${cfg.exeSuffix}`,
    );
    expect(buildEdge(out, "strip")).toBe(`build bun${cfg.exeSuffix}: strip bun-profile${cfg.exeSuffix}`);
  });

  test("debug smoke_test has no strip dep (nothing to order against)", () => {
    using dir = tempDir("build-post-link", {});
    const buildDir = String(dir);
    const cfg = hostConfig({ buildType: "Debug", assertions: true }, buildDir);

    const n = new Ninja({ buildDir });
    const exe = resolve(buildDir, `bun-debug${cfg.exeSuffix}`);
    const { strippedExe, dsym } = emitPostLink(n, cfg, exe, "bun-debug", [], [exe + ".o"]);
    const out = n.toString();

    expect({ strippedExe, dsym }).toEqual({ strippedExe: undefined, dsym: undefined });
    expect(buildEdge(out, "smoke_test")).toBe(
      `build bun-debug.smoke-test-passed: smoke_test bun-debug${cfg.exeSuffix}`,
    );
    expect(buildEdge(out, "phony")).toBe(`build bun: phony bun-debug${cfg.exeSuffix}`);
  });

  // Cross-config path only: on macOS, resolveConfig({ os: "darwin" }) probes
  // xcode-select for the real SDK, which belongs to the native test above.
  // The ordering logic is identical to the smoke_test case.
  test.skipIf(isMacOS)("darwin release dsymutil is ordered after strip", () => {
    using dir = tempDir("build-post-link", {});
    const buildDir = String(dir);
    const cfg = resolveConfig({ os: "darwin", arch: "aarch64", buildType: "Release", buildDir }, mockToolchain());
    expect(cfg.canRunOnHost).toBe(false);

    const n = new Ninja({ buildDir });
    const exe = resolve(buildDir, "bun-profile");
    const { dsym } = emitPostLink(n, cfg, exe, "bun-profile", [], [exe + ".o"]);
    const out = n.toString();

    expect(dsym).toBe(resolve(buildDir, "bun-profile.dSYM"));
    expect(buildEdge(out, "dsymutil")).toBe("build bun-profile.dSYM: dsymutil bun-profile || bun");
    // Cross-compile: smoke_test short-circuits to a `check` phony (the
    // binary can't run on this host), so the strip race can't happen there;
    // the static scans (ClassInfo canary, verify-binary, duplicate
    // definitions) run on any host.
    expect(buildEdge(out, "phony")).toBe(
      "build check: phony bun-profile bun-profile.classinfo-unique bun-profile.binary-verified bun-profile.duplicate-symbols.txt",
    );
  });
});
