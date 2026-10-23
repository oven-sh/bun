/**
 * The build steps of the ahead-of-time compiler (scripts/build/aot.ts: the removable features, the IR schema, the table
 * of built-ins, the archive of Bun's own sources) have to declare every file that their scripts write, as the bindgen
 * step does: test/internal/build-codegen-declared-outputs.test.ts says why. Their inputs are checked too: one generated
 * file orders each step behind the step it depends on.
 *
 * A graph has an engine (a checkout of JavaScriptCore that it compiles, or a prebuilt one) or none: without one only the
 * removable features are generated.
 */
import { describe, expect, test } from "bun:test";
import { bunExe, bunRun, tempDir } from "harness";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  builtinTableRust,
  builtinUsesJson,
  emitAotCodegen,
  emitAotSchema,
  emitAotSchemaUseCheck,
  emitBuiltinSources,
  emitBuiltinsTable,
  emitRemovableFeatures,
  engineFunctionsJson,
  registerAotRules,
  removableFeaturesJson,
  schemaHashHeader,
  schemaRustFiles,
  schemaUseCheckStamp,
  type EngineSources,
} from "../../scripts/build/aot.ts";
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
  registerAotRules(n, cfg);
  const o: CodegenOutputs = {
    all: [],
    generatedTypes: [],
    rustInputs: [],
    cppSources: [],
    builtinTableSources: [],
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

/** What follows the runtime in the command of that edge. */
function edgeArgs(n: Ninja, output: string): string {
  return edgeOf(n, output).bindings.args;
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

/** Only recorded in the graph: no emitter reads the files. */
function engineAt(javaScriptCore: string | undefined): EngineSources {
  return {
    javaScriptCore,
    schema: "/fake/engine/aot/ir/AOTSchema.def",
    schemaGenerator: "/fake/engine/aot/ir/generator/index.ts",
    schemaInputs: [
      "/fake/engine/aot/ir/AOTSchema.def",
      "/fake/engine/aot/ir/schema/limits.def",
      "/fake/engine/aot/ir/generator/index.ts",
    ],
    schemaGeneratedDirectory: javaScriptCore === undefined ? undefined : "/fake/build/DerivedSources/aot",
    schemaOutputs: javaScriptCore === undefined ? [] : ["/fake/build/DerivedSources/aot/AOTSchemaOperations.h"],
    schemaUsers: ["/fake/engine/aot/ir/AOTProgram.cpp"],
    directory: "/fake/engine/aot",
    builtinsGeneratedDirectory: "/fake/engine/aot/builtins/generated",
    builtinTableInputs: ["/fake/engine/aot/builtins/array.def"],
    builtinTableOutputs: ["/fake/engine/aot/builtins/generated/AOTBuiltinTableBuiltins.cpp"],
    builtinsLeftOut: [],
    requiresVerifiedOverloads: false,
  };
}
const checkout = engineAt("/fake/engine");
const prebuilt = engineAt(undefined);

/** Every list that the steps read, empty. */
function noSources(lists: Partial<Sources> = {}): Sources {
  return sourceLists({
    removableFeatures: [],
    aotRust: [],
    builtinsTableCodegen: [],
    bindgen: [],
    zigGeneratedClasses: [],
    js: [],
    jsCodegen: [],
    aotPrelude: [],
    nativeModuleLoadSites: [],
    nativeCallSites: [],
    ...lists,
  });
}

describe("emitRemovableFeatures", () => {
  test("declares the Rust file, the header and the JSON file on one edge", () => {
    using dir = tempDir("build-aot-removable-features", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));
    const script = resolve(cfg.cwd, "src", "codegen", "generate-removable-features.ts");
    const definitions = resolve(cfg.cwd, "src", "trim", "features", "engine.def");

    emitRemovableFeatures({ n, cfg, sources: noSources({ removableFeatures: [definitions] }), o, dirStamp });

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

      emitRemovableFeatures({ n, cfg, sources: noSources(), o, dirStamp });

      const script = resolve(cfg.cwd, "src", "codegen", "generate-removable-features.ts");
      expect(await bunRun(["run", script, cfg.cwd, cfg.codegenDir])).toSpawn("");

      expect(edgeOutputs(n, removableFeaturesJson(cfg))).toEqual(inCodegenDir(c, readdirSync(cfg.codegenDir)));
    },
    generatorTimeout,
  );
});

describe("emitAotSchema", () => {
  test("with a checkout of the engine it declares the engine's generated files and Bun's on one edge", () => {
    using dir = tempDir("build-aot-schema", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));

    emitAotSchema({ n, cfg, sources: noSources(), o, dirStamp, engine: checkout });

    const rust = schemaRustFiles(cfg);
    const outputs = [...checkout.schemaOutputs, ...rust, schemaHashHeader(cfg)];
    const edge = edgeOf(n, rust[0]);
    expect(edge.rule).toBe("codegen_bun");
    expect(normalized(edge.outputs.map(p => resolve(n.buildDir, p)))).toEqual(normalized(outputs));
    expect(normalized(o.all)).toEqual(normalized(outputs));
    expect(normalized(o.rustInputs)).toEqual(normalized(rust));
    expect(o.cppHeaders).toEqual([schemaHashHeader(cfg)]);
    expect(edgeInputs(n, rust[0])).toEqual(expect.arrayContaining(checkout.schemaInputs.map(p => n.rel(p))));
    expect(edgeArgs(n, rust[0])).toContain(checkout.schemaGenerator);
    expect(edgeArgs(n, rust[0])).toContain(`--engine-out ${checkout.schemaGeneratedDirectory}`);
  });

  test("with a prebuilt engine it writes Bun's half alone, by the generator and from the schema of the tarball", () => {
    using dir = tempDir("build-aot-schema-prebuilt", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));

    emitAotSchema({ n, cfg, sources: noSources(), o, dirStamp, engine: prebuilt });

    const rust = schemaRustFiles(cfg);
    const outputs = [...rust, schemaHashHeader(cfg)];
    expect(edgeOf(n, rust[0]).rule).toBe("codegen_bun");
    expect(normalized(edgeOf(n, rust[0]).outputs.map(p => resolve(n.buildDir, p)))).toEqual(normalized(outputs));
    expect(normalized(o.all)).toEqual(normalized(outputs));
    expect(normalized(o.rustInputs)).toEqual(normalized(rust));
    expect(edgeInputs(n, rust[0])).toEqual(expect.arrayContaining(prebuilt.schemaInputs.map(p => n.rel(p))));
    expect(edgeArgs(n, rust[0])).toContain(prebuilt.schemaGenerator);
    expect(edgeArgs(n, rust[0])).not.toContain("--engine-out");
  });
});

describe("emitAotSchemaUseCheck", () => {
  test("is a step of CI's graphs with a checkout of the engine, and of no other", () => {
    using dir = tempDir("build-aot-schema-uses", {});
    for (const [ci, engine, isThere] of [
      [true, checkout, true],
      [false, checkout, false],
      [true, prebuilt, false],
    ] as const) {
      const { cfg, n, o, dirStamp } = configure(String(dir));
      emitAotSchemaUseCheck({ n, cfg: { ...cfg, ci }, sources: noSources(), o, dirStamp, engine });
      expect({ ci, engine: engine.javaScriptCore, all: o.all }).toEqual({
        ci,
        engine: engine.javaScriptCore,
        all: isThere ? [schemaUseCheckStamp(cfg)] : [],
      });
      if (isThere)
        expect(edgeInputs(n, schemaUseCheckStamp(cfg))).toEqual(
          expect.arrayContaining([...checkout.schemaUsers, ...checkout.schemaOutputs].map(p => n.rel(p))),
        );
    }
  });

  const webkit = process.env.BUN_WEBKIT_PATH ?? resolve(import.meta.dirname, "..", "..", "vendor", "WebKit");
  const javaScriptCore = resolve(webkit, "Source", "JavaScriptCore");

  // CI links a prebuilt engine, which brings none of its C++: .github/workflows/lint.yml fetches it for this test.
  test.skipIf(process.env.BUN_WEBKIT_PATH === undefined && !existsSync(resolve(javaScriptCore, "b3", "B3Limits.h")))(
    "its command finds a use for every name of the schema, in a checkout of the engine and in this tree",
    async () => {
      using dir = tempDir("build-aot-schema-uses-run", {});
      const { cfg, n, o, dirStamp } = configure(String(dir));
      const engine = {
        ...engineAt(javaScriptCore),
        schema: resolve(javaScriptCore, "aot", "ir", "AOTSchema.def"),
        schemaGenerator: resolve(javaScriptCore, "aot", "ir", "generator", "index.ts"),
      };
      emitAotSchemaUseCheck({ n, cfg: { ...cfg, ci: true }, sources: noSources(), o, dirStamp, engine });
      expect(await bunRun(edgeArgs(n, schemaUseCheckStamp(cfg)).split(" "))).toSpawn("");
    },
    generatorTimeout,
  );
});

describe("emitBuiltinsTable", () => {
  const namesInCodegenDir = [
    "aot_builtin_ids.rs",
    "aot_builtin_table.rs",
    "aot_builtin_syntax.rs",
    "BunAOTHostBindings.cpp",
    "AOTBuiltinTableArrays.h",
    "AOTBuiltinTableAttachments.cpp",
    "AOTBuiltinTableBuiltins.cpp",
    "AOTBuiltinTableNames.cpp",
    "AOTBuiltinTableOverloads.cpp",
    "AOTBuiltinTableTypes.cpp",
    "builtin-uses.json",
    "aot_builtin_table.json",
    "aot_builtin_undescribed_results.txt",
    "aot_engine_functions.json",
  ];

  test("declares the three Rust tables, the C++ files, the four data files and the engine's files on one edge", () => {
    using dir = tempDir("build-aot-builtins-table", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));
    const script = resolve(cfg.cwd, "src", "codegen", "builtins", "index.ts");
    const prelude = resolve(cfg.cwd, "src", "aot", "prelude", "map-set.ts");

    emitBuiltinsTable({
      n,
      cfg,
      sources: noSources({ builtinsTableCodegen: [script], aotPrelude: [prelude] }),
      o,
      dirStamp,
      engine: checkout,
    });

    const inDir = namesInCodegenDir.map(name => resolve(cfg.codegenDir, name));
    const cpp = resolve(cfg.codegenDir, "BunAOTHostBindings.cpp");
    expect(
      [builtinTableRust(cfg), builtinUsesJson(cfg), engineFunctionsJson(cfg)].filter(p => !inDir.includes(p)),
    ).toEqual([]);
    expect(normalized(edgeOf(n, cpp).outputs.map(p => resolve(n.buildDir, p)))).toEqual(
      expect.arrayContaining(normalized([...inDir, ...checkout.builtinTableOutputs])),
    );
    expect(normalized(o.all)).toEqual(normalized([...inDir, ...checkout.builtinTableOutputs]));
    expect(normalized(o.rustInputs)).toEqual(normalized(inDir.filter(p => p.endsWith(".rs"))));
    const table = inDir.filter(p => /AOTBuiltinTable\w+\.cpp$/.test(p));
    expect(o.cppSources).toEqual([cpp, ...table]);
    expect(o.builtinTableSources).toEqual(table);
    expect(o.cppHeaders).toEqual([resolve(cfg.codegenDir, "AOTBuiltinTableArrays.h")]);

    const inputs = edgeInputs(n, cpp);
    expect(inputs).toEqual(
      expect.arrayContaining(
        [
          prelude,
          ...checkout.schemaInputs,
          ...checkout.builtinTableInputs,
          resolve(cfg.cwd, "src", "jsc", "bindings", "ZigGlobalObject.lut.txt"),
        ].map(p => n.rel(p)),
      ),
    );
    expect(inputs.filter(input => input === n.rel(script))).toHaveLength(1);
    expect(edgeArgs(n, cpp)).toContain(`--javascriptcore=${checkout.javaScriptCore}`);
    expect(edgeArgs(n, cpp)).not.toContain("--prebuilt-generated");
  });

  test("with a prebuilt engine it is told where that engine's generated files lie", () => {
    using dir = tempDir("build-aot-builtins-table-prebuilt", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));

    emitBuiltinsTable({
      n,
      cfg,
      sources: noSources(),
      o,
      dirStamp,
      engine: prebuilt,
    });

    const args = edgeArgs(n, builtinTableRust(cfg));
    expect(args).toContain(`--prebuilt-generated=${prebuilt.builtinsGeneratedDirectory}`);
    expect(args).not.toContain("--javascriptcore=");
  });
});

describe("emitBuiltinSources", () => {
  test("declares the manifest and the archive, and runs behind the table of built-ins", () => {
    using dir = tempDir("build-aot-builtin-sources", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));

    emitBuiltinSources({ n, cfg, sources: noSources(), o, dirStamp, engine: checkout });

    const manifest = resolve(cfg.codegenDir, "builtins.manifest");
    const archive = resolve(cfg.codegenDir, "builtin_sources.bin");
    expect(edgeOutputs(n, archive)).toEqual([manifest, archive].map(p => n.rel(p)).sort());
    expect(normalized(o.all)).toEqual(normalized([manifest, archive]));
    expect(o.builtinSourcesArchive).toBe(archive);
    // A file that the table's step writes: ninja runs this step behind it.
    expect(edgeInputs(n, archive)).toContain(n.rel(engineFunctionsJson(cfg)));
    expect(edgeArgs(n, archive)).toContain(`--engine-functions=${engineFunctionsJson(cfg)}`);
  });
});

describe("emitAotCodegen", () => {
  test("without an engine it generates the removable features and nothing else", () => {
    using dir = tempDir("build-aot-codegen-no-engine", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));

    emitAotCodegen({ n, cfg, sources: noSources(), o, dirStamp });

    expect(normalized(o.all)).toEqual(
      normalized(
        ["removable_features.rs", "BunRemovableFeatures.h", "removable-features.json"].map(name =>
          resolve(cfg.codegenDir, name),
        ),
      ),
    );
  });

  test("with an engine the removable features come first, and no file is declared twice", () => {
    using dir = tempDir("build-aot-codegen", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));

    emitAotCodegen({ n, cfg, sources: noSources(), o, dirStamp, engine: checkout });

    const steps = readManifest(n.toString()).edges.filter(edge => /^(codegen_bun|aot_check)$/.test(edge.rule));
    expect(steps[0].outputs).toContain(n.rel(removableFeaturesJson(cfg)));
    expect(o.all.filter((path, index) => o.all.indexOf(path) !== index)).toEqual([]);
    for (const path of [
      builtinTableRust(cfg),
      resolve(cfg.codegenDir, "builtin_sources.bin"),
      ...checkout.schemaOutputs,
    ])
      expect(o.all).toContain(path);
  });

  test.each([
    ["emitAotSchema", emitAotSchema],
    ["emitAotSchemaUseCheck", emitAotSchemaUseCheck],
    ["emitBuiltinsTable", emitBuiltinsTable],
    ["emitBuiltinSources", emitBuiltinSources],
  ] as const)("%s throws without an engine", (name, emit) => {
    using dir = tempDir("build-aot-codegen-needs-an-engine", {});
    const { cfg, n, o, dirStamp } = configure(String(dir));

    expect(() => emit({ n, cfg, sources: noSources(), o, dirStamp })).toThrow(`${name} needs an engine`);
    expect(o.all).toEqual([]);
  });
});
