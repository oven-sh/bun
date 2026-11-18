/**
 * The step that generates the removable features (scripts/build/aot.ts) has to declare every file that its script
 * writes, as the bindgen step does: test/internal/build-codegen-declared-outputs.test.ts says why.
 */
import { describe, expect, test } from "bun:test";
import { bunExe, bunRun, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { emitRemovableFeatures, removableFeaturesJson } from "../../scripts/build/aot.ts";
import { registerCodegenRules, type CodegenOutputs } from "../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja, readManifest, type ManifestEdge } from "../../scripts/build/ninja.ts";
import { quote } from "../../scripts/build/shell.ts";
import type { Sources } from "../../scripts/glob-sources.ts";

/** A fully-populated fake toolchain. */
function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "23.1.1",
    clangResourceDir: "/fake/llvm/lib/clang/23",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLlvmVersion: "23.1.1",
    rustSysroot: undefined,
    rustHostTriple: undefined,
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    readobj: "/fake/llvm/bin/llvm-readobj",
    objdump: "/fake/llvm/bin/llvm-objdump",
    cxxfilt: "/fake/llvm/bin/llvm-cxxfilt",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: bunExe(),
    // A shell command prefix, quoted like the one configure makes.
    jsRuntime: quote(bunExe(), process.platform === "win32"),
    esbuild: "/fake/bin/esbuild",
    ccache: undefined,
    cmake: "/fake/bin/cmake",
    cargo: undefined,
    cargoHome: undefined,
    rustupHome: undefined,
    msvcLinker: undefined,
    rc: undefined,
    nasm: undefined,
  };
}

interface Configured {
  cfg: Config;
  n: Ninja;
  o: CodegenOutputs;
  dirStamp: string;
}

/**
 * A linux-x64 debug target in `buildDir` (resolves on every host once told where
 * its sysroot is; the path is only recorded), with the rules the codegen
 * emitters reference registered and the empty output groups emitCodegen hands
 * them. Nothing is written to `buildDir`.
 */
function configure(buildDir: string): Configured {
  const cfg = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const n = new Ninja({ buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
  const o: CodegenOutputs = {
    all: [],
    generatedTypes: [],
    rustInputs: [],
    cppSources: [],
    cppHeaders: [],
    cppAll: [],
    internalModulesAsm: resolve(cfg.codegenDir, "InternalModuleRegistryConstants.S"),
    internalModulesBin: resolve(cfg.codegenDir, "InternalModuleRegistryConstants.bin"),
    rootInstall: resolve(buildDir, "stamps", "install.stamp"),
  };
  return { cfg, n, o, dirStamp: resolve(cfg.codegenDir, ".dir") };
}

/** Just the lists the emitter under test reads; it never looks at the rest of `Sources`. */
function sourceLists(lists: Partial<Sources>): Sources {
  return lists as Sources;
}

/**
 * The outputs of the `build` line in `n` that produces `output`, spelled as in
 * build.ninja (buildDir-relative), sorted. Ninja.build() also declares every
 * build-dir output under its absolute path (so depfile entries resolve to the
 * edge); those aliases are checked to be exactly the relative set and dropped.
 */
function edgeOutputs(n: Ninja, output: string): string[] {
  const lines = n
    .toString()
    .replace(/ \$\n +/g, " ")
    .split("\n");
  for (const line of lines) {
    if (!line.startsWith("build ")) continue;
    const outputs = line
      .slice("build ".length, line.search(/(?<!\$): /))
      .split(/(?<!\$) /)
      .filter(token => token !== "|");
    if (!outputs.includes(n.rel(output))) continue;
    const unescaped = outputs.map(o => o.replaceAll("$:", ":"));
    const relative = unescaped.filter(o => !isAbsolute(o)).sort();
    const aliases = unescaped.filter(o => isAbsolute(o)).sort();
    expect(aliases).toEqual(relative.map(o => resolve(n.buildDir, o)).sort());
    return relative;
  }
  throw new Error(`no build edge produces ${output}`);
}

/** The edge in `n` that produces `output`, read back from the text of build.ninja. */
function edgeOf(n: Ninja, output: string): ManifestEdge {
  const edge = readManifest(n.toString()).edges.find(edge => edge.outputs.includes(n.rel(output)));
  if (edge === undefined) throw new Error(`no build edge produces ${output}`);
  return edge;
}

/** The inputs of that edge, explicit, implicit and order-only alike, spelled as in build.ninja. */
function edgeInputs(n: Ninja, output: string): string[] {
  const edge = edgeOf(n, output);
  return [...edge.inputs, ...edge.implicitInputs, ...edge.orderOnlyInputs];
}

/** `names` in the codegen dir, spelled as in build.ninja, sorted. */
function inCodegenDir({ cfg, n }: Configured, names: string[]): string[] {
  return names.map(name => n.rel(resolve(cfg.codegenDir, name))).sort();
}

/** `paths` normalized, sorted. */
function normalized(paths: string[]): string[] {
  return paths.map(p => resolve(p)).sort();
}

// The tests below that run a generator script run it under the build being tested; a debug build takes a few seconds to
// load one, more than the 5s default allows for.
const generatorTimeout = 60_000;

describe("emitRemovableFeatures", () => {
  test("declares the Rust file, the header and the JSON file on one edge", () => {
    using dir = tempDir("build-aot-removable-features", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));
    const script = resolve(cfg.cwd, "src", "codegen", "generate-removable-features.ts");
    const definitions = resolve(cfg.cwd, "src", "trim", "features", "engine.def");

    emitRemovableFeatures({ n, cfg, sources: sourceLists({ removableFeatures: [definitions] }), o, dirStamp });

    const rust = resolve(cfg.codegenDir, "removable_features.rs");
    const header = resolve(cfg.codegenDir, "BunRemovableFeatures.h");
    const json = resolve(cfg.codegenDir, "removable-features.json");
    expect(removableFeaturesJson(cfg)).toBe(json);
    expect(edgeOutputs(n, json)).toEqual([rust, header, json].map(p => n.rel(p)).sort());
    expect(o.rustInputs).toEqual([rust]);
    expect(o.cppHeaders).toEqual([header]);
    expect(o.cppSources).toEqual([]);
    expect(normalized(o.all)).toEqual(normalized([rust, header, json]));

    const inputs = edgeInputs(n, json);
    expect(inputs).toContain(n.rel(definitions));
    expect(inputs.filter(input => input === n.rel(script))).toHaveLength(1);
  });

  test.concurrent(
    "declares exactly the files generate-removable-features.ts writes",
    async () => {
      using dir = tempDir("build-aot-removable-features-generate", {});
      const c = configure(String(dir));
      const { cfg, n, o, dirStamp } = c;

      emitRemovableFeatures({ n, cfg, sources: sourceLists({ removableFeatures: [] }), o, dirStamp });

      const script = resolve(cfg.cwd, "src", "codegen", "generate-removable-features.ts");
      expect(await bunRun(["run", script, cfg.cwd, cfg.codegenDir])).toSpawn("");

      expect(edgeOutputs(n, removableFeaturesJson(cfg))).toEqual(inCodegenDir(c, readdirSync(cfg.codegenDir)));
    },
    generatorTimeout,
  );
});
