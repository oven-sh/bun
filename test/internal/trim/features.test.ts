import { builtinFeatureUses } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type Toolchain } from "../../../scripts/build/config.ts";
import { checkBuiltinUses } from "../../../scripts/build/trim/builtin-uses.ts";
import { declarationsOf, declarationsPath, documentedModules } from "../../../scripts/build/trim/declarations.ts";
import { featureNamed, loadFeatures } from "../../../scripts/build/trim/features.ts";
import { icuItemClasses } from "../../../scripts/build/trim/icu-data.ts";
import { type BuiltinUses } from "../../../scripts/build/trim/types.ts";
import { specifierOf } from "../../../src/codegen/builtins-manifest-model.ts";
import { guardHeader } from "./toy-program.ts";

const root = join(import.meta.dir, "..", "..", "..");
const model = loadFeatures(root);
const uses: BuiltinUses = { entries: builtinFeatureUses() };

function mockToolchain(): Toolchain {
  return {
    cc: "/fake/llvm/bin/clang",
    cxx: "/fake/llvm/bin/clang++",
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
  } as Toolchain;
}

test("the feature files load", () => {
  expect(featureNamed(model, "JIT").index).toBe(0);
  expect(featureNamed(model, "Tools").index).toBe(128);
  expect(model.trimFeatures.length).toBe(73);
  expect(model.trimFeatures.slice(0, 2).map(trimFeature => trimFeature.name)).toEqual(["cli", "lint"]);
  const classes = new Set<string>(icuItemClasses);
  expect(model.icuData.map(line => line.itemClass).filter(itemClass => !classes.has(itemClass))).toEqual([]);
});

test.skipIf(!guardHeader)("the engine's header lists the engine features in order", () => {
  const text = readFileSync(guardHeader!.featureListPath, "utf8");
  const start = text.indexOf("#define FOR_EACH_ENGINE_REMOVABLE_FEATURE(macro)");
  expect(start).toBeGreaterThanOrEqual(0);
  const list = text.slice(start, text.indexOf("\n\n", start));
  expect([...list.matchAll(/macro\((\w+), (\d+)\)/g)].map(match => [match[1], Number(match[2])])).toEqual(
    model.features.filter(feature => feature.isEngine).map(feature => [feature.name, feature.index]),
  );
});

test("the built-ins table names declared features only, each once for an entry, with ascending ids", () => {
  expect(uses.entries.length).toBeGreaterThan(1000);
  expect(() => checkBuiltinUses(uses, model, "builtinFeatureUses()")).not.toThrow();
});

test("packages/bun-types/trim.d.ts is current", () => {
  expect(
    readFileSync(declarationsPath, "utf8"),
    "Run: bun scripts/build/trim/declarations.ts <codegen dir>/builtin-uses.json",
  ).toBe(declarationsOf(model, uses));
});

test("packages/bun-types/trim.d.ts lists every trim feature with its description", () => {
  const unwrap = (text: string) => text.replace(/\n\s*\*/g, "").replace(/\s/g, "");
  const declarations = readFileSync(declarationsPath, "utf8");
  expect([...declarations.matchAll(/^ {6}\| "([^"]+)"/gm)].map(match => match[1])).toEqual(
    model.trimFeatures.map(trimFeature => trimFeature.name),
  );
  const unwrapped = unwrap(declarations);
  expect(
    model.trimFeatures
      .filter(trimFeature => !unwrapped.includes(unwrap(trimFeature.about)))
      .map(trimFeature => trimFeature.name),
  ).toEqual([]);
});

test("every trim feature has a description that ends with a period, and the sizes it saves", () => {
  expect(
    model.trimFeatures.filter(trimFeature => !trimFeature.about.endsWith(".")).map(trimFeature => trimFeature.name),
  ).toEqual([]);
  expect(
    model.trimFeatures
      .filter(({ saves }) => !saves || !Number.isFinite(saves.linux) || !Number.isFinite(saves.macos))
      .map(trimFeature => trimFeature.name),
  ).toEqual([]);
});

test("no trim feature documents a module of src/js/internal", () => {
  const internalFiles = readdirSync(join(root, "src", "js", "internal"), { recursive: true, encoding: "utf8" });
  const internalSpecifiers = new Set(internalFiles.map(file => specifierOf(`internal/${file.replaceAll("\\", "/")}`)));
  expect(internalSpecifiers.has("internal/dgram")).toBe(true);
  const documented = model.trimFeatures.flatMap(trimFeature => documentedModules(model, uses, trimFeature));
  expect(documented.length).toBeGreaterThan(10);
  expect(documented.filter(module => internalSpecifiers.has(module))).toEqual([]);
});

const neverOffered: Record<string, string> = {
  "part of the language: a dependency may use it without the program naming it":
    "RegExp RegExpUnicodeProperties RegExpFromString Atomics WeakReferences DataView Int8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float16Array Float32Array Float64Array BigInt64Array BigUint64Array TypedArraySort Uint8ArrayBase64 RareArrayMethods SetMethods MapGetOrInsert PromiseAll PromiseAllSettled PromiseAny PromiseRace JSONRawJSON MathSumPrecise NumberPrecisionMethods LegacyAccessors EscapeUnescape URICoding StringLocaleCase StringNormalize StringPadding StringRepeat StringHTML StringWellFormed StringLastIndexOf ShadowRealm",
  "Bun's own modules depend on it":
    "Url Events AbortSignal Headers FormData FsStats WebStreams TextDecoderStream Bodies BunFile Buffer NodeBufferModule NodeEvents FileSink TextDecoder TextEncoder Base64Globals StructuredClone ExternalSerializedValues NodeFs NodeOs NodePath NodeValidators NodeUtil NodeSmallModules NodeUrl StringDecoder CryptoObject CryptoGlobal PackageFiles NodeHttp HttpParser NetAddresses",
  "too small to be worth a name":
    "Unsafe Ansi EscapeHtml Uuid NodeAssert ModuleGraph NodeV8 DeepEquals ParseArgs SystemCaCertificates ConsoleTable ProcessBinding ProcessExecArgv ProcessUsage ProcessInformation ProcessControl ProcessStdout ProcessOutputStreams ProcessStdin ProcessOpenStdin ConsoleConstructor BunUtilities StringWidth NodeRepl NodeFetch Undici",
  "it has no name yet":
    "NodeWorker Bunfig CliOptions CompressionFunctions BunZstdCompress BunDeflate CompressionStreams CompressionStream DecompressionStream Histogram LegacyEncodings LibdeflateCompressor MessageChannel NodeZlib NodeZlibBrotli NodeZlibZstd PerformanceTimeline PerformanceMarks PostMessage Tls TlsSockets X509 ZstdCompressor",
  "its built-ins still work when the features used with it are removed":
    "ElementsToLocaleString ProcessListeners ProcessListenerRemoval ProcessConnected",
};

test("every feature has a public name, or a reason why it has none", () => {
  const features = model.features.map(feature => feature.name);
  const named = new Set(model.trimFeatures.flatMap(trimFeature => trimFeature.features));
  const excused = Object.values(neverOffered).flatMap(list => list.split(" "));
  expect(features.filter(feature => !named.has(feature) && !excused.includes(feature))).toEqual([]);
  expect(
    excused.filter(
      (feature, index) => named.has(feature) || !features.includes(feature) || excused.indexOf(feature) !== index,
    ),
  ).toEqual([]);
});
