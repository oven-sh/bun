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

import { emitDsymutil, emitSmokeTest } from "../../scripts/build/bun.ts";
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
    ...overrides,
  };
}

/**
 * Resolve a host-targeted config: no os/arch override, so `canRunOnHost` is
 * true and emitSmokeTest emits the real rule (not the phony short-circuit).
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
function buildEdge(ninja: string, rule: string): string {
  const flat = ninja.replace(/\$\n {2}/g, "");
  const line = flat.split("\n").find(l => l.startsWith("build ") && l.includes(`: ${rule} `));
  if (line === undefined) throw new Error(`no '${rule}' edge in ninja output:\n${ninja}`);
  return line;
}

describe("post-link ninja ordering", () => {
  test("release smoke_test is ordered after strip", () => {
    using dir = tempDir("build-post-link", {});
    const buildDir = String(dir);
    const cfg = hostConfig({ buildType: "Release" }, buildDir);
    expect(cfg.canRunOnHost).toBe(true);

    const n = new Ninja({ buildDir });
    const exe = resolve(buildDir, `bun-profile${cfg.exeSuffix}`);
    const strippedExe = resolve(buildDir, `bun${cfg.exeSuffix}`);
    emitSmokeTest(n, cfg, exe, "bun-profile", strippedExe);

    // strip writes `bun`; the smoke_test wrapper execs cfg.jsRuntime
    // (= `bun` here). Without `|| bun` ninja schedules them concurrently
    // and the wrapper sees a half-written file.
    expect(buildEdge(n.toString(), "smoke_test")).toBe(
      `build bun-profile.smoke-test-passed: smoke_test bun-profile${cfg.exeSuffix} || bun${cfg.exeSuffix}`,
    );
  });

  test("debug smoke_test has no strip dep (nothing to order against)", () => {
    using dir = tempDir("build-post-link", {});
    const buildDir = String(dir);
    const cfg = hostConfig({ buildType: "Debug", assertions: true }, buildDir);

    const n = new Ninja({ buildDir });
    const exe = resolve(buildDir, `bun-debug${cfg.exeSuffix}`);
    emitSmokeTest(n, cfg, exe, "bun-debug", undefined);

    expect(buildEdge(n.toString(), "smoke_test")).toBe(
      `build bun-debug.smoke-test-passed: smoke_test bun-debug${cfg.exeSuffix}`,
    );
  });

  // Cross-config path only: on macOS, resolveConfig({ os: "darwin" }) probes
  // xcode-select for the real SDK, which belongs to the native test above.
  // The ordering logic is identical to the smoke_test case.
  test.skipIf(isMacOS)("darwin release dsymutil is ordered after strip", () => {
    using dir = tempDir("build-post-link", {});
    const buildDir = String(dir);
    const cfg = resolveConfig({ os: "darwin", arch: "aarch64", buildType: "Release", buildDir }, mockToolchain());

    const n = new Ninja({ buildDir });
    const exe = resolve(buildDir, "bun-profile");
    const strippedExe = resolve(buildDir, "bun");
    emitDsymutil(n, cfg, exe, "bun-profile", strippedExe);

    expect(buildEdge(n.toString(), "dsymutil")).toBe("build bun-profile.dSYM: dsymutil bun-profile || bun");
  });
});
