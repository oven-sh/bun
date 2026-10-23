import { readTrimTable } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { sharedCacheDir } from "../../../scripts/build/config.ts";
import { prebuiltDirPrefix, WEBKIT_VERSION } from "../../../scripts/build/deps/webkit.ts";
import { serializeBuiltinUses } from "../../../scripts/build/trim/builtin-uses.ts";
import {
  featureNamed,
  loadFeatures,
  serializeFeatureModel,
  type FeatureModel,
  type FeatureName,
} from "../../../scripts/build/trim/features.ts";
import type { TrimTable } from "../../../scripts/build/trim/table.ts";
import type { BuiltinEntry } from "../../../scripts/build/trim/types.ts";
import { rustSource as removableFeaturesRustSource } from "../../../src/codegen/generate-removable-features.ts";
import { run as runCommand } from "../../aot/harness/run";

export const repositoryRoot: string = join(import.meta.dir, "..", "..", "..");
export const linkScript: string = join(repositoryRoot, "scripts", "build", "trim", "link.ts");
export const model: FeatureModel = loadFeatures(repositoryRoot);

export const Extra = "Atomics";
export const Other = "WeakReferences";
export const Third = "MathSumPrecise";

export const indexOf = (feature: FeatureName): number => featureNamed(model, feature).index;
export const exportFeatures: FeatureName[] = model.features
  .filter(feature => feature.exports)
  .sort((a, b) => a.index - b.index)
  .map(feature => feature.name);

export type ToyFormat = "elf" | "macho" | "coff";

const childrenOf = (folder: string) => (existsSync(folder) ? readdirSync(folder).sort() : []);

export interface GuardHeader {
  path: string;
  featureListPath: string;
  includes: string[];
}

function findGuardHeader(): GuardHeader | undefined {
  const checkouts = [process.env.BUN_WEBKIT_PATH, join(repositoryRoot, "vendor", "WebKit")];
  for (const checkout of checkouts) {
    if (checkout === undefined) continue;
    const engine = join(checkout, "Source", "JavaScriptCore", "aot");
    // A build writes what the generators make into a folder of its own: scripts/build/aot-paths.ts prints which.
    const generated = process.env.AOT_BUILTINS_GENERATED ?? join(engine, "builtins", "generated");
    const folders = [join(engine, "runtime"), join(engine, "builtins"), generated];
    const path = join(folders[0]!, "AOTRemovableFeature.h");
    const featureListPath = join(folders[2]!, "AOTBuiltinFeatures.h");
    if (existsSync(path) && existsSync(featureListPath)) {
      return {
        path,
        featureListPath,
        includes: [...folders, join(checkout, "Source", "WTF")].map(folder => `-I${folder}`),
      };
    }
  }
  const buildFolder = join(repositoryRoot, "build");
  const caches = [
    sharedCacheDir(repositoryRoot),
    ...childrenOf(buildFolder).map(profile => join(buildFolder, profile, "cache")),
  ];
  const prefix = prebuiltDirPrefix(WEBKIT_VERSION);
  for (const cache of caches) {
    for (const name of childrenOf(cache)) {
      if (!name.startsWith(prefix)) continue;
      const include = join(cache, name, "include");
      const folder = join(include, "JavaScriptCore");
      const path = join(folder, "AOTRemovableFeature.h");
      const featureListPath = join(folder, "AOTBuiltinFeatures.h");
      if (existsSync(path) && existsSync(featureListPath))
        return { path, featureListPath, includes: [`-I${folder}`, `-I${include}`] };
    }
  }
  return undefined;
}

export const guardHeader: GuardHeader | undefined = findGuardHeader();
export const guardHeaderSkipReason: string | undefined =
  guardHeader === undefined
    ? "there is no AOTRemovableFeature.h: not under $BUN_WEBKIT_PATH, vendor/WebKit or a build's cache of the prebuilt WebKit"
    : undefined;

function findBuiltinUses(): string | undefined {
  const buildFolder = join(repositoryRoot, "build");
  const codegenFolders = [
    process.env.BUN_CODEGEN_DIR,
    ...childrenOf(buildFolder).map(profile => join(buildFolder, profile, "codegen")),
  ];
  return codegenFolders
    .flatMap(folder => (folder === undefined ? [] : [join(folder, "builtin-uses.json")]))
    .find(path => existsSync(path));
}

export const builtinUsesPath: string | undefined = findBuiltinUses();
export const builtinUsesSkipReason: string | undefined =
  builtinUsesPath === undefined
    ? "there is no builtin-uses.json: not under $BUN_CODEGEN_DIR or the codegen folder of a build"
    : undefined;

const skipNotices = new Set<string>();

export function skipNotice(file: string, reason: string): void {
  const notice = `SKIPPED: ${file}: ${reason}`;
  if (skipNotices.has(notice)) return;
  skipNotices.add(notice);
  console.error(notice);
}

export const featureFlags: string[] = [
  `-DExtra=${indexOf(Extra)}`,
  `-DOther=${indexOf(Other)}`,
  `-DThird=${indexOf(Third)}`,
];
export const cxxFlags: string[] = [
  "-x",
  "c++",
  "-std=c++23",
  "-fno-exceptions",
  "-fno-rtti",
  "-DBUILDING_JSCONLY__=1",
  ...(guardHeader?.includes ?? []),
];

export const alphabet: string = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const manyFunctions = (prefix: string, count: number): string =>
  Array.from(
    { length: count },
    (_, index) =>
      `__attribute__((noinline)) int ${prefix}${index}(int x) { for (int i = 0; i < ${index + 3}; i++) x = x * ${index + 7} + i; return x ^ ${index}; }`,
  ).join("\n");
export const callAll = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `x += ${prefix}${index}(x);`).join(" ");

const guardSource = String.raw`#ifdef __cplusplus
extern "C" {
#endif
typedef struct { unsigned char magic[8]; unsigned isTrimmed, removedRangeCount; long long removedRangesOffset; unsigned char removal[512]; } RemovableFeatureState;
extern const RemovableFeatureState Bun__removableFeatureState;
__attribute__((noreturn)) void Bun__abortForRemovedFeature(unsigned short feature);
#ifdef __cplusplus
}
#endif
#if defined(__APPLE__)
#define RECORDS ".pushsection __DWARF,__bun_entries,regular,debug\n"
#elif defined(_WIN32)
#define RECORDS ".pushsection .bun_removable_entry_points,\"yn\"\n"
#else
#define RECORDS ".pushsection .bun_removable_entry_points,\"e\",@progbits\n"
#endif
#if defined(__x86_64__)
#define RECORD_OF(feature, function, stub, origin, builtin) __asm__ volatile("771:\n" RECORDS ".p2align 3\n.quad 771b\n.quad %p0\n.short %c1\n.byte %c2\n.byte %c3\n.long %c4\n.popsection\n" : : "Ws"(function), "i"(feature), "i"(stub), "i"(origin), "i"(builtin))
#else
#define RECORD_OF(feature, function, stub, origin, builtin) __asm__ volatile("771:\n" RECORDS ".p2align 3\n.quad 771b\n.quad %0\n.short %c1\n.byte %c2\n.byte %c3\n.long %c4\n.popsection\n" : : "S"(function), "i"(feature), "i"(stub), "i"(origin), "i"(builtin))
#endif
#define RECORD(feature, function) RECORD_OF(feature, function, 0, 0, 0)
#define GUARDED(feature, function, ...) (__extension__({ if (Bun__removableFeatureState.removal[feature]) Bun__abortForRemovedFeature(feature); RECORD(feature, function); function(__VA_ARGS__); }))
#define GUARDED_BUILTIN(feature, builtin, function, ...) (__extension__({ if (Bun__removableFeatureState.removal[feature]) Bun__abortForRemovedFeature(feature); RECORD_OF(feature, function, 1, 1, builtin); function(__VA_ARGS__); }))
`;

function commonSources(count: number): Record<string, string> {
  return {
    "guard.h": guardSource,
    "feature_code.c": `
    const char feature_table[62] = "${alphabet}";
    const int feature_numbers[8192] = { 1, 2, 3 };
    ${manyFunctions("feature_code_", count)}
    int feature_code(int x) { ${callAll("feature_code_", count)} return x + feature_table[x & 31] + feature_numbers[x & 8191]; }
  `,
    "entry.c": `int feature_code(int); __attribute__((noinline)) int entered(int x) { return feature_code(x) * 3 + feature_code(x + 1); }\n`,
    "table.c": `const char retained_table[62] = "${alphabet}";`,
  };
}

export function plainSources(format: ToyFormat, count: number = 1500): Record<string, string> {
  return {
    ...commonSources(count),
    "embedder.c": embedderSource(format),
    "main.c": `
    #include "guard.h"
    extern const char retained_table[62];
    int entered(int);
    __attribute__((noinline)) int retained(int x) { return retained_table[x & 31]; }
    int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : retained(argc) == '1' ? 0 : 1; }
  `,
  };
}

export function baseSources(format: ToyFormat, count: number = 1500): Record<string, string> {
  return {
    ...commonSources(count),
    "toy.h": toyHeader,
    "embedder.cpp": embedderSource(format),
    "main.cpp": `
    #include "toy.h"
    extern "C" { extern const char retained_table[62]; int entered(int); }
    extern "C" NEVER_INLINE int retained(int x) { return retained_table[x & 31]; }
    int main(int argc, char**) { return argc > 5 ? JSC::callRemovable<JSC::RemovableFeature::Atomics, JSC::RemovedFeatureStub::Abort, entered>(argc) & 63 : retained(argc) == '1' ? 0 : 1; }
  `,
  };
}

export const start: string = `
  #include "guard.h"
  int entered(int);
`;
export const entryCalling = (name: string): string => `
  int feature_code(int);
  int ${name}(int);
  __attribute__((noinline)) int entered(int x) { return feature_code(x) * 3 + ${name}(x + 1); }
`;
export const entryGuarding = (feature: string, name: string): string => `
  #include "guard.h"
  int feature_code(int);
  int ${name}(int);
  __attribute__((noinline)) int entered(int x) { return feature_code(x) * 3 + GUARDED(${feature}, ${name}, x + 1); }
`;
export const mainGuardingBoth: string = `
  ${start}
  int entry_of_other(int);
  int main(int argc, char **argv) {
    if (argc > 6) return GUARDED(Other, entry_of_other, argc) & 63;
    return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : 0;
  }
`;
export const mainEnteringBuiltin = (builtin: number): string => `
  ${start}
  int main(int argc, char **argv) { return argc > 5 ? GUARDED_BUILTIN(Extra, ${builtin}, entered, argc) & 63 : 0; }
`;
export const mixingFunction = (name: string, factor: number, mask: number = factor): string => `
  __attribute__((noinline)) int ${name}(int x) {
    for (int i = 0; i < 3; i++) x = x * ${factor} + i;
    return x ^ ${mask};
  }
`;
export const equalFunction = (name: string): string => mixingFunction(name, 3, 77);
export const otherSource: string = mixingFunction("entry_of_other", 11);

const stateLabel = "Bun__removableFeatureState";

function stateAssembly(format: ToyFormat): string[] {
  const alignment = ".p2align 3";
  const contents = ['.ascii "BUNFEAT\\0"', ".zero 528", ".text"];
  switch (format) {
    case "elf":
      return [
        '.section .bun_features,"a",@progbits',
        `.globl ${stateLabel}`,
        `.type ${stateLabel},@object`,
        `.size ${stateLabel}, 536`,
        alignment,
        `${stateLabel}:`,
        ...contents,
      ];
    case "macho":
      return [".section __TEXT,__bun_features", `.globl _${stateLabel}`, alignment, `_${stateLabel}:`, ...contents];
    case "coff":
      return ['.section .bunfeat,"dr"', `.globl ${stateLabel}`, alignment, `${stateLabel}:`, ...contents];
  }
}

const programHeaderRoomAssembly = [
  '.section .note.bun,"aR",@note',
  ".p2align 3",
  ".long 4, 3584, 1",
  '.asciz "Bun"',
  ".zero 3584",
  ".text",
];

export function embedderSource(
  format: ToyFormat,
  options?: { stateFromRust?: boolean; exit?: (code: string) => string },
): string {
  const assembly = (lines: string[]) =>
    lines.length > 0 ? ["__asm__(", ...lines.map(line => JSON.stringify(`${line}\n`)), ");"] : [];
  const state = options?.stateFromRust ? [] : assembly(stateAssembly(format));
  return [
    '#include "guard.h"',
    ...state,
    ...assembly(format === "elf" ? programHeaderRoomAssembly : []),
    "#ifdef __cplusplus",
    'extern "C" {',
    "#endif",
    "int toy_thrown, toy_thrown_builtin;",
    "__attribute__((noreturn)) void _exit(int);",
    `void Bun__abortForRemovedFeature(unsigned short feature) { ${options?.exit?.("70") ?? "_exit(70);"} }`,
    "long long Bun__throwForRemovedFeature(void *realm, unsigned short feature) { toy_thrown = feature + 1; return 0; }",
    "long long Bun__throwForRemovedBuiltin(void *realm, unsigned short feature, unsigned builtin) { toy_thrown = feature + 1; toy_thrown_builtin = builtin; return 0; }",
    "#ifdef __cplusplus",
    "}",
    "#endif",
    "",
  ].join("\n");
}

export const toyHeader: string = `#pragma once
#include "AOTRemovableFeature.h"
namespace JSC { class CallFrame; }
`;

export const spelledBuiltin = 7;

export const spellingsSource: string = String.raw`#include "toy.h"
extern "C" { int feature_code(int); int printf(const char*, ...); extern int toy_thrown, toy_thrown_builtin; }
using namespace JSC;  using enum RemovableFeature;  using enum RemovedFeatureStub;
using HostFunction = EncodedJSValue (JSC_HOST_CALL_ATTRIBUTES *)(JSGlobalObject*, CallFrame*);
static NEVER_INLINE int aborts(int x) { return feature_code(x) + 1; }            static NEVER_INLINE int defaults(int x) { return feature_code(x) | 1; }
static NEVER_INLINE EncodedJSValue JSC_HOST_CALL_ATTRIBUTES host(JSGlobalObject*, CallFrame*) { return feature_code(2) | 1; }
static NEVER_INLINE EncodedJSValue JSC_HOST_CALL_ATTRIBUTES builtin(JSGlobalObject*, CallFrame*) { return feature_code(3) | 1; }
static NEVER_INLINE EncodedJSValue JSC_HOST_CALL_ATTRIBUTES called(JSGlobalObject*, CallFrame*) { return feature_code(6) | 1; }
static NEVER_INLINE EncodedJSValue JSC_HOST_CALL_ATTRIBUTES listed(JSGlobalObject*, CallFrame*) { return feature_code(7) | 1; }
static NEVER_INLINE EncodedJSValue JSC_HOST_CALL_ATTRIBUTES defined(JSGlobalObject*, CallFrame*) { JSC_REMOVABLE_HOST_FUNCTION_DEFINITION(Atomics, defined); return feature_code(5) | 1; }
static NEVER_INLINE int operation(int x) { return feature_code(x) | 1; }   static int replacement(int) { return -1; }
extern "C" int body(int x) { JSC_BEGIN_REMOVABLE_ENTRY_POINT(Atomics, ReturnDefault, int) if (x < 0) return 7; return feature_code(x) | 1; JSC_END_REMOVABLE_ENTRY_POINT }
static HostFunction volatile table[] = { listed };
static uint16_t featureOfReplacedFunction;
static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES throwsInstead(JSGlobalObject* realm, CallFrame*) { return Bun__throwForRemovedFeature(realm, featureOfReplacedFunction); }
template<> HostFunction JSC::functionUnlessRemovedSlow(HostFunction function) {
    auto feature = removedFeatureAt(reinterpret_cast<const void*>(function));
    if (!feature) return function;
    featureOfReplacedFunction = static_cast<uint16_t>(*feature);
    return throwsInstead;
}
static int takeThrown() { int thrown = toy_thrown; toy_thrown = 0; return thrown; }
static int takeThrownBuiltin() { int thrown = toy_thrown_builtin; toy_thrown_builtin = 0; return thrown; }
int main(int argc, char**) {
    if (argc > 1) return callRemovable<Atomics, Abort, aborts>(argc) & 63;
    JSGlobalObject* realm = nullptr; CallFrame* frame = nullptr;
    long long a = callRemovable<Atomics, ReturnDefault, defaults>(1);
    long long b = functionUnlessRemoved(removableFunction<Atomics, Throw, host>())(realm, frame); int thrownByHost = takeThrown(), builtinOfHost = takeThrownBuiltin();
    long long c = functionUnlessRemoved(removableBuiltinFunction<Atomics, Throw, builtin, ${spelledBuiltin}>())(realm, frame); int thrownByBuiltin = takeThrown(), builtinOfBuiltin = takeThrownBuiltin();
    long long d = callRemovableBuiltin<Atomics, called, ${spelledBuiltin}>(realm, frame); int thrownByCalled = takeThrown(), builtinOfCalled = takeThrownBuiltin();
    long long e = addressUnlessRemoved<Atomics, operation>(replacement)(4), f = body(5), g = body(-1);
    recordRemovableTableEntry<table, Atomics, Throw, listed>();
    long long h = functionUnlessRemoved(HostFunction(table[0]))(realm, frame); int thrownByListed = takeThrown(), builtinOfListed = takeThrownBuiltin();
    long long i = functionUnlessRemoved(HostFunction(defined))(realm, frame); int thrownByDefined = takeThrown(), builtinOfDefined = takeThrownBuiltin();
    printf("%d %d,%d,%d %d,%d,%d %d,%d,%d %d %d,%d %d,%d,%d %d,%d,%d\n", a != 0, b != 0, thrownByHost, builtinOfHost, c != 0, thrownByBuiltin, builtinOfBuiltin, d != 0, thrownByCalled, builtinOfCalled, (int)e == -1, f != 0, (int)g, h != 0, thrownByListed, builtinOfListed, i != 0, thrownByDefined, builtinOfDefined);
}
`;

export const builtinEnteringOtherSources: Record<string, string> = {
  "toy.h": toyHeader,
  "guarding.cpp": `#include "toy.h"
extern "C" { int feature_code(int); int entry_of_other(int); }
extern "C" NEVER_INLINE JSC::EncodedJSValue entered_as_builtin(JSC::JSGlobalObject*, int x) { return feature_code(x) * 3 + JSC::callRemovable<JSC::RemovableFeature::${Other}, JSC::RemovedFeatureStub::Abort, entry_of_other>(x + 1); }
`,
  "other.c": otherSource,
  "main.cpp": `#include "toy.h"
extern "C" JSC::EncodedJSValue entered_as_builtin(JSC::JSGlobalObject*, int);
int main(int argc, char**) { return argc > 5 ? JSC::callRemovableBuiltin<JSC::RemovableFeature::${Extra}, entered_as_builtin, ${spelledBuiltin}>(static_cast<JSC::JSGlobalObject*>(nullptr), argc) & 63 : 0; }
`,
};
export const builtinEnteringOtherObjects: string[] = ["feature_code", "guarding", "other", "embedder", "main"];

export const spellingsEntryPoints: string[] = [
  "aborts",
  "defaults",
  "host",
  "builtin",
  "called",
  "listed",
  "defined",
  "operation",
];
export const spellingsGuardFunctions: string[] = ["body"];
export const spellingsStubs: string[] = ["Abort", "ReturnDefault", "Throw"];
export const wholeSpellingsOutput = "1 1,0,0 1,0,0 1,0,0 0 1,7 1,0,0 1,0,0";
export const trimmedSpellingsOutput: string = (() => {
  const thrown = indexOf(Extra) + 1;
  return `0 0,${thrown},0 0,${thrown},0 0,${thrown},${spelledBuiltin} 1 0,0 0,${thrown},0 0,${thrown},0`;
})();

export const rustSource: string = `#![no_std]
use bun_removable_features::{
    call_removable, call_removable_or, is_removed, removable_body, Feature,
};

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[unsafe(no_mangle)]
extern "C" fn rust_eh_personality() {}

unsafe extern "C" {
    safe fn feature_code(x: i32) -> i32;
}

#[inline(never)]
fn rust_aborts(x: i32) -> i32 {
    feature_code(x) + 1
}

#[inline(never)]
fn rust_defaults(x: i32) -> i32 {
    feature_code(x) | 1
}

#[inline(never)]
fn rust_throws(x: i32) -> i32 {
    feature_code(x) | 3
}

#[unsafe(no_mangle)]
pub extern "C" fn rust_call_abort(x: i32) -> i32 {
    call_removable!(Atomics, Abort, rust_aborts, x)
}

#[unsafe(no_mangle)]
pub extern "C" fn rust_call_default(x: i32) -> i32 {
    call_removable!(Atomics, ReturnDefault, rust_defaults, x)
}

#[unsafe(no_mangle)]
pub extern "C" fn rust_call_or(x: i32) -> i32 {
    call_removable_or!(Atomics, Throw, { -2 }, rust_throws, x)
}

#[unsafe(no_mangle)]
pub extern "C" fn rust_body_abort(x: i32) -> i32 {
    removable_body!(Atomics, Abort, {
        if x < 0 {
            return 7;
        }
        feature_code(x) | 1
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn rust_body_default(x: i32) -> i32 {
    removable_body!(Atomics, ReturnDefault, {
        if x < 0 {
            return 7;
        }
        feature_code(x) | 1
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn rust_is_removed() -> bool {
    is_removed(Feature::Atomics)
}
`;

export const builtinUsing = (id: number, path: string, ...features: FeatureName[]): BuiltinEntry => ({
  id,
  path,
  kind: "Function",
  uses: features.map(feature => ({ feature, isConditional: false })),
  nativeSymbols: [],
  hasHiddenRoot: false,
});

export const toyBuiltins: BuiltinEntry[] = [
  builtinUsing(spelledBuiltin, "toy.extra", Extra),
  builtinUsing(spelledBuiltin + 1, "toy.other", Other),
  builtinUsing(spelledBuiltin + 2, "toy.third", Third),
];

export interface LinkInputs {
  features: string;
  builtinUses: string;
}

export function writeLinkInputs(
  folder: string,
  options?: { minimums?: Record<FeatureName, number>; builtins?: BuiltinEntry[] },
): LinkInputs {
  const features = join(folder, "features.json");
  const builtinUses = join(folder, "builtin-uses.json");
  const withMinimums = model.features.map(feature => {
    const minimum = options?.minimums?.[feature.name];
    return { ...feature, minimumBytes: minimum === undefined ? {} : { elf: minimum, macho: minimum, coff: minimum } };
  });
  writeFileSync(features, serializeFeatureModel({ ...model, features: withMinimums }));
  writeFileSync(builtinUses, serializeBuiltinUses({ entries: options?.builtins ?? toyBuiltins }));
  return { features, builtinUses };
}

export function linkArguments(
  inputs: LinkInputs,
  command: string[],
  options?: { demangler?: string },
): string[] {
  return [
    bunExe(),
    linkScript,
    "work",
    inputs.features,
    inputs.builtinUses,
    ...(options?.demangler === undefined ? [] : [`--demangler=${options.demangler}`]),
    "--",
    ...command,
  ];
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const cleanExit: ProcessResult = { stdout: "", stderr: "", exitCode: 0 };

export async function run(
  cmd: string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): Promise<ProcessResult> {
  // A toy program whose feature was removed aborts, and CI's runner fails a test file beside which a core file appears.
  const withoutCoreDump = isWindows ? cmd : ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", ...cmd];
  const { stdout, stderr, exitCode } = await runCommand(withoutCoreDump, cwd, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}

export async function exitCodeOf(folder: string, name: string, args: string[] = []): Promise<number> {
  return (await run([join(folder, name), ...args], folder)).exitCode;
}

const reviewFolder = (folder: string, output: string) => join(folder, `${output}.trim`);

export function reviewFiles(folder: string, output: string): string[] {
  return childrenOf(reviewFolder(folder, output));
}

export function entryPointsText(folder: string, output: string): string {
  return readFileSync(join(reviewFolder(folder, output), "entry-points.txt"), "utf8");
}

export function expectLinkFailure(folder: string, output: string, linkResult: ProcessResult, texts: string[]): void {
  expect(linkResult.exitCode).toBe(1);
  expect(linkResult.stderr).toStartWith("trim: ");
  for (const text of texts) expect(linkResult.stderr).toContain(text);
  expect(reviewFiles(folder, output).filter(name => name.endsWith(".txt"))).toEqual([]);
}

export interface ProgramRuns {
  programResult: ProcessResult | undefined;
  trimmedResult: ProcessResult | undefined;
}

export function expectCleanRuns({ programResult, trimmedResult }: ProgramRuns): void {
  if (programResult === undefined || trimmedResult === undefined) return;
  expect({ program: programResult.exitCode, trimmed: trimmedResult.exitCode }).toEqual({ program: 0, trimmed: 0 });
}

export interface Inspection {
  table: TrimTable;
  addressOf(name: string): number;
  featuresAt(address: number): FeatureName[] | undefined;
  featuresOf(name: string): FeatureName[] | undefined;
}

const machOMagic = 0xfeedfacf;
const featureNames = new Map(model.features.map(feature => [feature.index, feature.name]));

export async function inspect(executable: string, nm: string): Promise<Inspection> {
  const table = readTrimTable(executable);
  const header = new DataView(await Bun.file(executable).slice(0, 4).arrayBuffer());
  const isMachO = header.getUint32(0, true) === machOMagic;
  const listing = await run([nm, executable], process.cwd());
  if (listing.exitCode !== 0) throw new Error(`${nm} ${executable} failed: ${listing.stderr}`);

  const addresses = new Map<string, number>();
  for (const line of listing.stdout.split("\n")) {
    const words = line.trim().split(/\s+/);
    if (words.length !== 3) continue;
    const name = isMachO && words[2].startsWith("_") ? words[2].slice(1) : words[2];
    if (!addresses.has(name)) addresses.set(name, parseInt(words[0], 16));
  }

  const addressOf = (name: string) => {
    const address = addresses.get(name);
    if (address === undefined) throw new Error(`${executable} has no symbol ${name}`);
    return address;
  };
  const featuresAt = (address: number) => {
    const range = table.ranges.find(range => range.start <= address && address < range.end);
    return range && table.sets[range.set].map(index => featureNames.get(index)!);
  };
  return { table, addressOf, featuresAt, featuresOf: name => featuresAt(addressOf(name)) };
}

const rustFlags = (folder: string, target: string | undefined) => [
  "--edition",
  "2024",
  "-C",
  "opt-level=2",
  "-C",
  "panic=abort",
  ...(target === undefined ? [] : ["--target", target]),
  "--out-dir",
  folder,
];

async function hasTargetLibraries(folder: string, rustc: string, target: string): Promise<boolean> {
  const printed = await run([rustc, "--print", "target-libdir", "--target", target], folder);
  return printed.exitCode === 0 && existsSync(printed.stdout.trim());
}

export async function buildGuardCrate(folder: string, rustc: string, target?: string): Promise<string | undefined> {
  if (target !== undefined && !(await hasTargetLibraries(folder, rustc, target))) return undefined;
  writeFileSync(join(folder, "removable_features.rs"), removableFeaturesRustSource(model));
  const crateRoot = join(repositoryRoot, "src", "trim", "removable_features", "lib.rs");
  const cmd = [
    rustc,
    "--crate-type",
    "rlib",
    "--crate-name",
    "bun_removable_features",
    ...rustFlags(folder, target),
    crateRoot,
  ];
  const built = await run(cmd, folder, { BUN_CODEGEN_DIR: folder });
  if (built.exitCode !== 0) throw new Error(`rustc failed on ${crateRoot}: ${built.stderr}`);
  return join(folder, "libbun_removable_features.rlib");
}

export async function compileRust(
  folder: string,
  rustc: string,
  crate: string,
  source: string,
  options?: { target?: string; bitcode?: boolean },
): Promise<string> {
  const cmd = [
    rustc,
    "--crate-type",
    "staticlib",
    ...rustFlags(folder, options?.target),
    "--extern",
    `bun_removable_features=${crate}`,
    ...(options?.bitcode ? ["-C", "linker-plugin-lto"] : []),
    source,
  ];
  const compiled = await run(cmd, folder);
  if (compiled.exitCode !== 0) throw new Error(`rustc failed on ${source}: ${compiled.stderr}`);
  const stem = basename(source, extname(source));
  const isMsvc = options?.target === undefined ? isWindows : options.target.endsWith("-msvc");
  return join(folder, isMsvc ? `${stem}.lib` : `lib${stem}.a`);
}
