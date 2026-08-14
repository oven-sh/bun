/**
 * Regression tests for the ordering scripts/build emits into build.ninja.
 *
 * Post-link steps (strip, smoke test, dsymutil — scripts/build/bun.ts): the
 * smoke_test and dsymutil rule commands are wrapped through `cfg.jsRuntime`
 * (= process.execPath). When `bun` on PATH resolves inside the build
 * directory, that path is the strip output itself (build/release/bun), and
 * without an ordering edge ninja will run strip and the wrapper exec
 * concurrently, failing with "Permission denied" on the half-written file.
 *
 * Scheduling order (scripts/build/ninja.ts `BuildNode.priority`): ninja starts
 * ready edges of equal depth in file order, so the long edges (cargo, the big
 * unified bundles) have to be written first or a fresh build starts them
 * after ~1100 dep objects. These tests pin the writer's ordering, the
 * largest-first source order it relies on.
 *
 * These exercise the ninja-emission logic only (no compiler or ninja needed),
 * so they run on every host.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, tempDir } from "harness";
import { basename, join, resolve } from "node:path";

import { emitPostLink } from "../../scripts/build/bun.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja, SchedulePriority } from "../../scripts/build/ninja.ts";
import { emitRust, registerRustRules } from "../../scripts/build/rust.ts";
import { generateUnifiedSources } from "../../scripts/build/unified.ts";

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
function buildEdge(ninja: string, rule: string): string {
  const flat = ninja.replace(/ \$\n +/g, " ");
  const line = flat.split("\n").find(l => l.startsWith("build ") && l.includes(`: ${rule} `));
  if (line === undefined) throw new Error(`no '${rule}' edge in ninja output:\n${ninja}`);
  return line;
}

describe("emitPostLink ninja ordering", () => {
  test("release smoke_test is ordered after strip", () => {
    using dir = tempDir("build-post-link", {});
    const buildDir = String(dir);
    const cfg = hostConfig({ buildType: "Release" }, buildDir);
    expect(cfg.canRunOnHost).toBe(true);

    const n = new Ninja({ buildDir });
    const exe = resolve(buildDir, `bun-profile${cfg.exeSuffix}`);
    const { strippedExe } = emitPostLink(n, cfg, exe, "bun-profile", []);
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
    const { strippedExe, dsym } = emitPostLink(n, cfg, exe, "bun-debug", []);
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
    const { dsym } = emitPostLink(n, cfg, exe, "bun-profile", []);
    const out = n.toString();

    expect(dsym).toBe(resolve(buildDir, "bun-profile.dSYM"));
    expect(buildEdge(out, "dsymutil")).toBe("build bun-profile.dSYM: dsymutil bun-profile || bun");
    // Cross-compile: smoke_test short-circuits to a `check` phony (the
    // binary can't run on this host), so the strip race can't happen there.
    expect(buildEdge(out, "phony")).toBe("build check: phony bun-profile");
  });
});

/** Outputs of every build statement, in file order (continuations unwrapped). */
function buildOrder(ninja: string): string[] {
  return ninja
    .replace(/ \$\n +/g, " ")
    .split("\n")
    .filter(l => l.startsWith("build "))
    .map(l => l.slice("build ".length, l.indexOf(":")));
}

/**
 * A linux-x64 target resolves on every host once it is told where its sysroot
 * is (the path is only recorded, never opened), which keeps these independent
 * of the machine running the tests. `lto` is passed explicitly because its
 * default also depends on `ci`.
 */
function linuxConfig(partial: PartialConfig, buildDir: string, toolchain = mockToolchain()): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", buildDir, linuxSysroot: buildDir, ...partial },
    toolchain,
  );
}

describe("scheduling order", () => {
  test("prioritized statements are written after every rule and before everything else, highest first, stable", () => {
    using dir = tempDir("build-schedule", {});
    const n = new Ninja({ buildDir: String(dir) });
    n.rule("early", { command: "early $out" });
    n.build({ outputs: ["plain-1"], rule: "early", inputs: [] });
    n.build({ outputs: ["low-a"], rule: "early", inputs: [], priority: 100, vars: { flags: "-a" }, pool: "console" });
    n.build({ outputs: ["plain-2"], rule: "early", inputs: [] });
    // Declared after statements that get hoisted above them: rules must
    // still all precede the first build statement or ninja rejects the file,
    // and a top-level variable defined this late must still be visible to
    // the hoisted statements that reference it.
    n.rule("late", { command: "late $late_flags $out" });
    n.variable("late_flags", "-x");
    n.build({ outputs: ["high"], rule: "late", inputs: [], priority: 300 });
    n.build({ outputs: ["low-b"], rule: "early", inputs: [], priority: 100 });
    const out = n.toString();

    expect(buildOrder(out)).toEqual(["high", "low-a", "low-b", "plain-1", "plain-2"]);
    const firstBuild = out.indexOf("\nbuild ");
    expect(out.indexOf("rule late")).toBeLessThan(firstBuild);
    expect(out.indexOf("late_flags = -x")).toBeLessThan(firstBuild);
    // Priority only moves a statement; its body is written unchanged.
    expect(out).toContain("build low-a: early\n  pool = console\n  flags = -a\n");
    expect(() => n.variable("late_flags", "-y")).toThrow("Duplicate ninja variable: late_flags");
  });

  test("without priorities the writer keeps emission order and emits no scheduling section", () => {
    using dir = tempDir("build-schedule", {});
    const n = new Ninja({ buildDir: String(dir) });
    n.rule("r", { command: "r $out" });
    n.build({ outputs: ["b"], rule: "r", inputs: [] });
    n.build({ outputs: ["a"], rule: "r", inputs: [] });
    const out = n.toString();
    expect(buildOrder(out)).toEqual(["b", "a"]);
    expect(out).not.toContain("Scheduling order");
  });

  test("the cargo edge is hoisted ahead of statements emitted before it", () => {
    using dir = tempDir("build-schedule", {});
    const buildDir = String(dir);
    const cfg = linuxConfig({ lto: false }, buildDir, mockToolchain({ cargo: "/fake/bin/cargo" }));
    const n = new Ninja({ buildDir });
    registerRustRules(n, cfg);
    // Stands in for the ~1100 dep objects emitBun emits before emitRust().
    n.rule("cc", { command: "cc $out" });
    const depObject = resolve(buildDir, "obj/vendor/dep.c.o");
    n.build({ outputs: [depObject], rule: "cc", inputs: [] });
    const [lib] = emitRust(n, cfg, { codegenInputs: [], codegenOrderOnly: [], rustSources: [], vendorStamps: [] });

    // n.rel() is how the writer spells both paths (native separators).
    const order = buildOrder(n.toString());
    const libIndex = order.indexOf(n.rel(lib!));
    const depIndex = order.indexOf(n.rel(depObject));
    expect({ libFound: libIndex >= 0, depFound: depIndex >= 0 }).toEqual({ libFound: true, depFound: true });
    expect(libIndex).toBeLessThan(depIndex);
    expect(SchedulePriority.cargo).toBeGreaterThan(SchedulePriority.unifiedBundle);
  });

  test("unified bundles and standalone sources come back largest first", () => {
    const big = Buffer.alloc(4000, "x").toString();
    const small = "int x;\n";
    using dir = tempDir("build-schedule", {
      // Directory names sort the small inputs first; the result must not.
      "a_small/one.cpp": small,
      "a_small/two.cpp": small,
      "b_big/one.cpp": big,
      "b_big/two.cpp": big,
      // A directory with a single file compiles standalone.
      "c_alone_small/only.cpp": small,
      "d_alone_big/only.cpp": big,
    });
    const root = String(dir);
    const buildDir = join(root, "build");
    // Debug: 8 files per bundle, so each two-file directory is one bundle.
    const cfg = linuxConfig({ buildType: "Debug", asan: false }, buildDir);
    const sources = [
      "a_small/one.cpp",
      "a_small/two.cpp",
      "b_big/one.cpp",
      "b_big/two.cpp",
      "c_alone_small/only.cpp",
      "d_alone_big/only.cpp",
    ].map(p => join(root, p));

    const split = generateUnifiedSources(cfg, sources);

    expect(split.unified.map(p => basename(p))).toEqual([
      expect.stringMatching(/^UnifiedSource-.*b_big-0\.cpp$/),
      expect.stringMatching(/^UnifiedSource-.*a_small-0\.cpp$/),
    ]);
    expect(split.standalone).toEqual([join(root, "d_alone_big/only.cpp"), join(root, "c_alone_small/only.cpp")]);
    expect(split.bundled.sort()).toEqual(sources.slice(0, 4).sort());
  });
});
