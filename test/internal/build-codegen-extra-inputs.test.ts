/**
 * A codegen edge in scripts/build/codegen.ts has to list every file its script
 * bakes into the outputs: ninja re-runs the step only when an input listed on
 * the edge is newer than the outputs, and the codegen scripts emit no depfiles,
 * so the input list is all ninja knows. The globbed source lists cover most of
 * it; whatever a script imports or opens from elsewhere has to be listed by
 * hand, and that is where the gaps were:
 *
 *   bundle-modules (source lists: src/js, src/codegen) also uses
 *     src/jsc/modules/NativeModuleList.h   opened by internal-module-registry-scanner.ts; numbers the
 *                                          native modules (InternalModuleRegistry+*.h, SyntheticModuleType.h,
 *                                          the require() rewrites in every bundled module, ...)
 *     src/js/builtins/BunBuiltinNames.h    opened by bundle-functions.ts; decides what BunBuiltinNames+extras.h adds
 *     src/jsc/bindings/js_classes.ts       imported by replacements.ts; $inherits(<index>, ...) in every module
 *     src/jsc/bindings/ErrorCode.ts        imported by replacements.ts; $makeErrorWithCode(<index>, ...) likewise
 *   generate-classes (source lists: the .classes.ts files, src/codegen) also uses
 *     src/jsc/bindings/js_classes.ts       the switch over those same indices in ZigGeneratedClasses.cpp
 *
 * Until the edges listed them, editing one of these files alone (adding a
 * native module, say) left the generated ids stale until some globbed file
 * happened to be touched. js_classes.ts is on both edges because its indices
 * have to change on the JS side and the C++ side in the same build.
 *
 * Rather than pin those file names, each step below is checked against what
 * its script actually imports: the edge has to carry the script's static
 * import closure plus the files it opens at run time (`reads`, which imports
 * cannot reveal), and every hand-listed input has to be one of those two, so a
 * dead input shows up as well. The steps are emitted into a scratch build dir;
 * only the src/codegen list is the real one (the closures live there), the
 * other lists are made up and never opened. No ninja or subprocess involved.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

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
import { globSourceList, type Sources } from "../../scripts/glob-sources.ts";

/** A fully-populated fake toolchain; emitting these steps runs none of it. */
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

type Ctx = Parameters<typeof emitJsModules>[0];

/**
 * A linux-x64 debug target in `buildDir` (it resolves on every host once told
 * where its sysroot is; the path is only recorded), with the rules the
 * emitters reference registered and the empty output groups emitCodegen()
 * hands them. Only the source lists the steps under test read are filled in.
 */
function configure(buildDir: string): Ctx {
  const cfg = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const n = new Ninja({ buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
  const src = (p: string) => resolve(cfg.cwd, "src", p);
  const sources = {
    jsCodegen: globSourceList("jsCodegen"),
    js: [src("js/internal/a.ts"), src("js/node/fs.ts")],
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

/**
 * Every file under src/ that `script` reaches through import, require() and
 * re-export specifiers, not counting the script itself. Builtins resolve to
 * `node:`/`bun:` names and packages into node_modules, so the src/ filter drops
 * both; a specifier that does not resolve throws, as loading the script would.
 * Files the scripts load by path at run time (.classes.ts and such) are the
 * globbed inputs, not imports, and do not show up here.
 */
function importClosure(cfg: Config, script: string): string[] {
  const srcDir = resolve(cfg.cwd, "src") + sep;
  const seen = new Set<string>();
  const pending = [script];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const loader = extname(file).slice(1) as "ts" | "tsx" | "js" | "jsx";
    for (const { path: specifier } of new Bun.Transpiler({ loader }).scanImports(readFileSync(file, "utf8"))) {
      const resolved = Bun.resolveSync(specifier, dirname(file));
      if (resolved.startsWith(srcDir) && !resolved.includes(`${sep}node_modules${sep}`)) pending.push(resolved);
    }
  }
  seen.delete(script);
  return [...seen].sort();
}

interface Step {
  name: string;
  emit: (ctx: Ctx) => void;
  /** The script the edge runs, repo-relative. */
  script: string;
  /** One of the edge's outputs, relative to the codegen dir; identifies the edge. */
  output: string;
  /** Files the script (or a module it imports) opens at run time from outside the source lists, repo-relative. */
  reads: string[];
  /** A few of the script's imports, repo-relative: pins that the closure walk sees them at all. */
  importsInclude: string[];
}

const steps: Step[] = [
  {
    name: "bundle-modules",
    emit: emitJsModules,
    script: "src/codegen/bundle-modules.ts",
    output: "InternalModuleRegistry+enum.h",
    reads: [
      // internal-module-registry-scanner.ts, createInternalModuleRegistry()
      "src/jsc/modules/NativeModuleList.h",
      // bundle-functions.ts, the BunBuiltinNames+extras.h block
      "src/js/builtins/BunBuiltinNames.h",
    ],
    importsInclude: [
      "src/jsc/bindings/js_classes.ts",
      "src/jsc/bindings/ErrorCode.ts",
      // Loaded with require(), not import.
      "src/codegen/bundle-functions.ts",
      "src/codegen/internal-module-registry-scanner.ts",
    ],
  },
  {
    name: "generate-classes",
    emit: emitGeneratedClasses,
    script: "src/codegen/generate-classes.ts",
    output: "ZigGeneratedClasses.cpp",
    reads: [],
    importsInclude: ["src/jsc/bindings/js_classes.ts", "src/codegen/class-definitions.ts"],
  },
];

describe("codegen edges carry what their scripts import or open, and nothing else by hand", () => {
  test.each(steps)("$name", ({ emit, script, output, reads, importsInclude }) => {
    using dir = tempDir("build-codegen-extra-inputs", {});
    const ctx = configure(String(dir));
    const { cfg, n, sources } = ctx;
    const repoRelative = (file: string) => relative(cfg.cwd, file).replaceAll(sep, "/");
    const scriptPath = resolve(cfg.cwd, script);
    const readPaths = reads.map(file => resolve(cfg.cwd, file));

    emit(ctx);

    const imports = importClosure(cfg, scriptPath);
    expect(imports.map(repoRelative)).toEqual(expect.arrayContaining(importsInclude));

    const edge = edgeProducing(n, resolve(cfg.codegenDir, output));
    const inputs = new Set(edge.inputs);
    const fromSourceLists = new Set(Object.values(sources).flat());
    const used = new Set([...imports, ...readPaths]);
    expect({
      script: inputs.has(scriptPath),
      // Imported or opened by the script, but editing it would not re-run the step.
      untracked: [...used].filter(file => !inputs.has(file)).map(repoRelative),
      // Listed by hand, but the script neither imports nor opens it: a stale
      // entry whose edits re-run the step for nothing.
      unexplained: edge.inputs
        .filter(file => file !== scriptPath && !fromSourceLists.has(file) && !used.has(file))
        .map(repoRelative),
      // A `reads` entry that was moved has to be updated in codegen.ts as well.
      readsMissingOnDisk: readPaths.filter(file => !existsSync(file)).map(repoRelative),
    }).toEqual({ script: true, untracked: [], unexplained: [], readsMissingOnDisk: [] });
  });

  test("generate-classes passes only the .classes.ts files on the command line", () => {
    using dir = tempDir("build-codegen-extra-inputs", {});
    const ctx = configure(String(dir));
    const { cfg, n, sources } = ctx;

    emitGeneratedClasses(ctx);

    // generate-classes.ts loads every path on its command line as a list of
    // class definitions, so the dependency-only inputs must not be passed there.
    const script = resolve(cfg.cwd, "src", "codegen", "generate-classes.ts");
    const edge = edgeProducing(n, resolve(cfg.codegenDir, "ZigGeneratedClasses.cpp"));
    expect(edge.vars.args).toBe(
      quoteArgs(["run", script, ...sources.zigGeneratedClasses, cfg.codegenDir], cfg.host.os === "windows"),
    );
  });
});
