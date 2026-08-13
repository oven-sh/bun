/**
 * Pins that the codegen steps which discover or bundle their globbed inputs
 * also track the SET of those inputs (`sourceListFile` in
 * scripts/build/codegen.ts).
 *
 * Ninja re-runs an edge when an input is newer than its outputs or when the
 * command line changed. Deleting a file the step had globbed is neither: the
 * reconfigured edge merely has a shorter input list and counts as up to date.
 * So after `rm src/js/internal/foo.ts`, bundle-modules did not re-run and the
 * module stayed in the binary until some surviving input was edited; the same
 * held for bindgen, generate-host-exports, bake and bun-error. Each of those
 * edges now has an implicit input `codegen/<name>-sources.txt`, written at
 * configure time with writeIfChanged: its mtime moves exactly when the list
 * changes, so a deletion re-runs the step and an unchanged list stays a no-op.
 * (cppbind has worked this way all along; it is the pattern being generalized.)
 *
 * Emits the six steps into a temporary build dir and reads back the ninja text
 * and the manifests. The source lists are made up: nothing reads the files at
 * configure time. No ninja, compiler or subprocess; runs on every host.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  emitBakeCodegen,
  emitBindgen,
  emitBunError,
  emitCppBind,
  emitHostExports,
  emitJsModules,
  registerCodegenRules,
  type CodegenOutputs,
  type Ctx,
} from "../../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../../scripts/build/config.ts";
import { Ninja } from "../../../scripts/build/ninja.ts";
import type { Sources } from "../../../scripts/glob-sources.ts";

/** A fully-populated fake toolchain; configure-time emission never runs any of it. */
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

/**
 * Source lists shaped like globAllSources() output (absolute paths under the
 * repo root), plus the subset of `rust` that generate-host-exports scrapes.
 */
function fixture(cfg: Config): { sources: Sources; hostExportsScrape: string[] } {
  const src = (p: string) => resolve(cfg.cwd, "src", p);
  const hostExportsScrape = [src("jsc/lib.rs"), src("runtime/api/BunObject.rs")];
  const sources: Sources = {
    bunError: [resolve(cfg.cwd, "packages/bun-error/bun-error.css"), resolve(cfg.cwd, "packages/bun-error/index.tsx")],
    js: [src("js/internal/a.ts"), src("js/internal/b.ts"), src("js/node/fs.ts")],
    jsCodegen: [src("codegen/bundle-modules.ts"), src("codegen/replacements.ts")],
    bakeRuntime: [src("runtime/bake/dev_server/mod.rs"), src("runtime/bake/hmr-runtime-client.ts")],
    bindgen: [src("jsc/fmt_jsc.bind.ts"), src("runtime/node/node_os.bind.ts")],
    cxx: [src("jsc/bindings/BunObject.cpp"), src("jsc/bindings/ZigGlobalObject.cpp")],
    // A crate outside the scrape scope and a manifest inside it are fed to
    // the cargo step but not to generate-host-exports.
    rust: [resolve(cfg.cwd, "Cargo.toml"), src("bundler/lib.rs"), ...hostExportsScrape, src("runtime/Cargo.toml")],
    // Read only by steps this test doesn't emit.
    stringMaps: [],
    nodeFallbacks: [],
    zigGeneratedClasses: [],
    bindgenV2: [],
    bindgenV2Internal: [],
    c: [],
  };
  return { sources, hostExportsScrape };
}

interface Edge {
  outputs: string[];
  inputs: string[];
  implicitInputs: string[];
}

/** Undo ninja.ts's build-line path escaping. */
function unescapePath(token: string): string {
  return token.replace(/\$([ :$])/g, "$1");
}

/**
 * Parse every `build` line of the generated ninja text into its output and
 * input sections (paths buildDir-relative, as ninja.ts writes them).
 */
function parseEdges(ninja: string): Edge[] {
  const edges: Edge[] = [];
  for (const line of ninja.replace(/ \$\n +/g, " ").split("\n")) {
    if (!line.startsWith("build ")) continue;
    const tokens = line.slice("build ".length).split(/(?<=[^$]) /);
    // `build out | implout: rule in | implin || orderonly`: the rule name
    // follows the first token ending in an unescaped colon.
    const colon = tokens.findIndex(t => t.endsWith(":") && !t.endsWith("$:"));
    if (colon === -1) throw new Error(`unparseable build line: ${line}`);
    const outputs = [...tokens.slice(0, colon), tokens[colon]!.slice(0, -1)].filter(t => t !== "|").map(unescapePath);
    const rest = tokens.slice(colon + 2);
    const implicitStart = rest.indexOf("|");
    const orderOnlyStart = rest.indexOf("||");
    const end = orderOnlyStart === -1 ? rest.length : orderOnlyStart;
    const inputs = rest.slice(0, implicitStart === -1 ? end : implicitStart).map(unescapePath);
    const implicitInputs = implicitStart === -1 ? [] : rest.slice(implicitStart + 1, end).map(unescapePath);
    edges.push({ outputs, inputs, implicitInputs });
  }
  return edges;
}

/** One configure's worth of the glob-driven steps, the way emitCodegen() drives them. */
function emit(cfg: Config, sources: Sources): Edge[] {
  const n = new Ninja({ buildDir: cfg.buildDir });
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
    rootInstall: resolve(cfg.buildDir, "stamps", "install_root.stamp"),
  };
  const ctx: Ctx = { n, cfg, sources, o, dirStamp: resolve(cfg.codegenDir, ".dir") };
  for (const step of [emitBunError, emitHostExports, emitCppBind, emitJsModules, emitBakeCodegen, emitBindgen]) {
    step(ctx);
  }
  return parseEdges(n.toString());
}

/** `path` as ninja.ts writes it into build.ninja. */
function ninjaPath(cfg: Config, path: string): string {
  return relative(cfg.buildDir, path);
}

/** The edge producing `<codegenDir>/<...output>`. */
function edgeProducing(cfg: Config, edges: Edge[], ...output: string[]): Edge {
  const rel = ninjaPath(cfg, resolve(cfg.codegenDir, ...output));
  const edge = edges.find(e => e.outputs.includes(rel));
  if (edge === undefined) throw new Error(`no edge produces ${rel}`);
  return edge;
}

/** The manifest format: repo-relative, forward slashes, one file per line. */
function manifestText(cfg: Config, files: string[]): string {
  return files.map(f => relative(cfg.cwd, f).replaceAll("\\", "/")).join("\n") + "\n";
}

function readManifest(cfg: Config, name: string): string {
  return readFileSync(resolve(cfg.codegenDir, name), "utf8");
}

/**
 * Per step: the manifest its edge has to declare, an output that identifies
 * the edge, and the files the manifest has to list.
 */
function steps(cfg: Config): { manifest: string; output: string[]; files: string[] }[] {
  const { sources, hostExportsScrape } = fixture(cfg);
  return [
    { manifest: "js-sources.txt", output: ["InternalModuleRegistry+enum.h"], files: sources.js },
    { manifest: "bindgen-sources.txt", output: ["GeneratedBindings.cpp"], files: sources.bindgen },
    { manifest: "host-exports-sources.txt", output: ["generated_host_exports.rs"], files: hostExportsScrape },
    { manifest: "bake-sources.txt", output: ["bake.client.js"], files: sources.bakeRuntime },
    { manifest: "bun-error-sources.txt", output: ["bun-error", "index.js"], files: sources.bunError },
    { manifest: "cxx-sources.txt", output: ["cpp.rs"], files: sources.cxx },
  ];
}

describe("codegen steps that glob their inputs track the set of inputs", () => {
  test("each step's edge has a manifest as an implicit input, listing the files the edge is fed", () => {
    using dir = tempDir("build-codegen-source-lists", {});
    const cfg = linuxDebugConfig(String(dir));
    const edges = emit(cfg, fixture(cfg).sources);

    const actual = steps(cfg).map(({ manifest, output }) => {
      const edge = edgeProducing(cfg, edges, ...output);
      const tracked = new Set([...edge.inputs, ...edge.implicitInputs]);
      const content = readManifest(cfg, manifest);
      return {
        manifest,
        declared: edge.implicitInputs.includes(ninjaPath(cfg, resolve(cfg.codegenDir, manifest))),
        content,
        // The manifest's files are the edge's own inputs, so edits to them
        // re-run the step as before; the manifest only adds the set itself.
        listedButUntracked: content
          .trimEnd()
          .split("\n")
          .filter(line => !tracked.has(ninjaPath(cfg, resolve(cfg.cwd, line)))),
      };
    });

    expect(actual).toEqual(
      steps(cfg).map(({ manifest, files }) => ({
        manifest,
        declared: true,
        content: manifestText(cfg, files),
        listedButUntracked: [],
      })),
    );
  });

  test("a manifest is rewritten exactly when its list changes", () => {
    using dir = tempDir("build-codegen-source-lists", {});
    const cfg = linuxDebugConfig(String(dir));
    const { sources } = fixture(cfg);
    const snapshot = () =>
      Object.fromEntries(
        steps(cfg).map(({ manifest }) => [
          manifest,
          { content: readManifest(cfg, manifest), mtimeMs: statSync(resolve(cfg.codegenDir, manifest)).mtimeMs },
        ]),
      );

    emit(cfg, sources);
    const before = snapshot();

    // Reconfigure with nothing changed: no manifest may be touched, or every
    // `bun bd` would re-run these steps.
    emit(cfg, sources);
    expect(snapshot()).toEqual(before);

    // Reconfigure after `rm src/js/internal/b.ts`: the glob no longer returns
    // it. The JS manifest is rewritten (its new mtime is what makes ninja
    // re-run bundle-modules, which drops the module); nothing else is touched.
    const remaining = sources.js.filter(f => !f.endsWith("b.ts"));
    expect(remaining).toHaveLength(sources.js.length - 1);
    emit(cfg, { ...sources, js: remaining });
    expect(snapshot()).toEqual({
      ...before,
      "js-sources.txt": { content: manifestText(cfg, remaining), mtimeMs: expect.any(Number) },
    });
    expect(before["js-sources.txt"]!.content).toBe(manifestText(cfg, sources.js));
  });
});
