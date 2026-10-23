/**
 * `--webkit=local` (scripts/build/deps/webkit.ts): a WebKit checkout compiled in bun's own ninja graph, described from
 * the checkout's own file lists. CI links the prebuilt WebKit, so nothing else exercises this. Configure-time only: no
 * compiler or ninja runs, and the "checkout" is a few files with the shape of WebKit's.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { cxx } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import {
  jscPrograms,
  prebuiltHasProgramObjects,
  webkit,
  webkitAotFile,
  webkitEngineSources,
  webkitJSCPath,
  webkitTestAotPath,
  type WebKitAotFile,
} from "../../scripts/build/deps/webkit.ts";
import { BuildError } from "../../scripts/build/error.ts";
import { Ninja, readManifest } from "../../scripts/build/ninja.ts";
import { getProfile } from "../../scripts/build/profiles.ts";
import { registerAllRules } from "../../scripts/build/rules.ts";
import {
  depSource,
  resolveDep,
  type Dependency,
  type DepName,
  type DirectBuild,
  type GenStep,
  type ResolvedDep,
} from "../../scripts/build/source.ts";

/** A fully-populated fake toolchain; resolveConfig never spawns any of these. */
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
    nasm: undefined,
  };
}

/** A Linux glibc x64 target; linuxSysroot stubbed so resolveConfig never throws on another host. */
const linux = (partial: PartialConfig): Config =>
  resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Debug", linuxSysroot: "/fake/linux-sysroot", ...partial },
    mockToolchain(),
  );

describe("which builds compile WebKit", () => {
  test("only the -local profiles; CI and the defaults link the prebuilt", () => {
    const local = ["debug-local", "release-local"];
    for (const name of ["debug", "release", "release-asan", "ci-build", ...local]) {
      expect([name, getProfile(name).webkit]).toEqual([name, local.includes(name) ? "local" : "prebuilt"]);
    }
    expect(linux({}).webkit).toBe("prebuilt");
    expect(webkit.source(linux({})).kind).toBe("prebuilt");
    expect(webkit.build(linux({}))).toEqual({ kind: "none" });
  });

  test("with the prebuilt, jsc and testaot are the tarball's objects linked here, where the tarball has them", () => {
    using dir = tempDir("build-prebuilt-programs", {});
    const buildDir = join(String(dir), "build");
    const cfg = linux({ buildDir, cacheDir: join(String(dir), "cache"), buildType: "Release" });
    const source = webkit.source(cfg);
    if (source.kind !== "prebuilt") throw new Error(`a ${source.kind} source`);
    const objects = (name: string) => `lib/lib${name}-objects.a`;

    expect(webkit.provides(cfg).contentsDecideGraph).toBe(true);
    expect(prebuiltHasProgramObjects(cfg)).toBe(false);
    expect(jscPrograms(cfg)).toEqual([]);
    expect(webkit.provides(cfg).files).not.toContain(objects("testaot"));
    expect([webkitJSCPath(cfg), webkitTestAotPath(cfg)]).toEqual(
      ["jsc", "testaot"].map(name => join(source.destDir!, "bin", name)),
    );

    mkdirSync(join(source.destDir!, "lib"), { recursive: true });
    writeFileSync(join(source.destDir!, objects("jsc")), "");
    expect(prebuiltHasProgramObjects(cfg)).toBe(false);
    writeFileSync(join(source.destDir!, objects("testaot")), "");
    expect(prebuiltHasProgramObjects(cfg)).toBe(true);
    expect(
      jscPrograms(cfg).map(({ name, sources, libs }) => [name, sources.map(s => relative(buildDir, s)), libs]),
    ).toEqual(
      ["jsc", "testaot"].map(name => [
        name,
        [join("deps", "WebKit", "programs", name, "OutOfMemory.cpp")],
        [join(source.destDir!, objects(name))],
      ]),
    );
    expect(webkit.provides(cfg).files).toEqual(expect.arrayContaining([objects("jsc"), objects("testaot")]));
    expect([webkitJSCPath(cfg), webkitTestAotPath(cfg)]).toEqual([join(buildDir, "jsc"), join(buildDir, "testaot")]);
  });

  test("--webkit=local is a --local-deps entry: $BUN_WEBKIT_PATH, else vendor/WebKit", () => {
    const saved = process.env.BUN_WEBKIT_PATH;
    try {
      process.env.BUN_WEBKIT_PATH = join("/somewhere", "WebKit");
      expect(linux({ webkit: "local" }).localDeps.WebKit).toBe(resolve("/somewhere", "WebKit"));
      delete process.env.BUN_WEBKIT_PATH;
      const cfg = linux({ webkit: "local" });
      expect(cfg.localDeps.WebKit).toBe(join(cfg.vendorDir, "WebKit"));
      expect(depSource(cfg, webkit)).toMatchObject({ kind: "local", path: join(cfg.vendorDir, "WebKit") });
    } finally {
      if (saved === undefined) delete process.env.BUN_WEBKIT_PATH;
      else process.env.BUN_WEBKIT_PATH = saved;
    }
  });

  test("--local-deps=WebKit=<path> means --webkit=local", () => {
    const cfg = linux({ localDeps: `WebKit=${join("/elsewhere", "WebKit")}` });
    expect(cfg.webkit).toBe("local");
    expect(cfg.localDeps.WebKit).toBe(resolve("/elsewhere", "WebKit"));
  });

  test("a missing checkout says where it looked", () => {
    expect(() => webkit.build(linux({ localDeps: "WebKit=/nowhere/WebKit" }))).toThrow(
      /local WebKit checkout not found at (\w:)?.nowhere.WebKit/,
    );
  });

  test.skipIf(process.platform === "darwin")("macOS and Windows targets need their own host", () => {
    expect(() =>
      resolveConfig({ os: "darwin", arch: "aarch64", webkit: "local", macosSdk: "/fake/sdk" }, mockToolchain()),
    ).toThrow(/Cross-compiling for macOS requires the prebuilt WebKit/);
  });

  test("WebKit's AoT files are at the same path in the tarball and in the checkout", () => {
    const names: WebKitAotFile[] = ["directory", "AOTSchema.def", "schema-generator", "tests"];
    const under = (aot: string) => [
      aot,
      join(aot, "ir", "AOTSchema.def"),
      join(aot, "ir", "generator", "index.ts"),
      join(aot, "tests"),
    ];

    const prebuilt = linux({});
    const source = webkit.source(prebuilt);
    if (source.kind !== "prebuilt") throw new Error(`a ${source.kind} source`);
    const dest = source.destDir!;
    expect(names.map(name => webkitAotFile(prebuilt, name))).toEqual(
      under(join(dest, "Source", "JavaScriptCore", "aot")),
    );
    expect(webkitTestAotPath(prebuilt)).toBe(join(dest, "bin", "testaot"));
    // What the prebuilt engine was compiled with comes with it. A build that compiles the engine makes its own.
    expect(webkitAotFile(prebuilt, "builtins-generated")).toBe(
      join(dest, "Source", "JavaScriptCore", "aot", "builtins", "generated"),
    );
    // Nothing is written into the tarball.
    expect(webkitEngineSources(prebuilt)).toMatchObject({
      javaScriptCore: undefined,
      schemaGeneratedDirectory: undefined,
      schemaOutputs: [],
      builtinTableOutputs: [],
      builtinsLeftOut: [],
    });

    const local = linux({ localDeps: `WebKit=${join("/elsewhere", "WebKit")}` });
    const jsc = join(resolve("/elsewhere", "WebKit"), "Source", "JavaScriptCore");
    expect(names.map(name => webkitAotFile(local, name))).toEqual(under(join(jsc, "aot")));
    expect(webkitAotFile(local, "builtins-generated")).toStartWith(local.buildDir);
    expect(webkitTestAotPath(local)).toBe(join(local.buildDir, "testaot"));
  });
});

/** WebKit's bundler, reduced to its contract: writes bundles under <derived>/unified-sources, prints a cmake list. */
const bundler = `
import sys, os
args = sys.argv[1:]
derived = args[args.index("--derived-sources-path") + 1]
out = os.path.join(derived, "unified-sources")
os.makedirs(out, exist_ok=True)
bundled, alone = [], []
for path in [a for a in args if a.endswith(".txt")]:
    for line in open(path):
        parts = line.split()
        if parts:
            (alone if "@no-unify" in parts or "--print-all-sources" in args else bundled).append(parts[0])
prefix = args[args.index("--bundle-filename-prefix") + 1] if "--bundle-filename-prefix" in args else ""
size = "-of-" + args[args.index("--max-bundle-size") + 1] if "--max-bundle-size" in args else ""
bundle = os.path.join(out, prefix + "UnifiedSource" + size + "-1.cpp")
if bundled:
    open(bundle, "w").write("".join('#include "%s"\\n' % s for s in bundled))
sys.stdout.write(";".join(([bundle] if bundled else []) + alone) + ";")
`;

const checkout = {
  "Source/bmalloc/CMakeLists.txt": `
    set(bmalloc_PRIVATE_INCLUDE_DIRECTORIES "\${BMALLOC_DIR}" "\${BMALLOC_DIR}/bmalloc")
    if (USE_MIMALLOC)
        list(APPEND bmalloc_PRIVATE_INCLUDE_DIRECTORIES "\${BMALLOC_DIR}/mimalloc/mimalloc/include")
    endif ()
    set(bmalloc_SOURCES bmalloc/Heap.cpp libpas/as_cxx.c)
    list(APPEND bmalloc_SOURCES bmalloc/Heap.cpp)
    set(bmalloc_C_SOURCES libpas/pas.c)
    set(bmalloc_PUBLIC_HEADERS bmalloc/bmalloc.h)
    set(bmalloc_PRIVATE_HEADERS libpas/pas_private.h)
    if (USE_MIMALLOC)
        list(APPEND bmalloc_PUBLIC_HEADERS mimalloc/mimalloc/include/mimalloc.h)
    endif ()`,
  "Source/WTF/wtf/CMakeLists.txt": `
    set(WTF_SOURCES Assertions.cpp darwin/OSLogPrintStream.mm)
    set(WTF_PRIVATE_INCLUDE_DIRECTORIES "\${CMAKE_BINARY_DIR}" "\${WTF_DIR}" "\${WTF_DIR}/wtf")
    WEBKIT_INCLUDE_CONFIG_FILES_IF_EXISTS()`,
  "Source/WTF/wtf/PlatformJSCOnly.cmake": `
    if (WIN32)
        list(APPEND WTF_SOURCES win/ThreadingWin.cpp)
    else ()
        list(APPEND WTF_SOURCES posix/ThreadingPOSIX.cpp unix/LoggingUnix.cpp)
        if (ANDROID)
            list(REMOVE_ITEM WTF_SOURCES unix/LoggingUnix.cpp)
            list(APPEND WTF_SOURCES android/LoggingAndroid.cpp)
        endif ()
    endif ()
    if (CMAKE_SYSTEM_NAME MATCHES "Linux")
        list(APPEND WTF_SOURCES linux/MemoryFootprintLinux.cpp)
    endif ()
    if (LOWERCASE_EVENT_LOOP_TYPE STREQUAL "bun")
        list(APPEND WTF_SOURCES bun/RunLoopBun.cpp)
    else ()
        list(APPEND WTF_SOURCES generic/RunLoopGeneric.cpp)
    endif ()`,
  "Source/WTF/Scripts/generate-unified-source-bundles.py": bundler,
  "Source/JavaScriptCore/CMakeLists.txt": `
    list(APPEND JavaScriptCore_UNIFIED_SOURCE_LIST_FILES "Sources.txt")
    set(JavaScriptCore_INCLUDE_DIRECTORIES "\${JavaScriptCore_FRAMEWORK_HEADERS_DIR}")
    set(JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES "\${JAVASCRIPTCORE_DIR}/runtime" "\${JavaScriptCore_DERIVED_SOURCES_DIR}")
    set(JavaScriptCore_OBJECT_LUT_SOURCES runtime/MapPrototype.cpp)
    list(APPEND JavaScriptCore_SOURCES \${JavaScriptCore_DERIVED_SOURCES_DIR}/JSCBuiltins.cpp)
    set(LLINT_ASM llint/LowLevelInterpreter.asm)
    set(OFFLINE_ASM offlineasm/asm.rb)
    set(GENERATOR generator/main.rb)
    set(JavaScriptCore_BUILTINS_SOURCES \${JAVASCRIPTCORE_DIR}/builtins/MapPrototype.js)
    set(JavaScriptCore_PUBLIC_FRAMEWORK_HEADERS API/JSBase.h)
    set(JavaScriptCore_PRIVATE_FRAMEWORK_HEADERS \${JavaScriptCore_DERIVED_SOURCES_DIR}/Bytecodes.h runtime/JSObject.h)
    set(JavaScriptCore_INSPECTOR_PROTOCOL_SCRIPTS \${JAVASCRIPTCORE_DIR}/inspector/scripts/generate.py)
    set(JavaScriptCore_INSPECTOR_DOMAINS \${JAVASCRIPTCORE_DIR}/inspector/protocol/Runtime.json)
    WEBKIT_INCLUDE_CONFIG_FILES_IF_EXISTS()
    include(aot/AOT.cmake)`,
  "Source/JavaScriptCore/PlatformJSCOnly.cmake": `
    if (USE_INSPECTOR_SOCKET_SERVER)
        include(inspector/remote/Socket.cmake)
    endif ()`,
  "Source/JavaScriptCore/inspector/remote/Socket.cmake": `
    list(APPEND JavaScriptCore_UNIFIED_SOURCE_LIST_FILES "inspector/remote/SourcesSocket.txt")
    if (UNIX)
        list(APPEND JavaScriptCore_SOURCES inspector/remote/socket/posix/RemoteInspectorSocketPOSIX.cpp)
    else ()
        list(APPEND JavaScriptCore_SOURCES inspector/remote/socket/win/RemoteInspectorSocketWin.cpp)
    endif ()`,
  "Source/JavaScriptCore/Sources.txt": `runtime/JSObject.cpp\nruntime/MapPrototype.cpp\njit/Alone.cpp @no-unify\nGenerated.cpp @no-unify\n`,
  "Source/JavaScriptCore/inspector/remote/SourcesSocket.txt": `inspector/remote/RemoteInspector.cpp\n`,
  "Source/JavaScriptCore/ucd/UnicodeData.txt": "",
  "Source/JavaScriptCore/Scripts/generate-js-builtins.py": "",
  "Source/JavaScriptCore/Scripts/wkbuiltins/wkbuiltins.py": "",
  "Source/JavaScriptCore/aot/AOT.cmake": `
    set(JavaScriptCore_AOT_GENERATED_DIR "\${JavaScriptCore_DERIVED_SOURCES_DIR}/aot")
    set(JavaScriptCore_AOT_RUNTIME_FACTS_GENERATED_HEADERS "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTRuntimeFactsOfLayouts.def")
    set(JavaScriptCore_AOT_SCHEMA_INPUTS aot/ir/AOTSchema.def)
    set(JavaScriptCore_AOT_SCHEMA_GENERATED_HEADERS "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTWire.h")
    set(JavaScriptCore_AOT_SCHEMA_GENERATED_SOURCES "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTSchemaEnumNames.cpp")
    set(JavaScriptCore_AOT_BUILTIN_TABLE_DECLARATIONS aot/builtins/array.builtins.ts)
    set(JavaScriptCore_AOT_BUILTIN_TABLE_GENERATED_HEADERS "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTBuiltinIDs.h")
    set(JavaScriptCore_AOT_BUILTIN_TABLE_GENERATED_SOURCES "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTBuiltinTableEngineBindings.cpp")
    set(JavaScriptCoreAOT_UNIFIED_SOURCE_LIST_FILES "aot/Sources.txt")
    set(JavaScriptCoreAOTCompiledForSize_UNIFIED_SOURCE_LIST_FILES "aot/SourcesCompiledForSize.txt")
    set(JavaScriptCoreAOTCompiledForSize_UNIFIED_SOURCE_BUNDLE_PREFIX "CompiledForSize")
    set(JavaScriptCore_AOT_GENERATED_SOURCES_COMPILED_FOR_SIZE "\${JavaScriptCore_AOT_GENERATED_DIR}/AOTSchemaEnumNames.cpp")
    list(APPEND JavaScriptCore_SOURCES \${JavaScriptCore_AOT_SCHEMA_GENERATED_SOURCES} \${JavaScriptCore_AOT_BUILTIN_TABLE_GENERATED_SOURCES})
    list(APPEND JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES "\${JavaScriptCore_AOT_GENERATED_DIR}")
    list(APPEND JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES
        "\${JAVASCRIPTCORE_DIR}/aot/ir"
    )
    set(JavaScriptCore_AOT_EXPORTED_HEADERS)
    set(JavaScriptCore_AOT_TEST_SOURCES aot/tests/testaot.cpp)
    set(JavaScriptCore_AOT_PROGRAM_SOURCES aot/runtime/AOTNoFeatureRemoved.cpp)
    set(JavaScriptCore_AOT_SHELL_SOURCES aot/tests/AOTShell.cpp)
    function(AOT_CHECK_SOURCE_LISTS)
        if (NO SUCH OPERATOR)
        endif ()
    endfunction()
    AOT_CHECK_SOURCE_LISTS()`,
  "Source/JavaScriptCore/aot/Sources.txt": `aot/ir/AOTValue.cpp\n`,
  "Source/JavaScriptCore/aot/SourcesCompiledForSize.txt": `aot/ir/AOTVerifier.cpp\n`,
  "Source/JavaScriptCore/aot/ir/AOTVerifier.cpp": "",
  "Source/JavaScriptCore/aot/ir/AOTSchema.def": "",
  "Source/JavaScriptCore/aot/ir/generator/index.ts": "",
  "Source/JavaScriptCore/aot/builtins/generator/engine.ts": "",
  "Source/JavaScriptCore/aot/ir/generator/package.json": "",
  "Source/JavaScriptCore/aot/ir/AOTValue.cpp": "",
  "Source/JavaScriptCore/aot/runtime/AOTNoFeatureRemoved.cpp": "",
  "Source/JavaScriptCore/aot/tests/AOTShell.cpp": "",
  "Source/JavaScriptCore/aot/tests/testaot.cpp": "",
  "Source/JavaScriptCore/b3/testb3_1.cpp": "",
  "Source/JavaScriptCore/b3/testb3_bun_loops.cpp": "",
  "Source/JavaScriptCore/b3/testb3_bun_values.h": "",
};

/** The checkout with files of JavaScriptCore added, replaced or (undefined) removed. */
function checkoutWith(changes: Record<string, string | undefined>): Record<string, string> {
  const files: Record<string, string> = { ...checkout };
  for (const [path, text] of Object.entries(changes)) {
    if (text === undefined) delete files[`Source/JavaScriptCore/${path}`];
    else files[`Source/JavaScriptCore/${path}`] = text;
  }
  return files;
}

const python = isWindows ? "python" : "python3";

describe.skipIf(Bun.which(python) === null)("the graph of a checkout", () => {
  /**
   * A target whose WebKit is these files. `short` spells a path under the checkout, the build dir, vendor/ or the
   * repository relative to it.
   */
  function checkOut(partial: PartialConfig, files: Record<string, string>) {
    const dir = tempDir("build-local-webkit", files);
    const root = String(dir);
    const cfg = linux({ localDeps: `WebKit=${root}`, buildDir: join(root, "build"), ...partial });
    const short = (written: string) => {
      const p = isWindows ? written.replaceAll("/", "\\") : written;
      for (const [name, base] of [
        ["B", join(cfg.buildDir, "deps", "WebKit")],
        ["JSC", join(root, "Source", "JavaScriptCore")],
        ["WTF", join(root, "Source", "WTF")],
        ["bmalloc", join(root, "Source", "bmalloc")],
        ["vendor", cfg.vendorDir],
        ["bun", cfg.cwd],
      ] as const) {
        if (p.startsWith(base)) return `${name}/${relative(base, p).replaceAll("\\", "/")}`;
      }
      return written;
    };
    return { cfg, short, [Symbol.dispose]: () => dir[Symbol.dispose]() };
  }

  /** webkit.build() for a target. */
  function describeBuild(partial: PartialConfig, files: Record<string, string> = checkout) {
    using local = checkOut(partial, files);
    const { cfg, short } = local;
    const spec = webkit.build(cfg) as DirectBuild;
    const group = (name: string) => {
      const g = spec.groups!.find(g => g.name === name)!;
      return {
        sources: g.sources.map(s => short(typeof s === "string" ? s : s.path)),
        includes: g.includes!.map(short),
      };
    };
    const step = (desc: string) => {
      const s = spec.steps!.find((s): s is GenStep => s.kind !== "exe" && s.desc === desc)!;
      return { outputs: s.outputs.map(short), cmd: s.cmd.map(short), inputs: s.inputs.map(short), cwd: short(s.cwd) };
    };
    return { cfg, spec, short, group, step };
  }

  /** What webkit.build() fails with. */
  function configureError(files: Record<string, string>): { message: string; hint: string | undefined } {
    try {
      describeBuild({}, files);
    } catch (error) {
      if (error instanceof BuildError) return { message: error.message, hint: error.hint };
      throw error;
    }
    throw new Error("webkit.build() did not fail");
  }

  test("each library compiles what its CMake lists name for the target", () => {
    const { group, spec } = describeBuild({ asan: false });
    expect(spec.kind).toBe("direct");
    expect(group("bmalloc")).toEqual({
      // Heap.cpp is listed twice; cmake compiles it once.
      sources: ["bmalloc/bmalloc/Heap.cpp", "bmalloc/libpas/as_cxx.c", "bmalloc/libpas/pas.c"],
      // The mimalloc bun links, not WebKit's vendored copy.
      includes: ["B/", "bmalloc/", "bmalloc/bmalloc", "vendor/mimalloc/include"],
    });
    expect(spec.groups!.find(g => g.name === "bmalloc")!.sources[1]).toMatchObject({ lang: "cxx" });
    // No Objective-C++: nothing in the JSCOnly port refers to it.
    expect(group("WTF").sources).toEqual([
      "WTF/wtf/Assertions.cpp",
      "WTF/wtf/posix/ThreadingPOSIX.cpp",
      "WTF/wtf/unix/LoggingUnix.cpp",
      "WTF/wtf/linux/MemoryFootprintLinux.cpp",
      "WTF/wtf/bun/RunLoopBun.cpp",
    ]);
    expect(group("JavaScriptCore").sources).toEqual([
      "B/JavaScriptCore/DerivedSources/unified-sources/UnifiedSource-1.cpp",
      "JSC/jit/Alone.cpp",
      // A bare name that is not in the tree is a generated source.
      "B/JavaScriptCore/DerivedSources/Generated.cpp",
      "B/JavaScriptCore/DerivedSources/unified-sources/UnifiedSource-of-8-1.cpp",
      "B/JavaScriptCore/DerivedSources/unified-sources/CompiledForSizeUnifiedSource-of-8-1.cpp",
      "B/JavaScriptCore/DerivedSources/JSCBuiltins.cpp",
      "JSC/inspector/remote/socket/posix/RemoteInspectorSocketPOSIX.cpp",
      // What the generators of aot/ write.
      "B/JavaScriptCore/DerivedSources/aot/AOTSchemaEnumNames.cpp",
      "B/JavaScriptCore/DerivedSources/aot/AOTBuiltinTableEngineBindings.cpp",
      "JSC/llint/LowLevelInterpreter.cpp",
    ]);
    expect(group("JavaScriptCore").includes).toEqual([
      "B/JavaScriptCore/Headers",
      "JSC/runtime",
      "B/JavaScriptCore/DerivedSources",
      "B/JavaScriptCore/DerivedSources/aot",
      "JSC/aot/ir",
      "WTF/",
      "B/bmalloc/Headers",
      "B/bmalloc/Headers/bmalloc",
    ]);
  });

  test("a bundle of aot/ names the sources that it includes", () => {
    const { spec, short } = describeBuild({ asan: false });
    const sources = spec.groups!.find(g => g.name === "JavaScriptCore")!.sources;
    expect(
      sources.flatMap(s => (typeof s !== "string" && s.bundled ? [[short(s.path), ...s.bundled.map(short)]] : [])),
    ).toEqual([
      ["B/JavaScriptCore/DerivedSources/unified-sources/UnifiedSource-of-8-1.cpp", "JSC/aot/ir/AOTValue.cpp"],
      [
        "B/JavaScriptCore/DerivedSources/unified-sources/CompiledForSizeUnifiedSource-of-8-1.cpp",
        "JSC/aot/ir/AOTVerifier.cpp",
      ],
    ]);
  });

  test("--unified-sources=off compiles each source of aot/ by itself", () => {
    const { sources } = describeBuild({ asan: false, unifiedSources: false }).group("JavaScriptCore");
    expect(sources).toContain("JSC/aot/ir/AOTValue.cpp");
    expect(sources).toContain("JSC/aot/ir/AOTVerifier.cpp");
    expect(sources.filter(source => source.includes("UnifiedSource"))).toEqual([
      "B/JavaScriptCore/DerivedSources/unified-sources/UnifiedSource-1.cpp",
    ]);
  });

  test("the lists follow the target and the options", () => {
    expect(describeBuild({ asan: true }).group("bmalloc").includes).toEqual(["B/", "bmalloc/", "bmalloc/bmalloc"]);
    const freebsd = describeBuild({ os: "freebsd", abi: undefined, freebsdSysroot: "/fake/freebsd-sysroot" });
    expect(freebsd.group("WTF").sources).toEqual([
      "WTF/wtf/Assertions.cpp",
      "WTF/wtf/posix/ThreadingPOSIX.cpp",
      "WTF/wtf/unix/LoggingUnix.cpp",
      "WTF/wtf/bun/RunLoopBun.cpp",
    ]);
  });

  test("framework headers are forwarding stubs, and cmakeconfig.h is written", () => {
    const { spec, short } = describeBuild({ asan: false });
    const headers = Object.fromEntries(
      Object.entries(spec.headers!).map(([name, body]) => [
        name.replaceAll("\\", "/"),
        (body as string).replace(/^#include "(.*)"\n$/, (_, path) => short(path)),
      ]),
    );
    expect(headers["cmakeconfig.h"]).toContain("#define USE_BUN_JSC_ADDITIONS 1\n");
    expect(headers["cmakeconfig.h"]).not.toContain("ENABLE_SHADOW_REALM");
    expect(headers["cmakeconfig.h"]).not.toContain("ENABLE_FFI");
    delete headers["cmakeconfig.h"];
    expect(headers).toEqual({
      "bmalloc/Headers/bmalloc/bmalloc.h": "bmalloc/bmalloc/bmalloc.h",
      "bmalloc/Headers/bmalloc/mimalloc.h": "vendor/mimalloc/include/mimalloc.h",
      "bmalloc/Headers/bmalloc/pas_private.h": "bmalloc/libpas/pas_private.h",
      "JavaScriptCore/Headers/JavaScriptCore/JSBase.h": "JSC/API/JSBase.h",
      "JavaScriptCore/PrivateHeaders/JavaScriptCore/Bytecodes.h": "B/JavaScriptCore/DerivedSources/Bytecodes.h",
      "JavaScriptCore/PrivateHeaders/JavaScriptCore/JSObject.h": "JSC/runtime/JSObject.h",
    });
  });

  test("generators run on the listed inputs, and what configure read reconfigures", () => {
    const { spec, short } = describeBuild({});
    const outputs = spec.steps!.flatMap(s => (s.kind === "exe" ? [s.output] : s.outputs)).map(short);
    expect(outputs).toContain("B/JavaScriptCore/DerivedSources/MapPrototype.lut.h");
    expect(outputs).toContain("B/JavaScriptCore/DerivedSources/LLIntAssembly.h");
    expect(outputs).toContain("B/bin/LLIntOffsetsExtractor");
    const facts = spec.steps!.find((s): s is GenStep => s.kind !== "exe" && s.desc === "AOTRuntimeFactsOfLayouts.def")!;
    expect(facts.outputs.map(short)).toEqual(["B/JavaScriptCore/DerivedSources/aot/AOTRuntimeFactsOfLayouts.def"]);
    expect(facts.inputs.map(short)).toEqual(
      expect.arrayContaining(["JSC/aot/image/generator/runtime-facts.ts", "JSC/aot/ir/AOTValue.cpp"]),
    );
    // bun's own compiles wait for the generated headers, not for the LLInt chain or any object.
    expect(spec.consumerOutputs!.map(short)).toContain("B/JavaScriptCore/DerivedSources/Bytecodes.h");
    expect(spec.consumerOutputs!.map(short)).not.toContain("B/JavaScriptCore/DerivedSources/LLIntAssembly.h");
    expect(spec.configureInputs!.map(short)).toEqual(
      expect.arrayContaining([
        "bmalloc/CMakeLists.txt",
        "WTF/wtf/CMakeLists.txt",
        "WTF/wtf/PlatformJSCOnly.cmake",
        "JSC/CMakeLists.txt",
        "JSC/inspector/remote/Socket.cmake",
        "JSC/Sources.txt",
        "JSC/inspector/remote/SourcesSocket.txt",
        "JSC/ucd",
        "JSC/aot/AOT.cmake",
        "JSC/aot/Sources.txt",
        "JSC/aot",
        "JSC/aot/ir",
        "JSC/b3",
      ]),
    );
  });

  test("what Bun's generators read and write in the checkout comes from its lists", () => {
    using local = checkOut({}, checkout);
    const { cfg, short } = local;
    const engine = webkitEngineSources(cfg);
    expect(short(engine.javaScriptCore!)).toBe("JSC/");
    expect(short(engine.schemaGenerator)).toBe("JSC/aot/ir/generator/index.ts");
    expect(engine.schemaInputs.map(short)).toEqual([
      "JSC/aot/ir/AOTSchema.def",
      "JSC/aot/ir/AOTSchemaFiles.cmake",
      "JSC/aot/ir/generator/index.ts",
    ]);
    expect(short(engine.schemaGeneratedDirectory!)).toBe("B/JavaScriptCore/DerivedSources/aot");
    expect(engine.schemaOutputs.map(short)).toEqual([
      "B/JavaScriptCore/DerivedSources/aot/AOTWire.h",
      "B/JavaScriptCore/DerivedSources/aot/AOTSchemaEnumNames.cpp",
    ]);
    expect(engine.builtinTableInputs.map(short)).toEqual(
      expect.arrayContaining([
        "JSC/aot/builtins/array.builtins.ts",
        "JSC/builtins/MapPrototype.js",
        "JSC/CMakeLists.txt",
        "JSC/aot/builtins/generator/engine.ts",
      ]),
    );
    expect(engine.builtinTableOutputs.map(short)).toEqual(
      expect.arrayContaining([
        "B/JavaScriptCore/DerivedSources/aot/AOTBuiltinIDs.h",
        "B/JavaScriptCore/DerivedSources/aot/AOTBuiltinTableEngineBindings.cpp",
        "B/JavaScriptCore/DerivedSources/aot/AOTBuiltinEngineDeclarations.json",
      ]),
    );
  });

  test("--shadow-realm=off compiles the checkout with ENABLE_SHADOW_REALM=0", () => {
    const { spec } = describeBuild({ asan: false, shadowRealm: false });
    expect(spec.headers!["cmakeconfig.h"]).toContain("#define ENABLE_SHADOW_REALM 0\n");
  });

  test("--ffi=off compiles the checkout with ENABLE_FFI=0", () => {
    const { spec } = describeBuild({ asan: false, ffi: false });
    expect(spec.headers!["cmakeconfig.h"]).toContain("#define ENABLE_FFI 0\n");
  });

  test("a checkout without the AoT compiler says so", () => {
    expect(configureError(checkoutWith({ "aot/AOT.cmake": undefined }))).toEqual({
      message: "this WebKit checkout has no aot/AOT.cmake",
      hint: "Bun needs a checkout whose JavaScriptCore has the AoT compiler: update $BUN_WEBKIT_PATH or vendor/WebKit",
    });
  });

  describe("the lists of aot/ are those of the tree as it is", () => {
    const hint = "bun scripts/build/aot-source-lists.ts writes the lists of aot/ for the tree as it is";
    const cases: Array<[name: string, changes: Record<string, string | undefined>, message: string]> = [
      ["a file in no list", { "aot/flow/AOTFlowGraph.cpp": "" }, "aot/flow/AOTFlowGraph.cpp: not in aot/Sources.txt"],
      [
        "a test's file in no list",
        { "aot/tests/AOTMoreTests.cpp": "" },
        "aot/tests/AOTMoreTests.cpp: not in JavaScriptCore_AOT_TEST_SOURCES",
      ],
      [
        "a listed file that does not exist",
        { "aot/tests/AOTShell.cpp": undefined },
        "aot/tests/AOTShell.cpp: listed, and there is no such file",
      ],
      [
        "a path in a list where it does not belong",
        { "aot/Sources.txt": "aot/ir/AOTValue.cpp\naot/tests/testaot.cpp\n" },
        "aot/tests/testaot.cpp: in aot/Sources.txt, and does not belong there",
      ],
      [
        "a line with more than a path",
        { "aot/Sources.txt": "aot/ir/AOTValue.cpp @no-unify\n" },
        "aot/ir/AOTValue.cpp @no-unify: in aot/Sources.txt, and does not belong there\naot/ir/AOTValue.cpp: not in aot/Sources.txt",
      ],
      [
        "lines out of order",
        {
          "aot/ir/AOTType.cpp": "",
          "aot/Sources.txt": "aot/ir/AOTValue.cpp\naot/ir/AOTType.cpp\n",
        },
        "aot/Sources.txt: not in ascending order",
      ],
      [
        "a line twice",
        { "aot/Sources.txt": "aot/ir/AOTValue.cpp\naot/ir/AOTValue.cpp\n" },
        "aot/Sources.txt: an entry is listed more than once",
      ],
      [
        "a source compiled for size that does not exist",
        { "aot/ir/AOTVerifier.cpp": undefined },
        "aot/ir/AOTVerifier.cpp: listed, and there is no such file",
      ],
      [
        "sources compiled for size out of order",
        {
          "aot/ir/AOTPrinter.cpp": "",
          "aot/SourcesCompiledForSize.txt": "aot/ir/AOTVerifier.cpp\naot/ir/AOTPrinter.cpp\n",
        },
        "aot/SourcesCompiledForSize.txt: not in ascending order",
      ],
      [
        "a folder of headers that is no include directory",
        { "aot/flow/AOTFlowGraph.h": "" },
        "aot/flow: not in JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES",
      ],
    ];
    test.each(cases)("%s", (_name, changes, message) => {
      expect(configureError(checkoutWith(changes))).toEqual({ message, hint });
    });

    test("every problem is reported, one per line, sorted", () => {
      const files = checkoutWith({
        "aot/flow/AOTFlowGraph.cpp": "",
        "aot/analysis/AOTCFG.cpp": "",
        "aot/ir/AOTValue.cpp": undefined,
      });
      expect(configureError(files).message.split("\n")).toEqual([
        "aot/analysis/AOTCFG.cpp: not in aot/Sources.txt",
        "aot/flow/AOTFlowGraph.cpp: not in aot/Sources.txt",
        "aot/ir/AOTValue.cpp: in aot/Sources.txt, and does not belong there",
      ]);
    });
  });

  test("the programs beside a local build", () => {
    using local = checkOut({}, checkout);
    const { cfg, short } = local;
    const programs = jscPrograms(cfg);
    // Each defines what mimalloc calls when memory runs out, which Bun's run time defines for Bun.
    const isOutOfMemoryHook = (source: string) => source.endsWith("OutOfMemory.cpp");
    for (const { name, sources } of programs) {
      expect(sources.filter(isOutOfMemoryHook).map(short)).toEqual([`B/programs/${name}/OutOfMemory.cpp`]);
    }
    expect(programs.map(p => [p.name, p.sources.filter(source => !isOutOfMemoryHook(source)).map(short)])).toEqual([
      [
        "jsc",
        [
          "JSC/jsc.cpp",
          "JSC/tools/JSDollarVMShell.cpp",
          "B/programs/jsc/AOTShell.cpp",
          "B/programs/jsc/AOTNoFeatureRemoved.cpp",
        ],
      ],
      ["testFFI", ["JSC/ffi/tests/testFFI.cpp", "B/programs/testFFI/AOTNoFeatureRemoved.cpp"]],
      // Every b3/testb3_*.cpp.
      ["testb3", ["JSC/b3/testb3_1.cpp", "JSC/b3/testb3_bun_loops.cpp", "B/programs/testb3/AOTNoFeatureRemoved.cpp"]],
      ["testair", ["JSC/b3/air/testair.cpp", "B/programs/testair/AOTNoFeatureRemoved.cpp"]],
      ["testmasm", ["JSC/assembler/testmasm.cpp", "B/programs/testmasm/AOTNoFeatureRemoved.cpp"]],
      ["testRegExp", ["JSC/testRegExp.cpp", "B/programs/testRegExp/AOTNoFeatureRemoved.cpp"]],
      // Its own sources define what AOTNoFeatureRemoved.cpp defines for the others.
      ["testaot", ["JSC/aot/tests/testaot.cpp"]],
    ]);

    // A source of several programs is a stub in each that forwards to it.
    const forwarded = programs
      .flatMap(p => p.sources)
      .filter(source => short(source).startsWith("B/") && !isOutOfMemoryHook(source))
      .map(stub => readFileSync(stub, "utf8").replace(/^#include "(.*)"\n$/, (_, path) => short(path)));
    expect([...new Set(forwarded)]).toEqual(["JSC/aot/tests/AOTShell.cpp", "JSC/aot/runtime/AOTNoFeatureRemoved.cpp"]);

    // So bun.ts can compile each program's sources with that program's flags: no object has two edges.
    const n = new Ninja({ buildDir: cfg.buildDir });
    registerAllRules(n, cfg);
    for (const program of programs) {
      expect(program.cxxflags).toContain(`-DBUILDING_${program.name}`);
      for (const source of program.sources) cxx(n, cfg, source, { flags: program.cxxflags });
    }
  });
});

describe("DirectBuild groups and steps", () => {
  // build.ninja spells paths with the host's separator; the expectations are written with `/`.
  test.skipIf(isWindows)("become compile, generator and link edges ordered by the files they name", () => {
    using dir = tempDir("build-direct-groups", {
      "src/a.cpp": "",
      "src/b.c": "",
      "src/tool.cpp": "",
      "src/prefix.h": "",
    });
    const root = String(dir);
    const buildDir = join(root, "build");
    const cfg = linux({ buildDir, asan: false, localDeps: `zstd=${join(root, "src")}` });
    const out = join(buildDir, "deps", "zstd");
    const dep: Dependency = {
      name: "zstd",
      source: () => ({ kind: "github-archive", repo: "x/y", commit: "0" }),
      build: () => ({
        kind: "direct",
        sources: [],
        groups: [
          {
            name: "lib",
            sources: ["a.cpp", { path: "b.c", lang: "cxx" }],
            includes: ["."],
            cflags: ["-DLIB"],
            cxxflags: ["-std=c++23"],
            pch: "prefix.h",
            orderOnly: [join(out, "gen.h")],
          },
          { name: "tool-obj", sources: ["tool.cpp"], link: false },
        ],
        steps: [
          { kind: "exe", output: join(out, "bin", "tool"), objectsFrom: ["tool-obj"] },
          {
            outputs: [join(out, "gen.h")],
            inputs: [join(out, "bin", "tool")],
            cmd: ["ruby", "gen.rb"],
            cwd: out,
            env: { K: "V" },
            stdout: true,
            desc: "gen.h",
          },
        ],
        consumerOutputs: [join(out, "gen.h")],
        libs: ["/outside/libicu.a"],
      }),
      provides: () => ({ libs: [], includes: [] }),
    };
    const n = new Ninja({ buildDir });
    registerAllRules(n, cfg);
    const resolved = resolveDep(n, cfg, dep, new Map<DepName, ResolvedDep>())!;
    const rel = (p: string) => relative(buildDir, p);

    // The tool's object is not bun's; the generated header is order-only for consumers.
    expect(resolved.objects.map(rel)).toEqual(["obj/vendor/zstd/a.cpp.o", "obj/vendor/zstd/b.c.o"]);
    expect(resolved.libs).toEqual(["/outside/libicu.a"]);
    expect(resolved.generatedHeaders.map(rel)).toEqual(["deps/zstd/gen.h"]);
    expect(resolved.outputs).toEqual([]);

    const lines = n
      .toString()
      .replace(/ \$\n +/g, " ")
      .split("\n");
    /** The build statement of `output`, absolute-path aliases dropped, with its variables. */
    const edge = (output: string) => {
      const at = lines.findIndex(l => l.startsWith(`build ${output}`));
      const vars: string[] = [];
      for (let i = at + 1; lines[i]?.startsWith("  "); i++) vars.push(lines[i]!.trim());
      return { line: lines[at]!.replace(/ \| \S+(?=: )/, ""), vars: vars.join("\n") };
    };
    expect(edge("deps/zstd/gen.h").line).toBe("build deps/zstd/gen.h: dep_gen deps/zstd/bin/tool");
    expect(edge("deps/zstd/gen.h").vars).toContain(`opts = --cwd=${out} --env=K=V --stdout=${join(out, "gen.h")}`);
    expect(edge("deps/zstd/gen.h").vars).toContain("cmd = ruby gen.rb");
    expect(edge("deps/zstd/bin/tool").line).toStartWith("build deps/zstd/bin/tool: link obj/vendor/zstd/tool.cpp.o |");
    expect(edge("deps/zstd/.lib-ready").line).toBe("build deps/zstd/.lib-ready: phony deps/zstd/gen.h");
    expect(edge("pch/prefix.h.hxx.pch").line).toEndWith("|| pch/.dir deps/zstd/.lib-ready");
    expect(edge("obj/vendor/zstd/a.cpp.o").line).toContain(": cxx_pch ");
    expect(edge("obj/vendor/zstd/a.cpp.o").line).toEndWith("|| obj/.dir deps/zstd/.lib-ready");
    expect(edge("obj/vendor/zstd/a.cpp.o").vars).toContain("-DLIB -std=c++23");
    expect(edge("obj/vendor/zstd/b.c.o").vars).toStartWith("cflags = -x c++ ");
    expect(edge("lib").line).toBe("build lib: phony obj/vendor/zstd/a.cpp.o obj/vendor/zstd/b.c.o");
  });
});

describe("Provides.files", () => {
  function graph() {
    const dir = tempDir("build-provides-files", {});
    const cfg = linux({ buildDir: join(String(dir), "build") });
    const n = new Ninja({ buildDir: cfg.buildDir });
    registerAllRules(n, cfg);
    return { cfg, n, [Symbol.dispose]: () => dir[Symbol.dispose]() };
  }

  test("are outputs of the prebuilt's fetch, and no compile waits for them", () => {
    using g = graph();
    const resolved = resolveDep(g.n, g.cfg, webkit, new Map<DepName, ResolvedDep>())!;
    const fetch = readManifest(g.n.toString()).edges.find(edge => edge.rule === "dep_fetch_prebuilt")!;
    expect(fetch.implicitOutputs).toContain(webkitAotFile(g.cfg, "AOTSchema.def"));
    expect(fetch.implicitOutputs).toContain(
      join(webkitAotFile(g.cfg, "builtins-generated"), "AOTBuiltinEngineDeclarations.json"),
    );
    expect(resolved.libs.length).toBeGreaterThan(0);
    expect(resolved.outputs).toEqual(resolved.libs);
  });

  test("are only for a prebuilt source", () => {
    using g = graph();
    const dep: Dependency = {
      name: "zstd",
      source: () => ({ kind: "github-archive", repo: "x/y", commit: "0" }),
      build: () => ({ kind: "direct", sources: [] }),
      provides: () => ({ libs: [], includes: [], files: ["COPYING"] }),
    };
    expect(() => resolveDep(g.n, g.cfg, dep, new Map<DepName, ResolvedDep>())).toThrow(
      "zstd: Provides.files is for a prebuilt source",
    );
  });
});
