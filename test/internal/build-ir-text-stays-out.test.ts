// The AoT compiler's IR is text for tests alone: Bun hands the engine the program as bytes. The check of the link edge
// (scripts/build/verify-binary.ts, "symbols") refuses an executable without assertions that defines a symbol of the engine's lexer,
// parser or printer, or of the front end's printer. This holds the list that it is given.
import { expect, test } from "bun:test";
import { tempDir } from "harness";

import { binaryExpectations } from "../../scripts/build/binary-expectations.ts";
import { resolveConfig, type Config, type PartialConfig, type Toolchain } from "../../scripts/build/config.ts";

const tool = (name: string) => `/fake/llvm/bin/${name}`;
const toolchain: Toolchain = {
  cc: tool("clang"),
  cxx: tool("clang++"),
  hostCc: undefined,
  hostCxx: undefined,
  clangVersion: "23.1.1",
  clangResourceDir: "/fake/llvm/lib/clang/23",
  ar: tool("llvm-ar"),
  ld: tool("ld.lld"),
  ld64Lld: tool("ld64.lld"),
  rustLlvmVersion: "23.1.1",
  rustSysroot: undefined,
  rustHostTriple: undefined,
  strip: "/fake/bin/strip",
  llvmStrip: tool("llvm-strip"),
  nm: tool("llvm-nm"),
  readobj: tool("llvm-readobj"),
  objdump: tool("llvm-objdump"),
  cxxfilt: tool("llvm-cxxfilt"),
  dsymutil: tool("dsymutil"),
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

function config(partial: PartialConfig, buildDir: string): Config {
  const linux = { os: "linux", arch: "x64", abi: "gnu", linuxSysroot: buildDir } as const;
  return resolveConfig({ ...linux, buildType: "Release", webkit: "local", buildDir, ...partial }, toolchain);
}

const matches = (patterns: string[], symbol: string) =>
  patterns.some(pattern => new RegExp(`^${pattern.replaceAll("*", ".*")}$`).test(symbol));

test("a release build may define no symbol of IR text", () => {
  using dir = tempDir("build-ir-text-stays-out", {});
  const forbidden = binaryExpectations(config({}, String(dir))).forbiddenSymbols!;
  for (const symbol of [
    "_ZN3JSC3AOT5Typed5Lexer4nextEv",
    "_ZN3JSC3AOT5Typed10TextParser3runEv",
    "_ZN3JSC3AOT5Typed12parseProgramEN3WTF10StringViewENS1_6IRFormERNS0_12BuildContextENS1_12RawWordCheckE",
    "_ZN3JSC3AOT5Typed9IRPrinter12printProgramEv",
    "_ZN3JSC3AOT5Typed11printFieldsERNS1_9IRPrinterERKNS1_5ValueE",
    "_ZN3JSC3AOT5Typed9printTypeERN3WTF11PrintStreamERKNS1_7ProgramERKNS1_4TypeE",
    "_RNvNtNtCs1234_7bun_aot2ir5print13print_program",
  ])
    expect({ symbol, isForbidden: matches(forbidden, symbol) }).toEqual({ symbol, isForbidden: true });
  // The reader of the program as bytes ships.
  expect(matches(forbidden, "_ZN3JSC3AOT5Typed6Reader10readHeaderEv")).toBe(false);
});

test("a build with assertions is not looked at", () => {
  using dir = tempDir("build-ir-text-stays-out", {});
  expect(binaryExpectations(config({ assertions: true }, String(dir))).forbiddenSymbols).toBeUndefined();
  expect(binaryExpectations(config({ buildType: "Debug" }, String(dir))).forbiddenSymbols).toBeUndefined();
});
