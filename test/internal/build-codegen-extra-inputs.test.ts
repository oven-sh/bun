/**
 * Two codegen steps in scripts/build/codegen.ts read files their source lists
 * do not cover and bake them into their outputs:
 *
 *   bundle-modules (sources: src/js, src/codegen) also reads
 *     src/jsc/modules/NativeModuleList.h   native module ids: InternalModuleRegistry+*.h,
 *                                          SyntheticModuleType.h, the require() rewrites, ...
 *     src/js/builtins/BunBuiltinNames.h    what BunBuiltinNames+extras.h has to add
 *     src/jsc/bindings/js_classes.ts       $inherits(<index>, ...) in every bundled module
 *     src/jsc/bindings/ErrorCode.ts        $makeErrorWithCode(<index>, ...) likewise
 *   generate-classes (sources: the .classes.ts files) also reads
 *     src/jsc/bindings/js_classes.ts       the switch over those same indices in ZigGeneratedClasses.cpp
 *
 * Ninja re-runs a step only when an input listed on its edge is newer than the
 * outputs, so each of these files has to be on the edge. Before they were,
 * editing one of them alone (adding a native module, say) left the generated
 * ids stale until some globbed file happened to be touched. js_classes.ts is
 * on both edges because its indices have to change on the JS side and the C++
 * side in the same build.
 *
 * Emits the two steps into a scratch build dir with made-up source lists and
 * reads the edges back out of the ninja text. No ninja, compiler or subprocess
 * is involved, so this runs on every host.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  emitGeneratedClasses,
  emitJsModules,
  registerCodegenRules,
  type CodegenOutputs,
} from "../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { quoteArgs } from "../../scripts/build/shell.ts";
import type { Sources } from "../../scripts/glob-sources.ts";

/** A fully-populated fake toolchain; emitting these two steps runs none of it. */
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

interface Configured {
  cfg: Config;
  n: Ninja;
  sources: Sources;
  o: CodegenOutputs;
  dirStamp: string;
}

/**
 * A linux-x64 debug target in `buildDir` (resolves on every host once told
 * where its sysroot is; the path is only recorded), with the rules the two
 * emitters reference registered and the empty output groups emitCodegen()
 * hands them. The source lists hold only what these two emitters read, and
 * the files in them are never opened: the emitters just put the paths on
 * the edges.
 */
function configure(buildDir: string): Configured {
  const cfg = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const n = new Ninja({ buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
  const src = (p: string) => resolve(cfg.cwd, "src", p);
  const sources = {
    js: [src("js/internal/a.ts"), src("js/node/fs.ts")],
    jsCodegen: [src("codegen/bundle-modules.ts"), src("codegen/replacements.ts")],
    zigGeneratedClasses: [src("jsc/resolve_message.classes.ts"), src("runtime/api/bun/subprocess.classes.ts")],
  } as Sources;
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
  return { cfg, n, sources, o, dirStamp: resolve(cfg.codegenDir, ".dir") };
}

interface Edge {
  /** Explicit and implicit inputs (either re-runs the edge when newer than the outputs), absolute. */
  inputs: string[];
  /** The edge's variable bindings (`args`, `desc`, ...). */
  vars: Record<string, string>;
}

/** Undo ninja.ts's build-line escaping (`$ `, `$:`, `$$`). */
function unescapePath(token: string): string {
  return token.replace(/\$([ :$])/g, "$1");
}

/** The edge in `n` that produces `output` (an absolute path). */
function edgeProducing(n: Ninja, output: string): Edge {
  // ninja.ts wraps long build lines with `$` continuations; the edge's
  // `  name = value` bindings follow the build line up to a blank line.
  const lines = n
    .toString()
    .replace(/ \$\n {4}/g, " ")
    .split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("build ")) continue;
    // `build out1 out2: rule in1 in2 | implicit1 || orderonly1`; the first
    // unescaped `: ` ends the outputs.
    const ruleAt = line.search(/(?<!\$): /);
    const outputs = line
      .slice("build ".length, ruleAt)
      .split(/(?<=[^$]) /)
      .filter(token => token !== "|")
      .map(unescapePath);
    if (!outputs.includes(n.rel(output))) continue;

    const [, ...dependencies] = line
      .slice(ruleAt + 2)
      .split(/(?<=[^$]) /)
      .filter(token => token !== "|");
    const orderOnlyAt = dependencies.indexOf("||");
    const inputs = (orderOnlyAt === -1 ? dependencies : dependencies.slice(0, orderOnlyAt)).map(token =>
      resolve(n.buildDir, unescapePath(token)),
    );

    const vars: Record<string, string> = {};
    for (let j = i + 1; j < lines.length && lines[j] !== ""; j++) {
      const binding = lines[j]!.match(/^ {2}(\w+) = (.*)$/);
      if (binding) vars[binding[1]!] = binding[2]!.replace(/\$\$/g, "$");
    }
    return { inputs, vars };
  }
  throw new Error(`no build edge produces ${output}`);
}

interface Tracked {
  /** The file is where the edge points (a rename has to update codegen.ts too). */
  exists: boolean;
  /** The edge lists it. */
  listed: boolean;
}

/** One entry per repo-relative path in `files`. */
function tracking(cfg: Config, edge: Edge, files: string[]): Record<string, Tracked> {
  return Object.fromEntries(
    files.map(file => {
      const abs = resolve(cfg.cwd, file);
      return [file, { exists: existsSync(abs), listed: edge.inputs.includes(abs) }];
    }),
  );
}

function tracked(files: string[]): Record<string, Tracked> {
  return Object.fromEntries(files.map(file => [file, { exists: true, listed: true }]));
}

describe("codegen edges list the files their scripts read from outside the source lists", () => {
  test("bundle-modules: NativeModuleList.h, BunBuiltinNames.h, js_classes.ts, ErrorCode.ts", () => {
    using dir = tempDir("build-codegen-extra-inputs", {});
    const { cfg, n, sources, o, dirStamp } = configure(String(dir));

    emitJsModules({ n, cfg, sources, o, dirStamp });

    const edge = edgeProducing(n, resolve(cfg.codegenDir, "InternalModuleRegistry+enum.h"));
    const reads = [
      "src/jsc/modules/NativeModuleList.h",
      "src/js/builtins/BunBuiltinNames.h",
      "src/jsc/bindings/js_classes.ts",
      "src/jsc/bindings/ErrorCode.ts",
    ];
    expect(tracking(cfg, edge, reads)).toEqual(tracked(reads));
    // Listed in addition to the source lists, not instead of them.
    expect(edge.inputs).toEqual(
      expect.arrayContaining([
        resolve(cfg.cwd, "src", "codegen", "bundle-modules.ts"),
        ...sources.js,
        ...sources.jsCodegen,
      ]),
    );
  });

  test("generate-classes: js_classes.ts, as a dependency rather than a command-line argument", () => {
    using dir = tempDir("build-codegen-extra-inputs", {});
    const { cfg, n, sources, o, dirStamp } = configure(String(dir));

    emitGeneratedClasses({ n, cfg, sources, o, dirStamp });

    const script = resolve(cfg.cwd, "src", "codegen", "generate-classes.ts");
    const edge = edgeProducing(n, resolve(cfg.codegenDir, "ZigGeneratedClasses.cpp"));
    const reads = ["src/jsc/bindings/js_classes.ts"];
    expect(tracking(cfg, edge, reads)).toEqual(tracked(reads));
    expect(edge.inputs).toEqual(expect.arrayContaining([script, ...sources.zigGeneratedClasses]));
    // generate-classes.ts loads every path on its command line as a list of
    // class definitions, so the command line has to stay the .classes.ts files.
    expect(edge.vars.args).toBe(
      quoteArgs(["run", script, ...sources.zigGeneratedClasses, cfg.codegenDir], cfg.host.os === "windows"),
    );
  });
});
