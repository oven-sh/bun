/**
 * The link's lazy group (scripts/build/compile.ts `link()`'s `lazyObjects`, scripts/build/bun.ts `lazyDepObjects`).
 *
 * A dependency is a library: the link takes the translation units something references and no others. The build
 * says that without archives, by handing the linker the dependency objects between `--start-lib` and `--end-lib` in
 * a response file of its own. These check what the link edge and that file say; no compiler or ninja runs.
 *
 * packages/h3blast, the HTTP/3 load generator, is a second program linked from those objects (scripts/build/bun.ts
 * `emitH3blast`), compiled with the flags that compiled them. Its Makefile linked them by hand and broke each time
 * the build changed how it compiles them (LTO bitcode, no PIE, ASan, the functions BoringSSL expects bun's runtime to
 * define). No test or CI lane links the program; these check what the graph says about it.
 */
import { describe, expect, test } from "bun:test";
import { isMacOS, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { emitH3blast, lazyDepObjects } from "../../scripts/build/bun.ts";
import { link, registerCompileRules } from "../../scripts/build/compile.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { boringssl, boringsslEmbedderHooks } from "../../scripts/build/deps/boringssl.ts";
import { lshpack } from "../../scripts/build/deps/lshpack.ts";
import { lsqpack } from "../../scripts/build/deps/lsqpack.ts";
import { lsquic } from "../../scripts/build/deps/lsquic.ts";
import { zlib } from "../../scripts/build/deps/zlib.ts";
import { computeDepFlags, computeTargetLinkFlags } from "../../scripts/build/flags.ts";
import { Ninja, readManifest } from "../../scripts/build/ninja.ts";
import type { Dependency, DepName, DirectBuild, ResolvedDep } from "../../scripts/build/source.ts";

type Target = Pick<Config, "windows" | "darwin" | "crossTarget" | "exeSuffix">;
const linux: Target = { windows: false, darwin: false, crossTarget: undefined, exeSuffix: "" };
const windows: Target = { windows: true, darwin: false, crossTarget: undefined, exeSuffix: ".exe" };
const macosNative: Target = { windows: false, darwin: true, crossTarget: undefined, exeSuffix: "" };
const macosCross: Target = { ...macosNative, crossTarget: "arm64-apple-macosx13.0" };

/** The link edge `link()` emits for `target`, and the group file it wrote (undefined when there is none). */
function emitLink(target: Target, buildDir: string) {
  const cfg = { buildDir, cwd: buildDir, host: { os: "linux" }, cxx: "/fake/clang++", ld: "/fake/ld.lld", ...target };
  const n = new Ninja({ buildDir });
  n.rule("link", { command: "clang++ @$out.rsp $lazy $ldflags -o $out" });
  n.rule("mkdir_stamp", { command: "mkdir -p $dir && touch $out" });
  link(n, cfg as Config, "bun", ["obj/bun.o"], {
    libs: [join(buildDir, "cache", "libWTF.a")],
    lazyObjects: [join(buildDir, "obj", "dep", "used.o"), join(buildDir, "obj", "dep", "unused.o")],
    flags: [],
  });
  const lines = n
    .toString()
    .replace(/ \$\n +/g, " ")
    .split("\n");
  const at = lines.findIndex(l => l.startsWith("build ") && l.includes(": link "));
  const [explicit, implicit = ""] = lines[at]!.slice(lines[at]!.indexOf(": link ") + 7)
    .split(" || ")[0]!
    .split(" | ");
  const groupFile = join(buildDir, `bun${target.exeSuffix}.lazy.rsp`);
  let group: string | undefined;
  try {
    group = readFileSync(groupFile, "utf8");
  } catch {}
  return {
    explicit: explicit!.split(" "),
    implicit: implicit.split(" "),
    lazy:
      lines
        .slice(at + 1)
        .find(l => l.startsWith("  lazy = "))
        ?.slice("  lazy = ".length) ?? "",
    group,
  };
}

describe.each([
  ["ELF", linux],
  ["a cross-linked macOS target", macosCross],
])("an lld link (%s)", (_, target) => {
  // build.ninja spells paths with the host's separator; the expectations in this file are written with `/`.
  test.skipIf(isWindows)("takes the lazy objects as a --start-lib group in a response file of its own", () => {
    using dir = tempDir("build-link-lazy", {});
    const edge = emitLink(target, String(dir));
    // Not in $in: `@$out.rsp` would hand them to the linker as plain objects.
    expect(edge.explicit).toEqual(["obj/bun.o", "cache/libWTF.a"]);
    // Still inputs of the edge, with the group file: a member added or dropped changes only that file.
    expect(edge.implicit).toEqual(expect.arrayContaining(["bun.lazy.rsp", "obj/dep/used.o", "obj/dep/unused.o"]));
    expect(edge.lazy).toBe("-Wl,@bun.lazy.rsp");
    expect(edge.group).toBe("--start-lib\nobj/dep/used.o\nobj/dep/unused.o\n--end-lib\n");
  });
});

test.skipIf(isWindows)("lld-link gets the group through clang-cl as a linker input", () => {
  using dir = tempDir("build-link-lazy", {});
  const edge = emitLink(windows, String(dir));
  expect(edge.explicit).toEqual(["obj/bun.o", "cache/libWTF.a"]);
  expect(edge.lazy).toBe("/clang:-Wl,@bun.exe.lazy.rsp");
  expect(edge.group).toBe("/start-lib\nobj/dep/used.o\nobj/dep/unused.o\n/end-lib\n");
});

test.skipIf(isWindows)("Apple's ld has no such group: a native macOS link takes them as plain objects", () => {
  using dir = tempDir("build-link-lazy", {});
  const edge = emitLink(macosNative, String(dir));
  expect(edge.explicit).toEqual(["obj/bun.o", "obj/dep/used.o", "obj/dep/unused.o", "cache/libWTF.a"]);
  expect(edge.lazy).toBe("");
  expect(edge.group).toBeUndefined();
});

test("on Windows only assembler outputs are lazy; elsewhere every dependency object is", () => {
  const objects = ["obj/vendor/zlib/adler32.c.obj", "obj/vendor/boringssl/aesni-gcm-x86_64-win.asm.obj", "obj/x.S.obj"];
  expect(lazyDepObjects({ windows: true } as Config, objects)).toEqual({
    eager: ["obj/vendor/zlib/adler32.c.obj"],
    lazy: ["obj/vendor/boringssl/aesni-gcm-x86_64-win.asm.obj", "obj/x.S.obj"],
  });
  expect(lazyDepObjects({ windows: false } as Config, objects)).toEqual({ eager: [], lazy: objects });
});

// ───────────────────────────────────────────────────────────────────────────
// packages/h3blast
// ───────────────────────────────────────────────────────────────────────────

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

/** A Linux glibc x64 release target; linuxSysroot is a stub, so that resolveConfig accepts it on every host. */
const linuxConfig = (partial: PartialConfig, buildDir: string): Config =>
  resolveConfig(
    { os: "linux", arch: "x64", abi: "gnu", buildType: "Release", buildDir, linuxSysroot: buildDir, ...partial },
    mockToolchain(),
  );

/**
 * The dependencies the program links, each with stand-ins for the objects its own edges build, and zlib, which the
 * program leaves out: lsquic names zlib only in the gQUIC sources that bun does not compile.
 */
const dependencies: Array<{ dep: Dependency; objects: string[]; linked: boolean }> = [
  { dep: lsquic, objects: ["lsquic_engine.c.o", "lsqpack.c.o"], linked: true },
  { dep: lsqpack, objects: [], linked: true },
  { dep: lshpack, objects: ["lshpack.c.o"], linked: true },
  { dep: boringssl, objects: ["ssl_lib.cc.o", "chacha-x86_64-linux.S.o"], linked: true },
  { dep: zlib, objects: ["inflate.c.o"], linked: false },
];

/** What resolveDep() gives for a dependency: its objects, or with --archive-deps the archive of them. */
function resolved(cfg: Config, { dep, objects }: (typeof dependencies)[number]): ResolvedDep {
  const srcDir = join(cfg.vendorDir, dep.name);
  const provides = dep.provides(cfg);
  const built = (cfg.archiveDeps && objects.length > 0 ? [`lib${dep.name}.a`] : objects).map(file =>
    join(cfg.buildDir, "obj", "vendor", dep.name, file),
  );
  return {
    name: dep.name,
    libs: cfg.archiveDeps ? built : [],
    objects: cfg.archiveDeps ? [] : built,
    includes: provides.includes.map(include => resolve(srcDir, include)),
    defines: provides.defines ?? [],
    sources: [],
    outputs: [join(srcDir, ".ref")],
    generatedHeaders: [],
    configureInputs: [],
    checks: [],
  };
}

/** The edges emitH3blast() writes for `cfg`: the two compiles and the link. */
function emitProgram(cfg: Config) {
  const n = new Ninja({ buildDir: cfg.buildDir });
  registerCompileRules(n, cfg);
  const deps = new Map<DepName, ResolvedDep>(dependencies.map(entry => [entry.dep.name, resolved(cfg, entry)]));
  const exe = emitH3blast(n, cfg, deps);
  if (exe === undefined) throw new Error("no h3blast for this target");
  const edges = readManifest(n.toString()).edges;
  const edgeOf = (output: string) => {
    const edge = edges.find(edge => edge.outputs.includes(output));
    if (edge === undefined) throw new Error(`no edge writes ${output}`);
    return edge;
  };
  const compileOf = (source: string) => {
    const edge = edgeOf(`obj/packages/h3blast/src/${source}.o`);
    const flags = edge.bindings.cflags!.split(" ");
    return { edge, flags, defines: flags.filter(flag => flag.startsWith("-D")).map(flag => flag.slice(2)) };
  };
  let group: string[] | undefined;
  try {
    group = readFileSync(join(cfg.buildDir, "h3blast.lazy.rsp"), "utf8").trimEnd().split("\n");
  } catch {}
  return {
    exe,
    link: edgeOf("h3blast"),
    program: compileOf("h3blast.c"),
    hooks: compileOf("boringssl_hooks.c"),
    group,
    /** What the dependencies it links built, as build.ninja names it. */
    linked: dependencies
      .filter(entry => entry.linked)
      .flatMap(entry => [...deps.get(entry.dep.name)!.objects, ...deps.get(entry.dep.name)!.libs])
      .map(file => relative(cfg.buildDir, file)),
    /** The `.ref` of each dependency it links: the stamp that its sources are there. */
    stamps: dependencies
      .filter(entry => entry.linked)
      .map(entry => relative(cfg.buildDir, join(cfg.vendorDir, entry.dep.name, ".ref"))),
  };
}

const memoryHooks = "BORINGSSL_REQUIRE_MEMORY_HOOKS";
const pemHooks = "BORINGSSL_PEM_FAST_PUBLIC_BASE64";
const isHookDefine = (define: string) => define.startsWith("BORINGSSL_");

// build.ninja spells paths with the host's separator; the expectations in this file are written with `/`.
describe.skipIf(isWindows)("h3blast in the build graph", () => {
  // What decides whether the link works, for each way a Linux tree is built. The Makefile had none of it:
  // `cc` could not read the LTO bitcode, linked a PIE from objects that are not position independent, and left out
  // the ASan runtime.
  const trees: Array<{
    name: string;
    partial: PartialConfig;
    compileFlags: string[];
    linkFlags: string[];
    neverFlags: string[];
    hooks: string[];
  }> = [
    {
      name: "release",
      partial: {},
      compileFlags: ["-flto=thin", "-fno-pie"],
      linkFlags: ["-Wl,-no-pie"],
      neverFlags: ["-fsanitize=address", "-fPIE", "-pie"],
      hooks: [memoryHooks, pemHooks],
    },
    {
      name: "release --lto=off",
      partial: { lto: false },
      compileFlags: ["-fno-pie"],
      linkFlags: ["-Wl,-no-pie"],
      neverFlags: ["-flto=thin", "-fsanitize=address", "-fPIE", "-pie"],
      hooks: [memoryHooks, pemHooks],
    },
    {
      name: "debug (ASan)",
      partial: { buildType: "Debug" },
      compileFlags: ["-fsanitize=address", "-fno-pie"],
      linkFlags: ["-fsanitize=address", "-Wl,-no-pie"],
      neverFlags: ["-flto=thin", "-fPIE", "-pie"],
      // BoringSSL keeps its own allocator under ASan, so only the PEM functions are left to the embedder.
      hooks: [pemHooks],
    },
    {
      name: "release --hardened=on",
      partial: { hardened: true },
      compileFlags: ["-flto=thin", "-fPIE"],
      linkFlags: ["-fPIE", "-pie"],
      neverFlags: ["-fsanitize=address", "-fno-pie", "-Wl,-no-pie"],
      hooks: [memoryHooks, pemHooks],
    },
    {
      name: "release for aarch64",
      partial: { arch: "aarch64" },
      compileFlags: ["--target=aarch64-linux-gnu", "-flto=thin", "-fno-pie"],
      linkFlags: ["--target=aarch64-linux-gnu", "-Wl,-no-pie"],
      neverFlags: ["-fsanitize=address", "-fPIE", "-pie"],
      hooks: [memoryHooks, pemHooks],
    },
  ];

  describe.each(trees)("a $name tree", ({ partial, compileFlags, linkFlags, neverFlags, hooks }) => {
    test("compiles it the way its dependencies are compiled", () => {
      using dir = tempDir("build-h3blast", {});
      const cfg = linuxConfig(partial, String(dir));
      const emitted = emitProgram(cfg);
      for (const { flags, defines } of [emitted.program, emitted.hooks]) {
        expect(flags).toEqual(expect.arrayContaining([...computeDepFlags(cfg).cflags, ...compileFlags]));
        expect(flags.filter(flag => neverFlags.includes(flag))).toEqual([]);
        // lsquic's and BoringSSL's headers, and the width that lsxpack_header.h has in the objects it links.
        expect(flags).toEqual(
          expect.arrayContaining([
            `-I${join(cfg.vendorDir, "lsquic", "include")}`,
            `-I${join(cfg.vendorDir, "boringssl", "include")}`,
          ]),
        );
        expect(defines).toContain("LSXPACK_MAX_STRLEN=4294967295");
      }
    });

    test("links it with the pinned lld and the flags of the toolchain", () => {
      using dir = tempDir("build-h3blast", {});
      const cfg = linuxConfig(partial, String(dir));
      const emitted = emitProgram(cfg);
      expect(emitted.exe).toBe(join(cfg.buildDir, "h3blast"));
      expect(emitted.link.rule).toBe("link");
      const flags = emitted.link.bindings.ldflags!.split(" ");
      expect(flags).toEqual(
        expect.arrayContaining([...computeTargetLinkFlags(cfg), "--ld-path=/fake/llvm/bin/ld.lld", ...linkFlags]),
      );
      expect(flags.filter(flag => neverFlags.includes(flag))).toEqual([]);
      // Its worker threads: before glibc 2.34, pthread_create is in a library of its own.
      expect(flags).toContain("-lpthread");
    });

    test("defines the functions that this tree's BoringSSL leaves to its embedder, and no others", () => {
      using dir = tempDir("build-h3blast", {});
      const cfg = linuxConfig(partial, String(dir));
      const emitted = emitProgram(cfg);
      expect(Object.keys(boringsslEmbedderHooks(cfg))).toEqual(hooks);
      // What BoringSSL's own objects are compiled with.
      expect(Object.keys((boringssl.build(cfg) as DirectBuild).defines ?? {}).filter(isHookDefine)).toEqual(
        expect.arrayContaining(hooks),
      );
      expect(emitted.hooks.defines.filter(isHookDefine)).toEqual(hooks);
      expect(emitted.program.defines.filter(isHookDefine)).toEqual([]);
    });
  });

  test("links the objects of the dependencies it is written against, each only if something refers to it", () => {
    using dir = tempDir("build-h3blast", {});
    const emitted = emitProgram(linuxConfig({}, String(dir)));
    expect(emitted.link.inputs).toEqual([
      "obj/packages/h3blast/src/h3blast.c.o",
      "obj/packages/h3blast/src/boringssl_hooks.c.o",
    ]);
    expect(emitted.link.bindings.lazy).toBe("-Wl,@h3blast.lazy.rsp");
    expect(emitted.linked).toEqual(expect.arrayContaining(["obj/vendor/lsquic/lsquic_engine.c.o"]));
    expect(emitted.linked).not.toContain("obj/vendor/zlib/inflate.c.o");
    expect(emitted.group).toEqual(["--start-lib", ...emitted.linked, "--end-lib"]);
    // Inputs of the edge all the same: a dependency that is rebuilt relinks it.
    expect(emitted.link.implicitInputs).toEqual(expect.arrayContaining(["h3blast.lazy.rsp", ...emitted.linked]));
  });

  test("with --archive-deps it links their archives", () => {
    using dir = tempDir("build-h3blast", {});
    const emitted = emitProgram(linuxConfig({ archiveDeps: true }, String(dir)));
    expect(emitted.linked).toEqual(expect.arrayContaining(["obj/vendor/lsquic/liblsquic.a"]));
    expect(emitted.link.inputs).toEqual([
      "obj/packages/h3blast/src/h3blast.c.o",
      "obj/packages/h3blast/src/boringssl_hooks.c.o",
      ...emitted.linked,
    ]);
    expect(emitted.group).toBeUndefined();
  });

  test("waits for the sources of the dependencies whose headers it includes", () => {
    using dir = tempDir("build-h3blast", {});
    const emitted = emitProgram(linuxConfig({}, String(dir)));
    expect(emitted.stamps.length).toBeGreaterThan(0);
    for (const { edge } of [emitted.program, emitted.hooks]) {
      expect(edge.implicitInputs).toEqual(expect.arrayContaining(emitted.stamps));
    }
  });

  test("compiles sources that exist", () => {
    using dir = tempDir("build-h3blast", {});
    const cfg = linuxConfig({}, String(dir));
    const emitted = emitProgram(cfg);
    const sources = [emitted.program, emitted.hooks].flatMap(({ edge }) => edge.inputs);
    expect(sources.map(source => relative(cfg.cwd, resolve(cfg.buildDir, source)))).toEqual([
      "packages/h3blast/src/h3blast.c",
      "packages/h3blast/src/boringssl_hooks.c",
    ]);
    expect(sources.filter(source => !existsSync(resolve(cfg.buildDir, source)))).toEqual([]);
  });

  // It is written for epoll, timerfd and sendmmsg.
  test.each([
    ["FreeBSD", { os: "freebsd", arch: "x64", freebsdSysroot: "/fake/freebsd" }],
    ["Windows", { os: "windows", arch: "x64", winsysroot: "/fake/winsysroot" }],
    // On macOS, resolveConfig({ os: "darwin" }) looks for the real SDK.
    ...(isMacOS ? [] : [["macOS", { os: "darwin", arch: "aarch64" }] as const]),
  ] as Array<[string, PartialConfig]>)("%s has no h3blast", (_name, partial) => {
    using dir = tempDir("build-h3blast", {});
    const buildDir = String(dir);
    const cfg = resolveConfig({ buildType: "Release", buildDir, ...partial }, mockToolchain());
    const n = new Ninja({ buildDir });
    expect(emitH3blast(n, cfg, new Map())).toBeUndefined();
    expect(n.toString()).not.toContain("h3blast");
  });

  test("Android has no h3blast", () => {
    using dir = tempDir("build-h3blast", {});
    const buildDir = String(dir);
    // resolveConfig needs the NDK for this target; the graph only asks what the target is.
    const cfg: Config = { ...linuxConfig({}, buildDir), abi: "android" };
    const n = new Ninja({ buildDir });
    expect(emitH3blast(n, cfg, new Map())).toBeUndefined();
    expect(n.toString()).not.toContain("h3blast");
  });
});

test("boringssl_hooks.c has one block for each define that leaves functions to BoringSSL's embedder", () => {
  const source = readFileSync(join(import.meta.dir, "../../packages/h3blast/src/boringssl_hooks.c"), "utf8");
  const blocks = Array.from(source.matchAll(/^#if defined\((\w+)\)$/gm), match => match[1]!);
  // Every define of any tree: a new one needs its functions defined in that file.
  const defines = new Set([false, true].flatMap(asan => Object.keys(boringsslEmbedderHooks({ asan }))));
  expect(blocks.toSorted()).toEqual([...defines].toSorted());
});
