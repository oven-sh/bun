/**
 * Two codegen steps in scripts/build/codegen.ts run a bundler, so what they
 * read is decided by imports rather than by their source globs, and neither
 * writes a depfile. Every file a bundle pulls in therefore has to be listed on
 * the step's ninja edge by hand (the lists in scripts/glob-sources.ts), or an
 * edit to it leaves the output stale until some listed file happens to change:
 *
 *   runtime.out.js (esbuild on src/runtime.bun.js)
 *     src/runtime.js                     re-exported by runtime.bun.js; most of the helpers live here
 *   bake.{client,server,error}.js (bake-codegen.ts on src/runtime/bake)
 *     src/runtime.bun.js, src/runtime.js imported by hmr-module.ts
 *     src/runtime/bake/package.json      the `#stack-trace` imports map and `sideEffects`
 *     src/runtime/bake/tsconfig.json     class field / decorator / jsx lowering of the modules,
 *     tsconfig.base.json                 which it extends
 *     src/runtime/bake/client/icons/*    inlined as data: URLs when overlay.css is bundled
 *     src/runtime/bake/dev_server/mod.rs the enums the script converts into generated.ts
 *
 * The two steps are emitted with the real source lists for a scratch build
 * dir, and the edges are captured as the emitters hand them to the Ninja
 * writer; nothing is run or written.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  emitBakeCodegen,
  emitRuntimeJs,
  registerCodegenRules,
  type CodegenOutputs,
} from "../../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../../scripts/build/config.ts";
import { Ninja, type BuildNode } from "../../../scripts/build/ninja.ts";
import { quote } from "../../../scripts/build/shell.ts";
import { globSourceList, type Sources } from "../../../scripts/glob-sources.ts";

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

interface Emitted {
  cfg: Config;
  /** Every edge the step emitted, with the absolute paths the emitter passed in. */
  edges: BuildNode[];
}

/**
 * Emits `step` for a linux-x64 debug target in `buildDir` (resolves on every
 * host once told where its sysroot is; the path is only recorded), fed the
 * two source lists these steps read, expanded from the repo as configure
 * would. Nothing is written to `buildDir`.
 */
function emit(buildDir: string, step: typeof emitBakeCodegen): Emitted {
  const cfg = resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir },
    mockToolchain(),
  );
  const n = new Ninja({ buildDir });
  registerDirStamps(n, cfg);
  registerCodegenRules(n, cfg);
  const sources = {
    bakeRuntime: globSourceList("bakeRuntime"),
    bundlerRuntime: globSourceList("bundlerRuntime"),
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

  const build = spyOn(n, "build");
  step({ n, cfg, sources, o, dirStamp: resolve(cfg.codegenDir, ".dir") });
  return { cfg, edges: build.mock.calls.map(([node]) => node) };
}

/** The edge that produces `<codegen dir>/${output}`. */
function edgeProducing({ cfg, edges }: Emitted, output: string): BuildNode {
  const abs = resolve(cfg.codegenDir, output);
  const edge = edges.find(e => e.outputs.includes(abs));
  if (edge === undefined) throw new Error(`no build edge produces ${output}`);
  return edge;
}

/**
 * The files whose mtime re-runs `edge` (explicit and implicit inputs alike),
 * repo-relative with forward slashes.
 */
function dependencies(cfg: Config, edge: BuildNode): string[] {
  return [...edge.inputs, ...(edge.implicitInputs ?? [])].map(p => relative(cfg.cwd, p).replaceAll("\\", "/"));
}

interface Tracked {
  /** The file is where the edge is expected to point (a move has to update the list too). */
  exists: boolean;
  /** The edge lists it. */
  listed: boolean;
}

/** One entry per repo-relative path in `files`, as the edge sees them. */
function tracking(cfg: Config, edge: BuildNode, files: string[]): Record<string, Tracked> {
  const deps = dependencies(cfg, edge);
  return Object.fromEntries(
    files.map(file => [file, { exists: existsSync(resolve(cfg.cwd, file)), listed: deps.includes(file) }]),
  );
}

function tracked(files: string[]): Record<string, Tracked> {
  return Object.fromEntries(files.map(file => [file, { exists: true, listed: true }]));
}

describe("bundling codegen steps list everything their bundles read", () => {
  test("bake.{client,server,error}.js: the bundler runtime, package.json, the tsconfigs, the icons", () => {
    using dir = tempDir("build-codegen-bundle-inputs", {});
    const emitted = emit(String(dir), emitBakeCodegen);
    const { cfg } = emitted;
    const edge = edgeProducing(emitted, "bake.client.js");

    const reads = [
      "src/codegen/bake-codegen.ts",
      "src/runtime.bun.js",
      "src/runtime.js",
      "src/runtime/bake/package.json",
      "src/runtime/bake/tsconfig.json",
      "tsconfig.base.json",
      "src/runtime/bake/client/icons/dismiss.svg",
      "src/runtime/bake/client/icons/next.svg",
      "src/runtime/bake/client/icons/prev.svg",
      "src/runtime/bake/dev_server/mod.rs",
      // The globbed modules themselves: one per pattern.
      "src/runtime/bake/hmr-module.ts",
      "src/runtime/bake/client/overlay.css",
      "src/runtime/bake/server/stack-trace-stub.ts",
    ];
    expect(tracking(cfg, edge, reads)).toEqual(tracked(reads));
    // One edge writes all three bundles, so the inputs above cover each of them.
    expect(edge.outputs.map(p => relative(cfg.codegenDir, p))).toEqual([
      "bake.client.js",
      "bake.server.js",
      "bake.error.js",
    ]);
    // Written by the step itself (from dev_server/mod.rs above), so it must
    // not be an input of it.
    expect(dependencies(cfg, edge)).not.toContain("src/runtime/bake/generated.ts");
  });

  test("runtime.out.js: runtime.js next to the runtime.bun.js entry", () => {
    using dir = tempDir("build-codegen-bundle-inputs", {});
    const emitted = emit(String(dir), emitRuntimeJs);
    const { cfg } = emitted;
    const edge = edgeProducing(emitted, "runtime.out.js");

    const reads = ["src/runtime.bun.js", "src/runtime.js"];
    expect(tracking(cfg, edge, reads)).toEqual(tracked(reads));
    // The esbuild rule takes its entry point from $args, not $in: listing
    // runtime.js only tracks it, runtime.bun.js stays the one entry.
    const entry = quote(resolve(cfg.cwd, "src", "runtime.bun.js"), cfg.host.os === "windows");
    expect(edge.vars?.args).toStartWith(`${entry} `);
  });
});
