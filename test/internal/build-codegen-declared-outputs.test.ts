/**
 * The two bindgen steps in scripts/build/codegen.ts have to declare every file
 * their script writes, the Generated*.h headers included, not only the .cpp
 * that gets compiled.
 *
 * Compiles only order-depend on codegen; the compiler's depfile is what rebuilds
 * a TU when a generated header changes, and within one build ninja re-checks a
 * depfile entry after the step that writes it only if the entry is a declared
 * output of that step. A header no edge declares is stat'd once at startup, so
 * a TU including one (BunObject.cpp includes GeneratedBunObject.h; the generated
 * GeneratedSSLConfig.cpp includes the header-only union types next to it) was
 * recompiled by the build AFTER the one that regenerated the header, and the
 * first build linked the stale object against the fresh generated code.
 *
 * Each step is checked twice: what its emitter declares, and what its script
 * writes when run for real into a scratch dir. The bindgenv2 cases use a probe
 * .bindv2.ts with one header-only type (a union) and one type with a header and
 * a .cpp (an enumeration); bindgen.ts finds the repo's .bind.ts files on its own,
 * so its step is checked against those.
 */
import { describe, expect, test } from "bun:test";
import { bunExe, bunRun, tempDir } from "harness";
import { readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { emitBindgen, emitBindgenV2, registerCodegenRules, type CodegenOutputs } from "../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../scripts/build/config.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { quote } from "../../scripts/build/shell.ts";
import type { Sources } from "../../scripts/glob-sources.ts";

/** A fully-populated fake toolchain; `jsRuntime` is the one entry that gets spawned (bindgenv2 list-outputs). */
function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
    hostCc: undefined,
    hostCxx: undefined,
    clangVersion: "21.1.8",
    clangResourceDir: "/fake/llvm/lib/clang/21",
    ar: "/fake/llvm/bin/llvm-ar",
    ld: "/fake/llvm/bin/ld.lld",
    ld64Lld: "/fake/llvm/bin/ld64.lld",
    rustLld: undefined,
    rustLlvmVersion: "22.1.4",
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
    jsRuntimeArgv: [bunExe()],
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
  // The probe is outside src/, so it imports lib.ts by its absolute path.
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

const probeFiles = ["GeneratedProbeEnum.cpp", "GeneratedProbeEnum.h", "GeneratedProbeUnion.h"];

// The tests below that run a generator script run it under the build being
// tested; a debug build takes a few seconds to load one, more than the 5s
// default allows for.
const generatorTimeout = 60_000;

describe("emitBindgenV2", () => {
  test(
    "declares the header of every type and the .cpp of the types that have one, on one edge",
    () => {
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
      expect(edgeOutputs(n, cpp)).toEqual(inCodegenDir(c, probeFiles));
      // Headers go in the group the PCH and every cxx edge order-depend on; the
      // .cpp is compiled like the other bindgenv2 sources.
      expect(normalized(o.cppHeaders)).toEqual(headers);
      expect(normalized(o.bindgenV2Cpp)).toEqual([cpp]);
      expect(normalized(o.all)).toEqual([cpp, ...headers]);
    },
    generatorTimeout,
  );

  test.concurrent(
    "list-outputs names exactly the files generate writes",
    async () => {
      using dir = tempDir("build-codegen-bindgenv2-generate", {});
      const { cfg } = configure(String(dir));
      const probe = writeProbe(String(dir), cfg);
      const script = resolve(cfg.cwd, "src", "codegen", "bindgenv2", "script.ts");
      const args = [`--sources=${probe}`, `--codegen-path=${cfg.codegenDir}`];

      const [listed, generated] = await Promise.all([
        bunRun(["run", script, "--command=list-outputs", ...args]),
        bunRun(["run", script, "--command=generate", ...args]),
      ]);
      expect(listed).toSpawn();
      expect(generated).toSpawn("");

      const expected = probeFiles.map(name => resolve(cfg.codegenDir, name));
      expect(normalized(listed.stdout.split(";"))).toEqual(expected);
      expect(readdirSync(cfg.codegenDir).sort()).toEqual(probeFiles);
    },
    generatorTimeout,
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

  test.concurrent(
    "declares exactly the files bindgen.ts writes for the repo's .bind.ts files",
    async () => {
      using dir = tempDir("build-codegen-bindgen-generate", {});
      const c = configure(String(dir));
      const { cfg, n, o, dirStamp } = c;
      const bindgen = repoBindFiles(cfg);
      expect(bindgen).not.toBeEmpty();

      emitBindgen({ n, cfg, sources: sourceLists({ bindgen }), o, dirStamp });

      const script = resolve(cfg.cwd, "src", "codegen", "bindgen.ts");
      expect(await bunRun(["run", script, "--debug=ON", `--codegen-root=${cfg.codegenDir}`])).toSpawn("");

      // GeneratedBindings.cpp plus one header per .bind.ts, and nothing else.
      const written = readdirSync(cfg.codegenDir).sort();
      expect(written).toHaveLength(bindgen.length + 1);
      expect(edgeOutputs(n, resolve(cfg.codegenDir, "GeneratedBindings.cpp"))).toEqual(inCodegenDir(c, written));
    },
    generatorTimeout,
  );
});
