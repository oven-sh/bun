/**
 * Codegen steps in scripts/build/codegen.ts have to declare every file their
 * script writes that something downstream consumes, not only the file the step
 * is named after.
 *
 * Compiles only order-depend on codegen; the compiler's depfile is what rebuilds
 * a TU when a generated header changes, and within one build ninja re-checks a
 * depfile entry after the step that writes it only if the entry is a declared
 * output of that step. A header no edge declares is stat'd once at startup, so
 * a TU including one (BunObject.cpp includes GeneratedBunObject.h; the generated
 * GeneratedSSLConfig.cpp includes the header-only union types next to it) was
 * recompiled by the build AFTER the one that regenerated the header, and the
 * first build linked the stale object against the fresh generated code. The
 * cargo edge has it stricter still: it is re-invoked only for the files listed
 * as its inputs, so a generated file that release builds embed (the eval/
 * bundles of bundle-modules.ts) has to be declared and routed into rustInputs,
 * or an edit to it never reaches libbun_rust.a.
 *
 * The bindgen steps are checked twice: what the emitter declares, and what the
 * script writes when run for real into a scratch dir. The bindgenv2 case uses a
 * probe .bindv2.ts with one header-only type (a union) and one type with a
 * header and a .cpp (an enumeration); bindgen.ts finds the repo's .bind.ts files
 * on its own, so its step is checked against those. bundle-modules.ts bundles
 * the whole of src/js, so only its emitter is checked.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, tempDir, type BunRunResult } from "harness";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  emitBindgen,
  emitBindgenV2,
  emitJsModules,
  registerCodegenRules,
  type CodegenOutputs,
} from "../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import type { Sources } from "../../scripts/glob-sources.ts";

/**
 * The bun the generator scripts run under. The build runs them under the host
 * bun (findBun() in tools.ts), never under the binary it is building, and a
 * release bun loads them in a fraction of the time a debug build takes; CI
 * keeps the binary under test, the one bun it is sure to have (same choice as
 * VerdaccioRegistry in harness.ts).
 */
const codegenBun = isCI ? bunExe() : Bun.which("bun") || bunExe();

async function runGenerator(script: string, args: string[]): Promise<BunRunResult> {
  await using proc = Bun.spawn({
    cmd: [codegenBun, "run", script, ...args],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode, signalCode: proc.signalCode };
}

/** A fully-populated fake toolchain; `bun` is the one entry that gets spawned (bindgenv2 list-outputs). */
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
    strip: "/fake/bin/strip",
    llvmStrip: "/fake/llvm/bin/llvm-strip",
    nm: "/fake/llvm/bin/llvm-nm",
    dsymutil: "/fake/llvm/bin/dsymutil",
    bun: codegenBun,
    jsRuntime: codegenBun,
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
  o: CodegenOutputs;
  dirStamp: string;
}

/**
 * A linux-x64 target in `buildDir` (resolves on every host once told where its
 * sysroot is; the path is only recorded), with the rules the codegen emitters
 * reference registered and the empty output groups emitCodegen hands them.
 * Nothing is written to `buildDir`.
 */
function configure(buildDir: string, buildType: "Debug" | "Release" = "Debug"): Configured {
  const cfg = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType, buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const n = new Ninja({ buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
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
  return { cfg, n, o, dirStamp: resolve(cfg.codegenDir, ".dir") };
}

/** Just the lists the emitter under test reads; it never looks at the rest of `Sources`. */
function sourceLists(lists: Partial<Sources>): Sources {
  return lists as Sources;
}

/** The outputs of the `build` line in `n` that produces `output`, spelled as in build.ninja, sorted. */
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
    if (outputs.includes(n.rel(output))) return outputs.sort();
  }
  throw new Error(`no build edge produces ${output}`);
}

/** `names` in the codegen dir, spelled as in build.ninja, sorted. */
function inCodegenDir({ cfg, n }: Configured, names: string[]): string[] {
  return names.map(name => n.rel(resolve(cfg.codegenDir, name))).sort();
}

/** `paths` normalized (bindgenv2 reports its outputs as `<codegen dir>/<name>`), sorted. */
function normalized(paths: string[]): string[] {
  return paths.map(p => resolve(p)).sort();
}

/**
 * Every .bind.ts under src/: the pattern glob-sources.ts expands for
 * emitBindgen (through node:fs globSync, which is too slow under a debug
 * build to run its whole pattern set here).
 */
function repoBindFiles(cfg: Config): string[] {
  return Array.from(new Bun.Glob("src/**/*.bind.ts").scanSync({ cwd: cfg.cwd }), p => resolve(cfg.cwd, p)).sort();
}

/** Writes the probe .bindv2.ts into `dir` and returns its path. */
function writeProbe(dir: string, cfg: Config): string {
  // The "bindgenv2" specifier the real files import is a path mapping in
  // src/tsconfig.json, which a file outside src/ does not get.
  const lib = resolve(cfg.cwd, "src", "codegen", "bindgenv2", "lib.ts");
  const probe = resolve(dir, "probe.bindv2.ts");
  writeFileSync(
    probe,
    `import * as b from ${JSON.stringify(lib)};\n` +
      `export const ProbeUnion = b.union("ProbeUnion", { string: b.String, buffer: b.ArrayBuffer });\n` +
      `export const ProbeEnum = b.enumeration("ProbeEnum", ["one", "two"]);\n`,
  );
  return probe;
}

describe("emitBindgenV2", () => {
  test.concurrent(
    "declares, on one edge, the header of every type and the .cpp of the types that have one: what generate writes",
    async () => {
      using dir = tempDir("build-codegen-bindgenv2", {});
      const c = configure(String(dir));
      const { cfg, n, o, dirStamp } = c;
      const probe = writeProbe(String(dir), cfg);

      emitBindgenV2({ n, cfg, sources: sourceLists({ bindgenV2: [probe], bindgenV2Internal: [] }), o, dirStamp });

      const cpp = resolve(cfg.codegenDir, "GeneratedProbeEnum.cpp");
      const headers = [
        resolve(cfg.codegenDir, "GeneratedProbeEnum.h"),
        resolve(cfg.codegenDir, "GeneratedProbeUnion.h"),
      ];
      const declared = edgeOutputs(n, cpp);
      expect(declared).toEqual(
        inCodegenDir(c, ["GeneratedProbeEnum.cpp", "GeneratedProbeEnum.h", "GeneratedProbeUnion.h"]),
      );
      // Headers go in the group the PCH and every cxx edge order-depend on; the
      // .cpp is compiled like the other bindgenv2 sources.
      expect(normalized(o.cppHeaders)).toEqual(headers);
      expect(normalized(o.bindgenV2Cpp)).toEqual([cpp]);
      expect(normalized(o.all)).toEqual([cpp, ...headers]);

      const script = resolve(cfg.cwd, "src", "codegen", "bindgenv2", "script.ts");
      const args = ["--command=generate", `--sources=${probe}`, `--codegen-path=${cfg.codegenDir}`];
      expect(await runGenerator(script, args)).toSpawn("");
      expect(inCodegenDir(c, readdirSync(cfg.codegenDir))).toEqual(declared);
    },
  );
});

describe("emitBindgen", () => {
  test("declares Generated<Stem>.h for every .bind.ts on the GeneratedBindings.cpp edge", () => {
    using dir = tempDir("build-codegen-bindgen", {});
    const c = configure(String(dir));
    const { cfg, n, o, dirStamp } = c;
    const bindgen = [
      resolve(cfg.cwd, "src", "runtime", "node", "node_os.bind.ts"),
      resolve(cfg.cwd, "src", "runtime", "api", "BunObject.bind.ts"),
    ];

    emitBindgen({ n, cfg, sources: sourceLists({ bindgen }), o, dirStamp });

    const cpp = resolve(cfg.codegenDir, "GeneratedBindings.cpp");
    const headers = [resolve(cfg.codegenDir, "GeneratedBunObject.h"), resolve(cfg.codegenDir, "GeneratedNodeOs.h")];
    expect(edgeOutputs(n, cpp)).toEqual(
      inCodegenDir(c, ["GeneratedBindings.cpp", "GeneratedBunObject.h", "GeneratedNodeOs.h"]),
    );
    expect(normalized(o.cppHeaders)).toEqual(headers);
    expect(o.cppSources).toEqual([cpp]);
    expect(normalized(o.all)).toEqual([cpp, ...headers]);
  });

  test.concurrent("declares exactly the files bindgen.ts writes for the repo's .bind.ts files", async () => {
    using dir = tempDir("build-codegen-bindgen-generate", {});
    const c = configure(String(dir));
    const { cfg, n, o, dirStamp } = c;
    const bindgen = repoBindFiles(cfg);
    expect(bindgen).not.toBeEmpty();

    emitBindgen({ n, cfg, sources: sourceLists({ bindgen }), o, dirStamp });

    const script = resolve(cfg.cwd, "src", "codegen", "bindgen.ts");
    expect(await runGenerator(script, ["--debug=ON", `--codegen-root=${cfg.codegenDir}`])).toSpawn("");

    // GeneratedBindings.cpp plus one header per .bind.ts, and nothing else.
    const written = readdirSync(cfg.codegenDir).sort();
    expect(written).toHaveLength(bindgen.length + 1);
    expect(edgeOutputs(n, resolve(cfg.codegenDir, "GeneratedBindings.cpp"))).toEqual(inCodegenDir(c, written));
  });
});

describe("emitJsModules", () => {
  /**
   * bundle-modules.ts writes eval/<name> for src/js/eval/*.ts (that directory
   * only, .ts only); every other file in sources.js ends up inside the outputs
   * the step already declares.
   */
  function jsSources(cfg: Config): string[] {
    const js = (...parts: string[]) => resolve(cfg.cwd, "src", "js", ...parts);
    return [
      js("eval", "node-repl.ts"),
      js("eval", "feedback.ts"),
      js("eval", "notes.js"),
      js("eval", "nested", "helper.ts"),
      js("node", "fs.ts"),
      js("internal", "eval", "helper.ts"),
    ];
  }

  /** The entries of `paths` (absolute) that are directly inside the codegen eval/ dir, normalized and sorted. */
  function evalEntries({ cfg }: Configured, paths: string[]): string[] {
    const evalDir = resolve(cfg.codegenDir, "eval");
    return normalized(paths.filter(p => resolve(p, "..") === evalDir));
  }

  /** What the bundle-modules edge declares under eval/. */
  function declaredEval(c: Configured): string[] {
    const edge = edgeOutputs(c.n, resolve(c.cfg.codegenDir, "WebCoreJSBuiltins.cpp"));
    return evalEntries(
      c,
      edge.map(rel => resolve(c.cfg.buildDir, rel)),
    );
  }

  function expectedEval({ cfg }: Configured): string[] {
    return [resolve(cfg.codegenDir, "eval", "feedback.ts"), resolve(cfg.codegenDir, "eval", "node-repl.ts")];
  }

  test("declares eval/<name> for each src/js/eval/*.ts; release builds embed them, so they are cargo inputs", () => {
    using dir = tempDir("build-codegen-js-modules-release", {});
    const c = configure(String(dir), "Release");
    const { cfg, n, o, dirStamp } = c;

    emitJsModules({ n, cfg, sources: sourceLists({ js: jsSources(cfg), jsCodegen: [] }), o, dirStamp });

    expect(declaredEval(c)).toEqual(expectedEval(c));
    expect(evalEntries(c, o.all)).toEqual(expectedEval(c));
    expect(evalEntries(c, o.rustInputs)).toEqual(expectedEval(c));
    expect(o.rustOrderOnly).toEqual([]);
  });

  test("debug builds load the eval bundles at runtime: generated, but not cargo inputs", () => {
    using dir = tempDir("build-codegen-js-modules-debug", {});
    const c = configure(String(dir), "Debug");
    const { cfg, n, o, dirStamp } = c;

    emitJsModules({ n, cfg, sources: sourceLists({ js: jsSources(cfg), jsCodegen: [] }), o, dirStamp });

    expect(declaredEval(c)).toEqual(expectedEval(c));
    expect(evalEntries(c, o.all)).toEqual(expectedEval(c));
    expect(normalized(o.rustOrderOnly)).toEqual(expectedEval(c));
    expect(evalEntries(c, o.rustInputs)).toEqual([]);
  });
});
