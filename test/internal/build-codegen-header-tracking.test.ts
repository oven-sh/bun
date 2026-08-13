/**
 * Pins how scripts/build tracks generated headers between codegen and the
 * compiles that include them (the PCH above all).
 *
 * Codegen headers are order-only inputs of the PCH/cxx/cc edges; the compiler's
 * depfile is what makes a later change to one of them rebuild the compile. Ninja
 * matches a depfile entry to a build output by string, and the compiler writes
 * each header as `<-I dir>/<name>`, so the `-I` for a directory inside the build
 * dir has to be spelled the way ninja.ts spells the outputs declared there
 * (buildDir-relative). With `-I/abs/build/codegen`, the PCH depended on
 * `/abs/build/codegen/X.h`, a node without an edge that ninja stats once at
 * startup, so a codegen rerun in the same `bun bd` left the PCH as it was and
 * every TU failed against it; the next `bun bd` then rebuilt the PCH. This only
 * works for headers that ARE declared outputs, which is why the otherwise
 * unreported BunBuiltinNames+extras.h (reached from root-pch.h) is declared by
 * hand.
 *
 * Pure ninja-emission logic: no compiler, ninja, or subprocess; runs on every host.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { basename, join, resolve } from "node:path";

import type { Sources } from "../../scripts/glob-sources.ts";
import { bunCompileFlags } from "../../scripts/build/bun.ts";
import { emitJsModules, registerCodegenRules, type CodegenOutputs } from "../../scripts/build/codegen.ts";
import { includeFlags, registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { computeFlags } from "../../scripts/build/flags.ts";
import { Ninja } from "../../scripts/build/ninja.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(): Toolchain {
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
  };
}

/**
 * A linux-x64 debug target resolves on every host once it is told where its
 * sysroot is (the path is only recorded, never opened).
 */
function linuxDebugConfig(buildDir: string): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
}

/** The `build` line (continuations unwrapped) whose outputs include `output`, or undefined. */
function edgeProducing(ninja: string, output: string): string | undefined {
  const flat = ninja.replace(/ \$\n +/g, " ");
  return flat
    .split("\n")
    .filter(l => l.startsWith("build "))
    .find(l => l.slice("build ".length, l.indexOf(": ")).split(" ").includes(output));
}

describe("includeFlags", () => {
  test("directories inside buildDir are spelled the way ninja spells the outputs in them", () => {
    using dir = tempDir("build-include-flags", {});
    const buildDir = String(dir);
    const n = new Ninja({ buildDir });

    const codegenDir = join(buildDir, "codegen");
    const depDir = join(buildDir, "deps", "zlib");
    const sourceDir = resolve(buildDir, "..", "src", "jsc", "bindings");
    // Inside buildDir even though its relative spelling starts with "..".
    const dotDotNamed = join(buildDir, "..odd");

    expect(includeFlags(n, [codegenDir, buildDir, depDir, sourceDir, dotDotNamed])).toEqual([
      "-Icodegen",
      "-I.",
      `-I${join("deps", "zlib")}`,
      `-I${sourceDir}`,
      "-I..odd",
    ]);
  });

  test("the depfile entry for a codegen header is the string its edge declares", () => {
    using dir = tempDir("build-include-flags", {});
    const buildDir = String(dir);
    const n = new Ninja({ buildDir });
    const codegenDir = join(buildDir, "codegen");
    const header = join(codegenDir, "InternalModuleRegistry+enum.h");

    // The compiler records a header it found through `-I<dir>` as `<dir>/<name>`;
    // ninja.ts declares the codegen edge's output as n.rel(header). Unless the two
    // are the same string, the PCH's dependency on the header is on a node no
    // edge produces, and a codegen rerun is only noticed by the next build.
    const [flag] = includeFlags(n, [codegenDir]);
    const depfileEntry = join(flag!.slice("-I".length), basename(header));
    expect(depfileEntry).toBe(n.rel(header));
  });
});

describe("bunCompileFlags", () => {
  test("the PCH/cxx/cc flag lists spell codegen/ and buildDir-local dep includes relative", () => {
    using dir = tempDir("build-compile-flags", {});
    const buildDir = String(dir);
    const cfg = linuxDebugConfig(buildDir);
    const n = new Ninja({ buildDir });

    // One dep whose headers are generated into the build dir (zlib's zconf.h)
    // and one whose headers sit in the source tree.
    const generatedDepInclude = join(buildDir, "deps", "zlib");
    const vendoredDepInclude = join(cfg.vendorDir, "zstd", "lib");
    const { cxxflags, cflags } = bunCompileFlags(n, cfg, computeFlags(cfg), [generatedDepInclude, vendoredDepInclude]);

    for (const list of [cxxflags, cflags]) {
      const includes = list.filter(f => f.startsWith("-I"));
      expect(includes).toContain("-Icodegen");
      expect(includes).toContain("-I.");
      expect(includes).toContain(`-I${join("deps", "zlib")}`);
      expect(includes).toContain(`-I${vendoredDepInclude}`);
      expect(includes).toContain(`-I${join(cfg.cwd, "src", "jsc", "bindings")}`);
      // No include dir inside the build dir may be spelled absolutely: a depfile
      // entry under that spelling would not be the declared codegen output.
      expect(includes.filter(f => f.slice("-I".length).startsWith(buildDir))).toEqual([]);
    }
  });
});

describe("emitJsModules", () => {
  test("declares BunBuiltinNames+extras.h, which root-pch.h reaches", () => {
    using dir = tempDir("build-codegen-outputs", {});
    const buildDir = String(dir);
    const cfg = linuxDebugConfig(buildDir);
    const n = new Ninja({ buildDir });
    registerDirStamps(n, cfg);
    registerCodegenRules(n, cfg);

    // What emitCodegen hands each step: empty output groups to push into, plus
    // the two paths it pre-computes for the .S/.bin pair.
    const o: CodegenOutputs = {
      all: [],
      rustInputs: [],
      rustOrderOnly: [],
      cppSources: [],
      cppHeaders: [],
      cppAll: [],
      bindgenV2Cpp: [],
      internalModulesAsm: resolve(cfg.codegenDir, "InternalModuleRegistryConstants.S"),
      internalModulesBin: resolve(cfg.codegenDir, "InternalModuleRegistryConstants.bin"),
      rootInstall: resolve(buildDir, "stamps", "install.stamp"),
    };
    const sources = {
      js: [resolve(cfg.cwd, "src", "js", "node", "fs.ts")],
      jsCodegen: [resolve(cfg.cwd, "src", "codegen", "bundle-functions.ts")],
    } as Sources;
    emitJsModules({ n, cfg, sources, o, dirStamp: resolve(cfg.codegenDir, ".dir") });

    // bundle-functions.ts writes this header (BunBuiltinNames.h includes it, and
    // root-pch.h includes that) without reporting it. It has to be a declared
    // output for the PCH's depfile entry to resolve to this edge, and it has to be
    // in cppHeaders so the PCH (order-only on cppAll) waits for it on a fresh build.
    const extras = resolve(cfg.codegenDir, "BunBuiltinNames+extras.h");
    expect(o.cppHeaders).toContain(extras);

    const edge = edgeProducing(n.toString(), n.rel(extras));
    expect(edge).toBeDefined();
    expect(edge).toContain(": codegen ");
    // Declared on the same edge as the headers bundle-modules.ts itself reports.
    expect(edge).toContain(n.rel(resolve(cfg.codegenDir, "InternalModuleRegistry+enum.h")));
  });
});
