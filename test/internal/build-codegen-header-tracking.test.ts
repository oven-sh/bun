/**
 * Pins how scripts/build tracks generated headers between the step that writes
 * them and the compiles that include them (the PCH above all).
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
 * hand. The compile constructors reject the absolute spelling outright, and a
 * direct dep that includes another dep's generated headers (libarchive, libspng,
 * lsquic -> zlib's zlib.h) gets them as implicit inputs on top of that.
 *
 * Pure ninja-emission logic: no compiler, ninja, or subprocess; runs on every host.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { basename, join, relative, resolve } from "node:path";

import { bunCompileFlags } from "../../scripts/build/bun.ts";
import { emitJsModules, registerCodegenRules, type CodegenOutputs } from "../../scripts/build/codegen.ts";
import { cc, cxx, includeFlags, pch, registerCompileRules, registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { computeFlags } from "../../scripts/build/flags.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import {
  depBuildDir,
  registerDepRules,
  resolveDep,
  type Dependency,
  type ResolvedDep,
} from "../../scripts/build/source.ts";
import type { Sources } from "../../scripts/glob-sources.ts";

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
 * A linux-x64 debug target resolves on every host once it is told where its
 * sysroot is (the path is only recorded, never opened).
 */
function linuxDebugConfig(buildDir: string, toolchain: Partial<Toolchain> = {}): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(toolchain),
  );
}

/** One emitted edge: its `build` line with continuations unwrapped, and its variable bindings. */
interface Edge {
  outputs: string[];
  /** Everything after `: rule`, i.e. `inputs | implicit || order-only`, as written. */
  deps: string;
  vars: Record<string, string>;
}

/** The edge producing `output` (spelled as ninja.ts writes it), or undefined. */
function edgeProducing(ninja: string, output: string): Edge | undefined {
  const lines = ninja.replace(/ \$\n +/g, " ").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("build ")) continue;
    const colon = line.indexOf(": ");
    const outputs = line.slice("build ".length, colon).split(" ");
    if (!outputs.includes(output)) continue;
    const afterRule = line.slice(colon + 2).replace(/^\S+ ?/, "");
    const vars: Record<string, string> = {};
    for (let j = i + 1; j < lines.length && lines[j]!.startsWith("  "); j++) {
      const eq = lines[j]!.indexOf(" = ");
      vars[lines[j]!.slice(2, eq)] = lines[j]!.slice(eq + " = ".length);
    }
    return { outputs, deps: afterRule, vars };
  }
  return undefined;
}

/** The `| implicit` section of an edge's dependency list. */
function implicitInputs(edge: Edge): string[] {
  const match = / \| (.*?)(?: \|\| |$)/.exec(edge.deps);
  return match === null ? [] : match[1]!.split(" ");
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

describe("compile constructors", () => {
  function compileSetup(buildDir: string): { cfg: Config; n: Ninja } {
    const cfg = linuxDebugConfig(buildDir);
    const n = new Ninja({ buildDir });
    registerDirStamps(n, cfg);
    registerCompileRules(n, cfg);
    return { cfg, n };
  }

  test("cc, cxx and pch reject a build-dir include spelled absolutely", () => {
    using dir = tempDir("build-compile-assert", {});
    const buildDir = String(dir);
    const { cfg, n } = compileSetup(buildDir);
    const absolute = `-I${join(buildDir, "codegen")}`;

    expect(() => cc(n, cfg, "src/fake.c", { flags: [absolute] })).toThrow("spelled absolutely");
    expect(() => cxx(n, cfg, "src/fake.cpp", { flags: ["-std=gnu++23", absolute] })).toThrow("spelled absolutely");
    expect(() => pch(n, cfg, "src/jsc/bindings/root-pch.h", { flags: [absolute] })).toThrow("spelled absolutely");
    // The build dir itself, and a flag emitDirect has quote()d as a whole.
    expect(() => cc(n, cfg, "src/fake.c", { flags: [`-I${buildDir}`] })).toThrow("spelled absolutely");
    expect(() => cc(n, cfg, "src/fake.c", { flags: [`'-I${join(buildDir, "deps", "zlib")}'`] })).toThrow(
      "spelled absolutely",
    );
  });

  test("the includeFlags() spelling and source-tree includes are accepted as they are", () => {
    using dir = tempDir("build-compile-assert", {});
    const buildDir = String(dir);
    const { cfg, n } = compileSetup(buildDir);
    const flags = includeFlags(n, [join(buildDir, "codegen"), buildDir, join(cfg.cwd, "src", "jsc", "bindings")]);

    const object = cc(n, cfg, "src/fake.c", { flags });
    const edge = edgeProducing(n.toString(), n.rel(object));
    expect(edge?.vars.cflags).toBe(`-Icodegen -I. -I${join(cfg.cwd, "src", "jsc", "bindings")}`);
  });
});

describe("emitDirect", () => {
  /**
   * A direct dep generating one header into its build dir, and a second direct
   * dep whose sources include it (the libarchive/libspng/lsquic -> zlib shape),
   * with one source per compile constructor emitDirect dispatches to. Both deps
   * live inside the scratch build dir so nothing under the repo is read or
   * touched; their source files only have to exist as paths.
   */
  test("a fetchDeps producer's generated headers are implicit inputs, included via the declared spelling", () => {
    using dir = tempDir("build-direct-dep", { "producer-src/.keep": "", "consumer-src/.keep": "" });
    const buildDir = String(dir);
    const cfg = linuxDebugConfig(buildDir, { nasm: "/fake/bin/nasm" });
    const n = new Ninja({ buildDir });
    registerDirStamps(n, cfg);
    registerCompileRules(n, cfg);
    registerDepRules(n, cfg);

    const producer: Dependency = {
      name: "producer",
      source: () => ({ kind: "local", path: join(buildDir, "producer-src") }),
      build: () => ({
        kind: "direct",
        sources: ["p.c"],
        headers: { "gen.h": { from: "gen.h.in" } },
      }),
      provides: () => ({ libs: [], includes: [] }),
    };
    const consumer: Dependency = {
      name: "consumer",
      source: () => ({ kind: "local", path: join(buildDir, "consumer-src") }),
      fetchDeps: ["producer"],
      build: cfg => ({
        kind: "direct",
        sources: ["c.c", "cxx.cpp", "asm.asm"],
        includes: [depBuildDir(cfg, "producer")],
      }),
      provides: () => ({ libs: [], includes: [] }),
    };

    const resolved = new Map<string, ResolvedDep>();
    const producerDep = resolveDep(n, cfg, producer, resolved)!;
    resolved.set(producer.name, producerDep);
    const consumerDep = resolveDep(n, cfg, consumer, resolved)!;

    const generatedHeader = resolve(depBuildDir(cfg, "producer"), "gen.h");
    expect(producerDep.outputs).toContain(generatedHeader);

    const ninja = n.toString();
    expect(edgeProducing(ninja, n.rel(generatedHeader))).toBeDefined();

    expect(consumerDep.objects).toHaveLength(3);
    const edges = consumerDep.objects.map(object => edgeProducing(ninja, n.rel(object))!);
    // Implicit, not order-only, on every object (cc, cxx and nasm alike): a
    // regenerated gen.h or a re-fetched producer rebuilds them in the run that
    // regenerated it.
    const producerOutputs = producerDep.outputs.map(o => n.rel(o));
    for (const edge of edges) {
      expect(implicitInputs(edge)).toEqual(expect.arrayContaining(producerOutputs));
    }
    // And the -I is the spelling gen.h is declared under, so the depfile agrees.
    const [cEdge, cxxEdge] = edges;
    const expectedInclude = `-I${relative(buildDir, depBuildDir(cfg, "producer"))}`;
    expect(cEdge!.vars.cflags!.split(" ").filter(f => f.startsWith("-I"))).toEqual([expectedInclude]);
    expect(cxxEdge!.vars.cxxflags!.split(" ").filter(f => f.startsWith("-I"))).toEqual([expectedInclude]);
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
    // Declared on the same edge as the headers bundle-modules.ts itself reports.
    expect(edge!.outputs).toContain(n.rel(resolve(cfg.codegenDir, "InternalModuleRegistry+enum.h")));
  });
});
