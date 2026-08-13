/**
 * Two codegen steps in scripts/build/codegen.ts read more than the entry script
 * and the globbed sources their ninja edges used to list, so editing one of the
 * other files left the generated output stale until some listed file changed:
 *
 * - generate-classes: class-definitions.ts (imported by the script and, for
 *   define(), by every .classes.ts), and the .rs files of the bun_runtime crate,
 *   which the script walks to resolve each class to the `crate::...` path it
 *   writes into generated_classes.rs. The crate is src/runtime/ plus the files
 *   lib.rs mounts from outside that directory with `#[path]`; codegen.ts names
 *   those explicitly, so the last test checks its list against the tree.
 * - bindgen: bindgen-lib.ts and bindgen-lib-internal.ts, imported by bindgen.ts
 *   and (as "bindgen") by every .bind.ts.
 *
 * Everything here is configure-time emission into a scratch build dir; nothing
 * is run or written.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import {
  emitBindgen,
  emitGeneratedClasses,
  registerCodegenRules,
  type CodegenOutputs,
} from "../../../scripts/build/codegen.ts";
import { registerDirStamps } from "../../../scripts/build/compile.ts";
import { resolveConfig, type Config, type Toolchain } from "../../../scripts/build/config.ts";
import { Ninja } from "../../../scripts/build/ninja.ts";
import type { Sources } from "../../../scripts/glob-sources.ts";

/** A fully-populated fake toolchain; neither emitter under test runs any of it. */
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
  o: CodegenOutputs;
  dirStamp: string;
  /** Absolute path of a file in the repo. */
  src: (repoRelative: string) => string;
}

/**
 * A linux-x64 debug target in `buildDir` (resolves on every host once told
 * where its sysroot is; the path is only recorded), with the rules the emitters
 * reference registered and the empty output groups emitCodegen hands them.
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
  return { cfg, n, o, dirStamp: resolve(cfg.codegenDir, ".dir"), src: p => resolve(cfg.cwd, p) };
}

/** Just the lists the emitter under test reads; it never looks at the rest of `Sources`. */
function sourceLists(lists: Partial<Sources>): Sources {
  return lists as Sources;
}

/** Splits one side of a build line on unescaped spaces and undoes ninja's path escaping. */
function paths(n: Ninja, s: string): string[] {
  return s
    .split(/(?<!\$) /)
    .filter(token => token.length > 0)
    .map(token => resolve(n.buildDir, token.replace(/\$([ :$])/g, "$1")));
}

/**
 * The inputs ninja compares mtimes against for the `build` statement in `n`
 * that produces `output`: its explicit and `|` implicit inputs, as absolute
 * paths. `||` order-only inputs are left out; a file listed there would not
 * re-run the step when it changes.
 */
function trackedInputs(n: Ninja, output: string): string[] {
  for (const line of n
    .toString()
    .replace(/ \$\n +/g, " ")
    .split("\n")) {
    if (!line.startsWith("build ")) continue;
    const colon = line.search(/(?<!\$): /);
    const outputs = paths(n, line.slice("build ".length, colon).replace(/(?<!\$) \| /, " "));
    if (!outputs.includes(output)) continue;

    const [tracked = ""] = line.slice(colon + 2).split(/(?<!\$) \|\| /);
    const [explicit = "", implicit = ""] = tracked.split(/(?<!\$) \| /);
    // The first explicit token is the rule name.
    return [...paths(n, explicit).slice(1), ...paths(n, implicit)];
  }
  throw new Error(`no build edge produces ${output}`);
}

function inSrcRuntime(cfg: Config, file: string): boolean {
  return file.startsWith(resolve(cfg.cwd, "src", "runtime") + sep);
}

/**
 * Every existing file outside src/runtime/ that a `#[path = "..."]` attribute
 * in the crate points at, resolved the way generate-classes.ts resolves them
 * (against the declaring file's directory; for an attribute inside an inline
 * `mod { }` block, which the walk skips, that can name a file that is not
 * there, hence the existence check). Whether the mount is `pub` is not checked:
 * a private one only makes the edge list a file the walk skips.
 */
function filesMountedFromOutsideSrcRuntime(cfg: Config): string[] {
  const mounted = new Set<string>();
  for (const file of new Bun.Glob("src/runtime/**/*.rs").scanSync({ cwd: cfg.cwd, absolute: true })) {
    for (const [, target] of readFileSync(file, "utf8").matchAll(/#\[path\s*=\s*"([^"]+)"\]/g)) {
      const abs = resolve(dirname(file), target!);
      if (!inSrcRuntime(cfg, abs) && existsSync(abs)) mounted.add(abs);
    }
  }
  return [...mounted].sort();
}

/** Emits the generate-classes step for the given source lists and returns the inputs its edge tracks. */
function generatedClassesInputs(c: Configured, rust: string[], zigGeneratedClasses: string[]): string[] {
  const { n, cfg, o, dirStamp } = c;
  emitGeneratedClasses({ n, cfg, sources: sourceLists({ zigGeneratedClasses, rust }), o, dirStamp });
  return trackedInputs(n, resolve(cfg.codegenDir, "generated_classes.rs"));
}

describe("emitGeneratedClasses", () => {
  test("tracks class-definitions.ts along with the script and the .classes.ts files", () => {
    using dir = tempDir("build-codegen-classes-inputs", {});
    const c = configure(String(dir));
    const classesFiles = [c.src("src/runtime/api/Archive.classes.ts"), c.src("src/jsc/resolve_message.classes.ts")];

    expect(generatedClassesInputs(c, [], classesFiles)).toEqual(
      expect.arrayContaining([
        c.src("src/codegen/generate-classes.ts"),
        c.src("src/codegen/class-definitions.ts"),
        ...classesFiles,
      ]),
    );
  });

  test("tracks the .rs files under src/runtime/ from the rust glob and nothing else from it", () => {
    using dir = tempDir("build-codegen-classes-rs", {});
    const c = configure(String(dir));
    const crate = [c.src("src/runtime/lib.rs"), c.src("src/runtime/api.rs"), c.src("src/runtime/api/Archive.rs")];
    // The rest of what glob-sources' `rust` pattern matches: the crate's
    // non-.rs entries, other crates (one with a directory name that shares the
    // prefix), and the workspace manifests.
    const otherRustSources = [
      c.src("src/runtime/Cargo.toml"),
      c.src("src/runtime/server/dev-error-page.html"),
      c.src("src/runtime_probe/lib.rs"),
      c.src("src/jsc/lib.rs"),
      c.src("src/install/lib.rs"),
      c.src("Cargo.toml"),
      c.src("Cargo.lock"),
      c.src("rust-toolchain.toml"),
    ];

    const tracked = generatedClassesInputs(
      c,
      [...otherRustSources, ...crate],
      [c.src("src/runtime/api/Archive.classes.ts")],
    );

    expect(tracked).toEqual(expect.arrayContaining(crate));
    for (const p of otherRustSources) expect(tracked).not.toContain(p);
  });

  test("the .rs files it tracks outside src/runtime/ are the ones the crate mounts from there with #[path]", () => {
    using dir = tempDir("build-codegen-classes-mounts", {});
    const c = configure(String(dir));

    const tracked = generatedClassesInputs(
      c,
      [c.src("src/runtime/lib.rs")],
      [c.src("src/runtime/api/Archive.classes.ts")],
    );

    const mounted = filesMountedFromOutsideSrcRuntime(c.cfg);
    // lib.rs mounts src/bun.js.rs and src/jsc/generated_classes_list.rs today;
    // what matters is that codegen.ts's list and the tree's attributes move together.
    expect(mounted).not.toBeEmpty();
    expect(tracked.filter(p => p.endsWith(".rs") && !inSrcRuntime(c.cfg, p)).sort()).toEqual(mounted);
  });
});

describe("emitBindgen", () => {
  test("tracks bindgen-lib.ts and bindgen-lib-internal.ts along with the script and the .bind.ts files", () => {
    using dir = tempDir("build-codegen-bindgen-inputs", {});
    const c = configure(String(dir));
    const { n, cfg, o, dirStamp } = c;
    const bindgen = [c.src("src/runtime/node/node_os.bind.ts"), c.src("src/runtime/api/BunObject.bind.ts")];

    emitBindgen({ n, cfg, sources: sourceLists({ bindgen }), o, dirStamp });

    expect(trackedInputs(n, resolve(cfg.codegenDir, "GeneratedBindings.cpp"))).toEqual(
      expect.arrayContaining([
        c.src("src/codegen/bindgen.ts"),
        c.src("src/codegen/bindgen-lib.ts"),
        c.src("src/codegen/bindgen-lib-internal.ts"),
        ...bindgen,
      ]),
    );
  });
});
