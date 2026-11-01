/**
 * UBSan in scripts/build/flags.ts: which builds compile Bun's own sources with it, what each link names for it, and what
 * Bun's table of built-ins is compiled with. JavaScriptCore's own programs (jsc, testaot) link the table's objects and
 * no UBSan runtime. Configure-time only: no compiler or ninja runs.
 */
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { basename, join } from "node:path";

import { emitBuiltinsTable } from "../../scripts/build/aot.ts";
import { extraCxxFlags } from "../../scripts/build/bun.ts";
import type { CodegenOutputs } from "../../scripts/build/codegen.ts";
import { resolveConfig, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";
import { webkitEngineSources } from "../../scripts/build/deps/webkit.ts";
import {
  builtinTableFlags,
  computeDepFlags,
  computeFlags,
  computeTargetLinkFlags,
  usesUbsan,
} from "../../scripts/build/flags.ts";
import { Ninja } from "../../scripts/build/ninja.ts";
import { registerAllRules } from "../../scripts/build/rules.ts";
import type { Sources } from "../../scripts/glob-sources.ts";

const toolchain = {
  cc: "/fake/llvm/bin/clang",
  cxx: "/fake/llvm/bin/clang++",
  clangVersion: "23.1.1",
  clangResourceDir: "/fake/llvm/lib/clang/23",
  ar: "/fake/llvm/bin/llvm-ar",
  ld: "/fake/llvm/bin/ld.lld",
  ld64Lld: "/fake/llvm/bin/ld64.lld",
  rustLlvmVersion: "23.1.1",
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
  cmake: "/fake/bin/cmake",
} as Toolchain;

/** linuxSysroot is a stub, so that resolveConfig accepts the target on every host. */
const linux: PartialConfig = {
  os: "linux",
  arch: "x64",
  abi: "gnu",
  webkit: "local",
  linuxSysroot: "/fake/linux-sysroot",
};

const sanitizers = (flags: string[]): string[] => flags.filter(flag => flag.startsWith("-fsanitize="));

/** Build type and ASAN: whether Bun's own sources get UBSan, and the sanitizer runtimes that ASAN puts on every link. */
const builds: Array<[build: string, partial: PartialConfig, ubsan: boolean, everyLink: string[]]> = [
  ["Debug without ASAN", { buildType: "Debug", asan: false }, true, []],
  ["Debug with ASAN", { buildType: "Debug", asan: true }, true, ["-fsanitize=address"]],
  ["Release with ASAN", { buildType: "Release", asan: true }, true, ["-fsanitize=address"]],
  ["Release", { buildType: "Release", asan: false }, false, []],
];

test.each(builds)("%s: only Bun's own sources and Bun's own link have UBSan", (_build, partial, ubsan, everyLink) => {
  using dir = tempDir("build-ubsan-flags", {});
  const cfg = resolveConfig({ ...linux, buildDir: String(dir), ...partial }, toolchain);
  const own = computeFlags(cfg);
  expect({
    ownSources: own.cxxflags.includes("-fsanitize=null"),
    dependencies: computeDepFlags(cfg).cxxflags.includes("-fsanitize=null"),
    ownLink: sanitizers(own.ldflags),
    // jsc, testaot and JavaScriptCore's other programs.
    otherLinks: sanitizers(computeTargetLinkFlags(cfg)),
  }).toEqual({
    ownSources: ubsan,
    dependencies: false,
    ownLink: ubsan ? [...everyLink, "-fsanitize=null"] : everyLink,
    otherLinks: everyLink,
  });
});

test.each(builds)(
  "%s: a UBSan check in the table of built-ins traps, so its objects need no runtime",
  (_build, partial, ubsan) => {
    using dir = tempDir("build-ubsan-flags", {});
    const cfg = resolveConfig({ ...linux, buildDir: String(dir), ...partial }, toolchain);
    expect(builtinTableFlags(cfg)).toEqual(ubsan ? ["-fsanitize-trap=all"] : []);
  },
);

test("of the C++ that the table's codegen step lists, only the table's sources are compiled that way", () => {
  using dir = tempDir("build-ubsan-flags", {});
  const buildDir = join(String(dir), "build");
  // A prebuilt engine with an empty cache: no WebKit checkout is read.
  const cfg = resolveConfig(
    { ...linux, webkit: "prebuilt", buildType: "Debug", buildDir, cacheDir: join(String(dir), "cache") },
    toolchain,
  );
  const n = new Ninja({ buildDir });
  registerAllRules(n, cfg);
  // The step as emitCodegen() runs it: the groups it fills, and none of the lists it only names as inputs.
  const codegen = {
    all: [],
    rustInputs: [],
    cppSources: [],
    builtinTableSources: [],
    cppHeaders: [],
    rootInstall: join(buildDir, "stamps", "install.stamp"),
  } as Partial<CodegenOutputs> as CodegenOutputs;
  const inputs = {
    builtinsTableCodegen: [],
    bindgen: [],
    js: [],
    jsCodegen: [],
    aotPrelude: [],
    nativeModuleLoadSites: [],
    nativeCallSites: [],
    removableFeatures: [],
  } as Partial<Sources> as Sources;
  emitBuiltinsTable({
    n,
    cfg,
    sources: inputs,
    o: codegen,
    dirStamp: join(cfg.codegenDir, ".dir"),
    engine: webkitEngineSources(cfg),
  });

  expect(codegen.cppSources.map(src => [basename(src), extraCxxFlags(cfg, src, codegen)])).toEqual([
    ["BunAOTHostBindings.cpp", []],
    ["AOTBuiltinTableAttachments.cpp", ["-fsanitize-trap=all"]],
    ["AOTBuiltinTableBuiltins.cpp", ["-fsanitize-trap=all"]],
    ["AOTBuiltinTableNames.cpp", ["-fsanitize-trap=all"]],
    ["AOTBuiltinTableOverloads.cpp", ["-fsanitize-trap=all"]],
    ["AOTBuiltinTableTypes.cpp", ["-fsanitize-trap=all"]],
  ]);
});

test("which targets compile Bun's own sources with UBSan in a debug build", () => {
  const debug = { debug: true, release: false, asan: false };
  const linuxGnu = { unix: true, darwin: false, freebsd: false, abi: "gnu", crossTarget: undefined } as const;
  // An Intel mac has ASAN off by default. A macOS target built on Linux has no UBSan runtime to link.
  const macos = { ...linuxGnu, darwin: true, abi: undefined };
  expect({
    linuxGnu: usesUbsan({ ...linuxGnu, ...debug }),
    macos: usesUbsan({ ...macos, ...debug }),
    macosFromLinux: usesUbsan({ ...macos, ...debug, crossTarget: "x86_64-apple-darwin" }),
    musl: usesUbsan({ ...linuxGnu, ...debug, abi: "musl" }),
    android: usesUbsan({ ...linuxGnu, ...debug, abi: "android" }),
    freebsd: usesUbsan({ ...linuxGnu, ...debug, freebsd: true, abi: undefined }),
    windows: usesUbsan({ ...linuxGnu, ...debug, unix: false, abi: undefined }),
  }).toEqual({
    linuxGnu: true,
    macos: true,
    macosFromLinux: false,
    musl: false,
    android: false,
    freebsd: false,
    windows: false,
  });
});
