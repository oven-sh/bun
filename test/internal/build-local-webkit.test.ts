/**
 * `--webkit=local` (scripts/build/deps/webkit.ts): a WebKit checkout compiled in bun's own ninja graph, described from
 * the checkout's own file lists. CI links the prebuilt WebKit, so nothing else exercises this. Configure-time only: no
 * compiler or ninja runs, and the "checkout" is a few files with the shape of WebKit's.
 */
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { join, relative } from "node:path";

import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { jscPrograms, webkit } from "../../scripts/build/deps/webkit.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { getProfile } from "../../scripts/build/profiles.ts";
import { registerAllRules } from "../../scripts/build/rules.ts";
import {
  depSource,
  resolveDep,
  type Dependency,
  type DepName,
  type DirectBuild,
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
    expect(jscPrograms(linux({}))).toEqual([]);
  });

  test("--webkit=local is a --local-deps entry: $BUN_WEBKIT_PATH, else vendor/WebKit", () => {
    const saved = process.env.BUN_WEBKIT_PATH;
    try {
      process.env.BUN_WEBKIT_PATH = join("/somewhere", "WebKit");
      expect(linux({ webkit: "local" }).localDeps.WebKit).toBe(join("/somewhere", "WebKit"));
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
    expect(cfg.localDeps.WebKit).toBe(join("/elsewhere", "WebKit"));
  });

  test("a missing checkout says where it looked", () => {
    expect(() => webkit.build(linux({ localDeps: "WebKit=/nowhere/WebKit" }))).toThrow(
      /local WebKit checkout not found at .nowhere.WebKit/,
    );
  });

  test.skipIf(process.platform === "darwin")("macOS and Windows targets need their own host", () => {
    expect(() =>
      resolveConfig({ os: "darwin", arch: "aarch64", webkit: "local", macosSdk: "/fake/sdk" }, mockToolchain()),
    ).toThrow(/Cross-compiling for macOS requires the prebuilt WebKit/);
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
            (alone if "@no-unify" in parts else bundled).append(parts[0])
bundle = os.path.join(out, "UnifiedSource-1.cpp")
open(bundle, "w").write("".join('#include "%s"\\n' % s for s in bundled))
sys.stdout.write(";".join([bundle] + alone) + ";")
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
    WEBKIT_INCLUDE_CONFIG_FILES_IF_EXISTS()`,
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
};

const python = isWindows ? "python" : "python3";

describe.skipIf(Bun.which(python) === null)("the graph of a checkout", () => {
  /** webkit.build() for a target, with every path under the checkout, the build dir or vendor/ spelled relative to it. */
  function describeBuild(partial: PartialConfig) {
    using dir = tempDir("build-local-webkit", checkout);
    const root = String(dir);
    const cfg = linux({ localDeps: `WebKit=${root}`, buildDir: join(root, "build"), ...partial });
    const spec = webkit.build(cfg) as DirectBuild;
    const short = (p: string) => {
      for (const [name, base] of [
        ["B", join(cfg.buildDir, "deps", "WebKit")],
        ["JSC", join(root, "Source", "JavaScriptCore")],
        ["WTF", join(root, "Source", "WTF")],
        ["bmalloc", join(root, "Source", "bmalloc")],
        ["vendor", cfg.vendorDir],
      ] as const) {
        if (p.startsWith(base)) return `${name}/${relative(base, p).replaceAll("\\", "/")}`;
      }
      return p;
    };
    const group = (name: string) => {
      const g = spec.groups!.find(g => g.name === name)!;
      return {
        sources: g.sources.map(s => short(typeof s === "string" ? s : s.path)),
        includes: g.includes!.map(short),
      };
    };
    return { cfg, spec, short, group };
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
      "B/JavaScriptCore/DerivedSources/JSCBuiltins.cpp",
      "JSC/inspector/remote/socket/posix/RemoteInspectorSocketPOSIX.cpp",
      "JSC/llint/LowLevelInterpreter.cpp",
    ]);
    expect(group("JavaScriptCore").includes).toEqual([
      "B/JavaScriptCore/Headers",
      "JSC/runtime",
      "B/JavaScriptCore/DerivedSources",
      "WTF/",
      "B/bmalloc/Headers",
      "B/bmalloc/Headers/bmalloc",
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
      ]),
    );
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
