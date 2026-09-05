/**
 * scripts/build/exception-lint.ts loads the jsc-exception-lint clang plugin
 * into every compile of bun's own C++.
 *
 * The first block is pure config evaluation, no compiler is spawned: the
 * plugin is detected from the layout of the LLVM install, the flags it adds
 * must stay out of compile_commands.json (clangd and the standalone tool read
 * that) and must not contain an absolute path (ccache keys are shared across
 * checkouts through CCACHE_BASEDIR).
 *
 * The second block runs the plugin a build made on small fixtures, and is
 * skipped when no build has one.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows, tempDir } from "harness";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { cxx, registerCompileRules, registerDirStamps } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { BuildError } from "../../scripts/build/error.ts";
import { emitExceptionLint, registerExceptionLintRules } from "../../scripts/build/exception-lint.ts";
import { Ninja } from "../../scripts/build/ninja.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
function mockToolchain(cxxPath = "/fake/llvm/bin/clang++"): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: cxxPath,
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
    nm: "/fake/llvm/bin/llvm-nm",
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
 * A linux-x64 debug target in `buildDir`; it resolves on every host once told
 * where its sysroot is (the path is only recorded).
 */
function linuxConfig(partial: PartialConfig, buildDir: string, toolchain = mockToolchain()): Config {
  return resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", buildDir, linuxSysroot: buildDir, ...partial },
    toolchain,
  );
}

/** The plugin is a host artifact: its extension follows the host, not the target. */
const pluginExt = isMacOS ? ".dylib" : ".so";

/**
 * The layout findLlvmDevDir looks for: a clang++ whose real path is two
 * levels below the install root, the plugin registry header, and libclang-cpp.
 * Returns the path of that clang++.
 */
function fakeLlvmInstall(root: string): string {
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "include", "clang", "Frontend"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "bin", "clang++"), "");
  writeFileSync(join(root, "include", "clang", "Frontend", "FrontendPluginRegistry.h"), "");
  writeFileSync(join(root, "lib", "libclang-cpp.so.21.1"), "");
  return join(root, "bin", "clang++");
}

describe("jsc-exception-lint in the build", () => {
  test("off, and not configurable on, without the clang development headers", () => {
    using dir = tempDir("build-exception-lint", {});
    const cfg = linuxConfig({}, String(dir));
    expect({ llvmDevDir: cfg.llvmDevDir, exceptionLint: cfg.exceptionLint }).toEqual({
      llvmDevDir: undefined,
      exceptionLint: false,
    });
    expect(() => linuxConfig({ exceptionLint: true }, String(dir))).toThrow(BuildError);

    const n = new Ninja({ buildDir: String(dir) });
    registerExceptionLintRules(n, cfg);
    expect(emitExceptionLint(n, cfg)).toBeUndefined();
    expect(n.toString()).not.toContain("clang_plugin");
  });

  // A Windows host never loads the plugin (clang-cl), whatever the install
  // layout, so the detection is not exercised there.
  test.skipIf(isWindows)("on by default when the headers sit next to clang++", () => {
    using dir = tempDir("build-exception-lint", {});
    const llvm = join(String(dir), "llvm");
    const cfg = linuxConfig({}, join(String(dir), "build"), mockToolchain(fakeLlvmInstall(llvm)));
    expect({ llvmDevDir: cfg.llvmDevDir, exceptionLint: cfg.exceptionLint }).toEqual({
      llvmDevDir: realpathSync(llvm),
      exceptionLint: true,
    });
    const toolchain = mockToolchain(fakeLlvmInstall(llvm));
    expect(linuxConfig({ exceptionLint: false }, join(String(dir), "build"), toolchain).exceptionLint).toBe(false);
    // The check models the ThrowScope validator of assertion builds; a plain
    // release build has a trivial ThrowScope destructor and stays out.
    expect(linuxConfig({ buildType: "Release" }, join(String(dir), "build"), toolchain).exceptionLint).toBe(false);
    expect(linuxConfig({ buildType: "Release", asan: true }, join(String(dir), "build"), toolchain).exceptionLint).toBe(
      true,
    );
    expect(() =>
      linuxConfig({ buildType: "Release", exceptionLint: true }, join(String(dir), "build"), toolchain),
    ).toThrow(BuildError);
  });

  test.skipIf(isWindows)("the plugin flags reach ninja only, with no absolute path in them", () => {
    using dir = tempDir("build-exception-lint", {});
    const buildDir = join(String(dir), "build");
    const cfg = linuxConfig({}, buildDir, mockToolchain(fakeLlvmInstall(join(String(dir), "llvm"))));
    const n = new Ninja({ buildDir });
    registerDirStamps(n, cfg);
    registerCompileRules(n, cfg);
    registerExceptionLintRules(n, cfg);

    const lint = emitExceptionLint(n, cfg);
    expect(lint).toBeDefined();
    const { flags, implicitInputs } = lint!;
    expect(flags[0]).toBe(`-fplugin=jsc-exception-lint/libjsc-exception-lint-21.1.8${pluginExt}`);
    expect(flags).toContain("werror");
    expect(flags.filter(f => f.startsWith("data-hash="))).toEqual([expect.stringMatching(/^data-hash=[0-9a-f]{16}$/)]);
    // Every path is relative to the build dir, where ninja runs the compiler;
    // the plugin resolves `root` itself.
    for (const flag of flags) {
      expect(flag.replace(/^-?[a-z-]+=/, "")).not.toStartWith("/");
    }
    expect(implicitInputs.map(p => p.replace(buildDir, "<build>").replace(cfg.cwd, "<repo>"))).toEqual([
      `<build>/jsc-exception-lint/libjsc-exception-lint-21.1.8${pluginExt}`,
      "<repo>/scripts/jsc-exception-lint/nothrow.txt",
      "<repo>/scripts/jsc-exception-lint/summaries/webkit.tsv",
      "<repo>/scripts/jsc-exception-lint/summaries/bun.tsv",
      "<repo>/scripts/jsc-exception-lint/baseline.tsv",
    ]);

    const src = resolve(cfg.cwd, "src/jsc/bindings/BunObject.cpp");
    cxx(n, cfg, src, { flags: ["-O0"], ninjaOnlyFlags: flags, implicitInputs });
    const ninja = n.toString().replace(/ \$\n +/g, " ");
    expect(ninja).toContain("rule clang_plugin");
    expect(ninja).toContain(`-O0 -fplugin=jsc-exception-lint/libjsc-exception-lint-21.1.8${pluginExt} -Xclang`);
    // compile_commands.json is written by write(); the entries it would hold
    // are what clangd and the standalone tool read.
    const compileCommands = (n as unknown as { compileCommands: { arguments: string[] }[] }).compileCommands;
    expect(compileCommands).toHaveLength(1);
    const compileArgs = compileCommands[0]!.arguments;
    for (const flag of flags) {
      expect(compileArgs).not.toContain(flag);
    }
    expect(compileArgs.some(a => a.includes("plugin") || a.includes("data-hash"))).toBe(false);
  });
});

// ─── The plugin itself ───

const repoRoot = resolve(import.meta.dir, "../..");

/** The first `bytes` of a file; compile_commands.json is megabytes long. */
function fileHead(path: string, bytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    return buf.toString("utf8", 0, readSync(fd, buf, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * The newest plugin a build made, and the compiler that build used: a plugin
 * loads only into the LLVM it was built against. `bun bd` makes one when the
 * clang development headers are installed. undefined otherwise, and on the CI
 * test lanes, which have no build directory.
 */
function builtPlugin(): { plugin: string; cxx: string } | undefined {
  const buildRoot = join(repoRoot, "build");
  if (isWindows || !existsSync(buildRoot)) return undefined;
  let newest: { plugin: string; cxx: string; mtime: number } | undefined;
  for (const profile of readdirSync(buildRoot)) {
    const lintDir = join(buildRoot, profile, "jsc-exception-lint");
    const commands = join(buildRoot, profile, "compile_commands.json");
    if (!existsSync(lintDir) || !existsSync(commands)) continue;
    const cxx = fileHead(commands, 8192).match(/"arguments": \[\s*"([^"]+)"/)?.[1];
    if (cxx === undefined) continue;
    for (const name of readdirSync(lintDir)) {
      if (!/^libjsc-exception-lint-.*\.(so|dylib)$/.test(name)) continue;
      const plugin = join(lintDir, name);
      const mtime = statSync(plugin).mtimeMs;
      if (newest === undefined || mtime > newest.mtime) newest = { plugin, cxx, mtime };
    }
  }
  return newest;
}

const built = builtPlugin();

/**
 * The JavaScriptCore names the checker recognizes, without JavaScriptCore.
 * `toString` takes a global object and has no body, so by the signature
 * convention it can throw.
 */
const shim = `
namespace JSC {
class VM {};
class Exception {};
class JSGlobalObject {
public:
  VM& vm();
};
class ThrowScope {
public:
  explicit ThrowScope(VM&);
  ~ThrowScope();
  Exception* exception() const;
  void release();
};
struct JSValue {
  JSValue toString(JSGlobalObject*) const;
};
} // namespace JSC
#define DECLARE_THROW_SCOPE(vm__) JSC::ThrowScope((vm__))
#define RETURN_IF_EXCEPTION(scope__, value__) do { if ((scope__).exception()) return value__; } while (false)
#define RELEASE_AND_RETURN(scope__, expression__) do { (scope__).release(); return expression__; } while (false)
`;

/** Each function calls toString twice with no check in between: one finding each. */
const fixtures = {
  "src/shim.h": shim,
  "src/helper.h": `
#include "shim.h"
inline JSC::JSValue helperTwice(JSC::JSGlobalObject* g, JSC::JSValue v) {
  auto scope = DECLARE_THROW_SCOPE(g->vm());
  v.toString(g);
  v.toString(g);
  RETURN_IF_EXCEPTION(scope, {});
  return v;
}
`,
  // Exists, and is not compiled in the unit under test.
  "src/helper.cpp": `#include "helper.h"\n`,
  "src/fixture.cpp": `
#include "helper.h"
using namespace JSC;

JSValue twice(JSGlobalObject* g, JSValue v) {
  auto scope = DECLARE_THROW_SCOPE(g->vm());
  v.toString(g);
  v.toString(g);
  RETURN_IF_EXCEPTION(scope, {});
  return v;
}

JSValue twice(JSGlobalObject* g, int) {
  auto scope = DECLARE_THROW_SCOPE(g->vm());
  JSValue v;
  v.toString(g);
  v.toString(g);
  RETURN_IF_EXCEPTION(scope, {});
  return v;
}

// Member overloads that differ by their qualifiers alone.
struct Box {
  JSValue twice(JSGlobalObject* g) {
    auto scope = DECLARE_THROW_SCOPE(g->vm());
    JSValue v;
    v.toString(g);
    v.toString(g);
    RETURN_IF_EXCEPTION(scope, {});
    return v;
  }
  JSValue twice(JSGlobalObject* g) const {
    auto scope = DECLARE_THROW_SCOPE(g->vm());
    JSValue v;
    v.toString(g);
    v.toString(g);
    RETURN_IF_EXCEPTION(scope, {});
    return v;
  }
};

struct Ref {
  JSValue twice(JSGlobalObject* g) & {
    auto scope = DECLARE_THROW_SCOPE(g->vm());
    JSValue v;
    v.toString(g);
    v.toString(g);
    RETURN_IF_EXCEPTION(scope, {});
    return v;
  }
  JSValue twice(JSGlobalObject* g) && {
    auto scope = DECLARE_THROW_SCOPE(g->vm());
    JSValue v;
    v.toString(g);
    v.toString(g);
    RETURN_IF_EXCEPTION(scope, {});
    return v;
  }
};

// A call through a function pointer member: its callee has no name.
struct Table {
  JSValue (*get)(JSGlobalObject*);
};

JSValue viaTable(JSGlobalObject* g, Table t) {
  auto scope = DECLARE_THROW_SCOPE(g->vm());
  t.get(g);
  t.get(g);
  RETURN_IF_EXCEPTION(scope, {});
  return {};
}

template<typename T> JSValue generic(JSGlobalObject* g, T) {
  auto scope = DECLARE_THROW_SCOPE(g->vm());
  JSValue v;
  v.toString(g);
  v.toString(g);
  RETURN_IF_EXCEPTION(scope, {});
  return v;
}

JSValue caller(JSGlobalObject* g, JSValue v) {
  auto scope = DECLARE_THROW_SCOPE(g->vm());
  auto lambda = [&] {
    auto inner = DECLARE_THROW_SCOPE(g->vm());
    v.toString(g);
    v.toString(g);
    RETURN_IF_EXCEPTION(inner, );
  };
  lambda();
  RETURN_IF_EXCEPTION(scope, {});
  generic(g, 1);
  RETURN_IF_EXCEPTION(scope, {});
  generic(g, v);
  RETURN_IF_EXCEPTION(scope, {});
  RELEASE_AND_RETURN(scope, helperTwice(g, v));
}
`,
  "src/clean.cpp": `
#include "shim.h"
JSC::JSValue checked(JSC::JSGlobalObject* g, JSC::JSValue v) {
  auto scope = DECLARE_THROW_SCOPE(g->vm());
  v.toString(g);
  RETURN_IF_EXCEPTION(scope, {});
  RELEASE_AND_RETURN(scope, v.toString(g));
}
`,
};

const toString = "JSC::JSValue::toString";

/** The baseline key of each finding in fixture.cpp, as the error notes print them. */
const fixtureKeys = [
  `src/fixture.cpp\ttwice(JSC::JSGlobalObject *, JSC::JSValue)\tpending-call\t${toString}`,
  `src/fixture.cpp\ttwice(JSC::JSGlobalObject *, int)\tpending-call\t${toString}`,
  `src/fixture.cpp\tBox::twice(JSC::JSGlobalObject *)\tpending-call\t${toString}`,
  `src/fixture.cpp\tBox::twice(JSC::JSGlobalObject *) const\tpending-call\t${toString}`,
  `src/fixture.cpp\tRef::twice(JSC::JSGlobalObject *) &\tpending-call\t${toString}`,
  `src/fixture.cpp\tRef::twice(JSC::JSGlobalObject *) &&\tpending-call\t${toString}`,
  `src/fixture.cpp\tviaTable(JSC::JSGlobalObject *, Table)\tpending-call\t<indirect call through get>`,
  `src/fixture.cpp\tgeneric(JSC::JSGlobalObject *, T)\tpending-call\t${toString}`,
  `src/fixture.cpp\t<lambda at fixture.cpp>\tpending-call\t${toString}`,
  `src/helper.h\thelperTwice(JSC::JSGlobalObject *, JSC::JSValue)\tpending-call\t${toString}`,
];

/** Compile `file` (under <dir>/src) with the plugin, as the build does. */
async function lint(dir: string, file: string, pluginArgs: string[] = []) {
  const { plugin, cxx } = built!;
  const pluginArg = (arg: string) => ["-Xclang", "-plugin-arg-jsc-exception-lint", "-Xclang", arg];
  await using proc = Bun.spawn({
    cmd: [
      cxx,
      "-x",
      "c++",
      "-std=c++20",
      "-fsyntax-only",
      "-fno-color-diagnostics",
      `-fplugin=${plugin}`,
      ...[`root=${dir}`, "werror", ...pluginArgs].flatMap(pluginArg),
      file,
    ],
    cwd: join(dir, "src"),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return {
    errors: stderr.match(/error: jsc-exception-lint:/g)?.length ?? 0,
    keys: [...stderr.matchAll(/note: in .*; baseline entry: (.*)$/gm)].map(m => m[1]!.split(" | ").join("\t")).sort(),
    stale: [...stderr.matchAll(/baseline entry no longer fires, remove it: (.*)$/gm)].map(m => m[1]!),
    exitCode,
    stderr,
  };
}

describe.skipIf(built === undefined)("the jsc-exception-lint plugin", () => {
  test.concurrent("a baseline key tells overloads apart, and covers every instantiation of a template", async () => {
    using dir = tempDir("exception-lint-plugin", fixtures);
    const result = await lint(String(dir), "fixture.cpp");
    // One error per function: the two instantiations of generic() are one
    // finding, and the finding in helper.h is reported by this unit even
    // though helper.cpp exists.
    expect({ errors: result.errors, keys: result.keys, exitCode: result.exitCode }).toEqual({
      errors: fixtureKeys.length,
      keys: [...fixtureKeys].sort(),
      exitCode: 1,
    });
  });

  test.concurrent(
    "a baseline entry silences its finding only, and an entry that no longer fires is a warning",
    async () => {
      using dir = tempDir("exception-lint-plugin", {
        ...fixtures,
        "baseline.tsv": [
          "# known findings",
          `src/fixture.cpp\ttwice(JSC::JSGlobalObject *, int)\tpending-call\t${toString}`,
          `src/fixture.cpp\tgone(int)\tpending-call\t${toString}`,
        ].join("\n"),
      });
      const result = await lint(String(dir), "fixture.cpp", [`baseline=${join(String(dir), "baseline.tsv")}`]);
      expect({ errors: result.errors, keys: result.keys, stale: result.stale }).toEqual({
        errors: fixtureKeys.length - 1,
        keys: fixtureKeys.filter(key => !key.includes(", int)")).sort(),
        stale: [`src/fixture.cpp\tgone(int)\tpending-call\t${toString}`],
      });
    },
  );

  test.concurrent("a function that checks after each call compiles", async () => {
    using dir = tempDir("exception-lint-plugin", fixtures);
    const result = await lint(String(dir), "clean.cpp");
    // Only the lint's own lines: a warning of another clang version is not
    // what this test is about.
    const lintLines = result.stderr.split("\n").filter(line => line.includes("jsc-exception-lint"));
    expect({ lintLines, exitCode: result.exitCode }).toEqual({ lintLines: [], exitCode: 0 });
  });
});
