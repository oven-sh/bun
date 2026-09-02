/**
 * scripts/build/exception-lint.ts loads the jsc-exception-lint clang plugin
 * into every compile of bun's own C++. Pure config evaluation, no compiler is
 * spawned: the plugin is detected from the layout of the LLVM install, the
 * flags it adds must stay out of compile_commands.json (clangd and the
 * standalone tool read that) and must not contain an absolute path (ccache
 * keys are shared across checkouts through CCACHE_BASEDIR).
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows, tempDir } from "harness";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cxx, registerCompileRules, registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { BuildError } from "../../scripts/build/error.ts";
import { emitExceptionLint, registerExceptionLintRules } from "../../scripts/build/exception-lint.ts";
import { Ninja } from "../../scripts/build/ninja.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(cxxPath = "/fake/llvm/bin/clang++"): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: cxxPath,
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
    nm: "/fake/llvm/bin/llvm-nm",
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

/**
 * A linux-x64 debug target in `buildDir`; it resolves on every host once told
 * where its sysroot is (the path is only recorded).
 */
function linuxConfig(partial: PartialConfig, buildDir: string, toolchain = mockToolchain()): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir, ...partial },
    toolchain,
  );
}

/** The plugin is a host artifact: its extension follows the host, not the target. */
const pluginExt = isMacOS ? ".dylib" : ".so";

/**
 * The layout findLlvmDevDir looks for: a clang++ whose real path is two
 * levels below the install root, the plugin registry header, and libclang-cpp.
 * Returns the path of that clang++.
 */
function fakeLlvmInstall(root: string): string {
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "include", "clang", "Frontend"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "bin", "clang++"), "");
  writeFileSync(join(root, "include", "clang", "Frontend", "FrontendPluginRegistry.h"), "");
  writeFileSync(join(root, "lib", "libclang-cpp.so.21.1"), "");
  return join(root, "bin", "clang++");
}

describe("jsc-exception-lint in the build", () => {
  test("off, and not configurable on, without the clang development headers", () => {
    using dir = tempDir("build-exception-lint", {});
    const cfg = linuxConfig({}, String(dir));
    expect({ llvmDevDir: cfg.llvmDevDir, exceptionLint: cfg.exceptionLint }).toEqual({
      llvmDevDir: undefined,
      exceptionLint: false,
    });
    expect(() => linuxConfig({ exceptionLint: true }, String(dir))).toThrow(BuildError);

    const n = new Ninja({ buildDir: String(dir) });
    registerExceptionLintRules(n, cfg);
    expect(emitExceptionLint(n, cfg)).toBeUndefined();
    expect(n.toString()).not.toContain("clang_plugin");
  });

  // A Windows host never loads the plugin (clang-cl), whatever the install
  // layout, so the detection is not exercised there.
  test.skipIf(isWindows)("on by default when the headers sit next to clang++", () => {
    using dir = tempDir("build-exception-lint", {});
    const llvm = join(String(dir), "llvm");
    const cfg = linuxConfig({}, join(String(dir), "build"), mockToolchain(fakeLlvmInstall(llvm)));
    expect({ llvmDevDir: cfg.llvmDevDir, exceptionLint: cfg.exceptionLint }).toEqual({
      llvmDevDir: realpathSync(llvm),
      exceptionLint: true,
    });
    const toolchain = mockToolchain(fakeLlvmInstall(llvm));
    expect(linuxConfig({ exceptionLint: false }, join(String(dir), "build"), toolchain).exceptionLint).toBe(false);
    // The check models the ThrowScope validator of assertion builds; a plain
    // release build has a trivial ThrowScope destructor and stays out.
    expect(linuxConfig({ buildType: "Release" }, join(String(dir), "build"), toolchain).exceptionLint).toBe(false);
    expect(linuxConfig({ buildType: "Release", asan: true }, join(String(dir), "build"), toolchain).exceptionLint).toBe(
      true,
    );
    expect(() =>
      linuxConfig({ buildType: "Release", exceptionLint: true }, join(String(dir), "build"), toolchain),
    ).toThrow(BuildError);
  });

  test.skipIf(isWindows)("the plugin flags reach ninja only, with no absolute path in them", () => {
    using dir = tempDir("build-exception-lint", {});
    const buildDir = join(String(dir), "build");
    const cfg = linuxConfig({}, buildDir, mockToolchain(fakeLlvmInstall(join(String(dir), "llvm"))));
    const n = new Ninja({ buildDir });
    registerDirStamps(n, cfg);
    registerCompileRules(n, cfg);
    registerExceptionLintRules(n, cfg);

    const lint = emitExceptionLint(n, cfg);
    expect(lint).toBeDefined();
    const { flags, implicitInputs } = lint!;
    expect(flags[0]).toBe(`-fplugin=jsc-exception-lint/libjsc-exception-lint-21.1.8${pluginExt}`);
    expect(flags).toContain("werror");
    expect(flags.filter(f => f.startsWith("data-hash="))).toEqual([expect.stringMatching(/^data-hash=[0-9a-f]{16}$/)]);
    // Every path is relative to the build dir, where ninja runs the compiler;
    // the plugin resolves `root` itself.
    for (const flag of flags) {
      expect(flag.replace(/^-?[a-z-]+=/, "")).not.toStartWith("/");
    }
    expect(implicitInputs.map(p => p.replace(buildDir, "<build>").replace(cfg.cwd, "<repo>"))).toEqual([
      `<build>/jsc-exception-lint/libjsc-exception-lint-21.1.8${pluginExt}`,
      "<repo>/scripts/jsc-exception-lint/nothrow.txt",
      "<repo>/scripts/jsc-exception-lint/summaries/webkit.tsv",
      "<repo>/scripts/jsc-exception-lint/summaries/bun.tsv",
      "<repo>/scripts/jsc-exception-lint/baseline.tsv",
    ]);

    const src = resolve(cfg.cwd, "src/jsc/bindings/BunObject.cpp");
    cxx(n, cfg, src, { flags: ["-O0"], ninjaOnlyFlags: flags, implicitInputs });
    const ninja = n.toString().replace(/ \$\n +/g, " ");
    expect(ninja).toContain("rule clang_plugin");
    expect(ninja).toContain(`-O0 -fplugin=jsc-exception-lint/libjsc-exception-lint-21.1.8${pluginExt} -Xclang`);
    // compile_commands.json is written by write(); the entries it would hold
    // are what clangd and the standalone tool read.
    const compileCommands = (n as unknown as { compileCommands: { arguments: string[] }[] }).compileCommands;
    expect(compileCommands).toHaveLength(1);
    const compileArgs = compileCommands[0]!.arguments;
    for (const flag of flags) {
      expect(compileArgs).not.toContain(flag);
    }
    expect(compileArgs.some(a => a.includes("plugin") || a.includes("data-hash"))).toBe(false);
  });
});
