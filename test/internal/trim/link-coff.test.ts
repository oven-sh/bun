import { trimExecutable } from "bun:internal-for-testing";
import { expect, setDefaultTimeout, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BuildError } from "../../../scripts/build/error.ts";
import {
  coffRecordSectionName,
  namedBytesOfPe,
  readCoffGraph,
  sectionInFile,
} from "../../../scripts/build/trim/coff-graph.ts";
import { readEntryPoints } from "../../../scripts/build/trim/entry-points.ts";
import { nodeAt } from "../../../scripts/build/trim/graph.ts";
import { itemsOf } from "../../../scripts/build/trim/icu-data.ts";
import { createLinker, parseArguments } from "../../../scripts/build/trim/link.ts";
import { peImage } from "../../../scripts/build/trim/linked-image.ts";
import { coff } from "../../../scripts/build/trim/linker-coff.ts";
import { foldedEntryPointsHeading } from "../../../scripts/build/trim/report.ts";
import { packageOf } from "../icu-data-package.ts";
import {
  arm64SkipReason,
  baseRelocationDirectory,
  bigObjectMagic,
  byIndex,
  canRun,
  defaultObjects,
  describeLink,
  expectSoundPe,
  exportedSource,
  guard,
  guardedPathArguments,
  guardObjects,
  guardsBoth,
  largeSources,
  libraryFolders,
  linked,
  linkSkipReason,
  mainCallingFeatureCode5,
  mainSource,
  moreObjects,
  objcopy,
  output,
  plainLink,
  pointerRelocationType,
  printfLibrary,
  readPe,
  recordRelocationTypes,
  rustc,
  sources,
  stateBytes,
  targetSource,
  thinLtoFlags,
  triple,
  wrapped,
  type LinkedProgram,
  type LinkOptions,
  type Machine,
} from "./link-coff-support.ts";
import {
  buildGuardCrate,
  builtinEnteringOtherObjects,
  builtinEnteringOtherSources,
  builtinUsing,
  callAll,
  compileRust,
  embedderSource,
  entryCalling,
  entryPointsText,
  equalFunction,
  exitCodeOf,
  expectCleanRuns,
  expectLinkFailure,
  exportFeatures,
  Extra,
  indexOf,
  manyFunctions,
  model,
  Other,
  otherSource,
  reviewFiles,
  run,
  rustSource,
  skipNotice,
  spelledBuiltin,
  spellingsEntryPoints,
  spellingsGuardFunctions,
  spellingsSource,
  spellingsStubs,
  trimmedSpellingsOutput,
  wholeSpellingsOutput,
  writeLinkInputs,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

const testFile = "link-coff.test.ts";
if (linkSkipReason !== undefined) skipNotice(testFile, linkSkipReason);
else if (arm64SkipReason !== undefined) skipNotice(testFile, `${arm64SkipReason}: the case for arm64 does not run`);

async function expectFeatureRemoved(folder: string, machine: Machine) {
  const program = await linked(folder, { machine });
  const { executable, trimmedExecutable, addressOf, featuresOf, summary, soundness } = program;
  expect(peImage(executable).isArm64).toBe(machine === "arm64");
  expect(["feature_code", "feature_code_0", "feature_code_1499", "entered", "feature_numbers"].map(featuresOf)).toEqual(
    [[Extra], [Extra], [Extra], [Extra], [Extra]],
  );
  expect(["retained", "main", "retained_table"].map(featuresOf)).toEqual([undefined, undefined, undefined]);
  expect(addressOf("feature_table")).toBe(addressOf("retained_table"));
  expect(summary.removedBytes).toBeGreaterThan(100_000);
  expect(summary.fileBytesSaved).toBeGreaterThanOrEqual(128 * 1024);
  expect(statSync(executable).size - statSync(trimmedExecutable).size).toBe(summary.fileBytesSaved);
  expect(soundness.cutSectionCount).toBeGreaterThan(0);
  expect(soundness.filledBytes).toBeGreaterThan(0);
  expect([...new Set(recordRelocationTypes(join(folder, "main.obj")))]).toEqual([pointerRelocationType[machine]]);
  expectCleanRuns(program);
  if (!canRun(machine)) return;
  expect(await exitCodeOf(folder, "trimmed.exe", guardedPathArguments)).toBe(70);
  expect(await exitCodeOf(folder, output, guardedPathArguments)).not.toBe(70);
}

describeLink("a trimmable link with lld-link", () => {
  test("removes a feature and cuts its pages out of the PE file", async () => {
    using dir = tempDir("trim-coff", largeSources);
    await expectFeatureRemoved(String(dir), "x64");
  });

  test.skipIf(arm64SkipReason !== undefined)(
    "does the same for arm64, with ADDR64 records and brk as fill",
    async () => {
      using dir = tempDir("trim-coff-arm64", largeSources);
      await expectFeatureRemoved(String(dir), "arm64");
    },
  );

  test("writes the four review files, the table and the state, and no record", async () => {
    using dir = tempDir("trim-coff-sections", sources);
    const folder = String(dir);
    const { executable } = await linked(folder);
    expect(reviewFiles(folder, output)).toEqual(["entry-points.txt", "groups.txt", "requires.txt", "retained-by.txt"]);
    const entryPoints = entryPointsText(folder, output).trimEnd().split("\n");
    expect(entryPoints).toHaveLength(1);
    expect(entryPoints[0]).toStartWith(`${Extra} Abort `);

    expect(sectionInFile(executable, ".buntrim")).toBeDefined();
    const state = sectionInFile(executable, ".bunfeat")!;
    expect(state.size).toBeGreaterThanOrEqual(stateBytes);
    const { file, sections } = readPe(executable);
    expect(file.toString("latin1", state.offset, state.offset + 8)).toBe("BUNFEAT\0");
    expect(sections.filter(({ name }) => name.startsWith(".bun_rem"))).toEqual([]);
  });

  test("retains the order file the command names, after its own", async () => {
    using dir = tempDir("trim-coff-order", { ...sources, "mine.txt": "retained\nmain\n" });
    const folder = String(dir);
    expectCleanRuns(await linked(folder, { linkFlags: ["/order:@mine.txt"] }));
    expect(readFileSync(join(folder, "work", "order.txt"), "latin1")).toEndWith("retained\nmain\n");
  });

  test("is byte-for-byte reproducible in another folder", async () => {
    using first = tempDir("trim-coff-first", sources);
    using second = tempDir("trim-coff-second", sources);
    const linkResults = await Promise.all([wrapped(String(first)), wrapped(String(second))]);
    expect(linkResults.map(({ exitCode }) => exitCode)).toEqual([0, 0]);
    expect(readFileSync(join(String(first), output)).equals(readFileSync(join(String(second), output)))).toBe(true);
  });

  test("distinguishes two static functions with the same name", async () => {
    using dir = tempDir("trim-coff-statics", {
      ...sources,
      "one.c": `static __attribute__((noinline)) int helper(int x) { return x * 7 + 1; } int from_one(int x) { return helper(x) + 1; }`,
      "two.c": `static __attribute__((noinline)) int helper(int x) { return x * 13 + 5; } int from_two(int x) { return helper(x) + 2; }`,
      "entry.c": entryCalling("from_two"),
      "main.cpp": mainSource("int from_one(int);", "from_one(argc) == 9 ? 0 : 1"),
    });
    const program = await linked(String(dir), { objects: ["feature_code", "entry", "one", "two", "embedder", "main"] });
    expect(["from_one", "from_two"].map(program.featuresOf)).toEqual([undefined, [Extra]]);
    const helpers = program.symbols
      .filter(([name]) => name === "helper")
      .map(([, address]) => program.featuresAt(address));
    expect(helpers).toHaveLength(2);
    expect(helpers).toContainEqual(undefined);
    expect(helpers).toContainEqual([Extra]);
    expectCleanRuns(program);
  });

  test("finds an unmarked entry point that the link compiles from bitcode, and deletes the compiled objects", async () => {
    using dir = tempDir("trim-coff-bitcode", {
      ...sources,
      "entry.c": `int feature_code(int); int entered(int x) { return feature_code(x) * 3 + feature_code(x + 1); }`,
    });
    const folder = String(dir);
    const program = await linked(folder, { compileFlags: { entry: thinLtoFlags, main: thinLtoFlags } });
    expect(program.featuresOf("entered")).toEqual([Extra]);
    expect(
      [...readdirSync(folder), ...readdirSync(join(folder, "work"))].filter(name => name.includes(".lto.")),
    ).toEqual([]);
    expectCleanRuns(program);
  });

  test("repoints the debug directory of a file whose sections were split", async () => {
    using dir = tempDir("trim-coff-debug", largeSources);
    const folder = String(dir);
    const program = await linked(folder, { linkFlags: ["/debug", "/pdb:program.pdb"] });
    expect(existsSync(join(folder, "program.pdb"))).toBe(true);
    expect(program.soundness.cutSectionCount).toBeGreaterThan(0);
    expect(program.soundness.codeViewEntries).toBeGreaterThan(0);
    expectCleanRuns(program);
  });

  test("drops the base relocations of the pages it cuts", async () => {
    const pointerCount = 40_000;
    const fullBlockBytes = 8 + 2 * 512;
    using dir = tempDir("trim-coff-relocations", {
      ...sources,
      "feature_code.c": `
        ${manyFunctions("feature_code_", 1500)}
        int (*const feature_pointers[${pointerCount}])(int) = { [0 ... ${pointerCount - 1}] = feature_code_0 };
        int feature_code(int x) { ${callAll("feature_code_", 1500)} return x + feature_pointers[(unsigned)x % ${pointerCount}](x); }
      `,
    });
    const folder = String(dir);
    const { executable, trimmedExecutable, featuresOf, trimmedResult } = await linked(folder);
    expect(featuresOf("feature_pointers")).toEqual([Extra]);
    const relocationBytes = (path: string) => readPe(path).directoryBytes(baseRelocationDirectory).length;
    expect(relocationBytes(executable) - relocationBytes(trimmedExecutable)).toBeGreaterThanOrEqual(
      60 * fullBlockBytes,
    );
    if (trimmedResult === undefined) return;
    for (let attempt = 0; attempt < 10; attempt++) expect(await exitCodeOf(folder, "trimmed.exe")).toBe(0);
  });
});

interface ReachCase extends Pick<LinkOptions, "linkFlags" | "archives" | "afterCompile"> {
  more: string;
  moreFile?: string;
  declarations: string;
  result: string;
  cxxDeclarations?: string;
  retained: string[];
  check?(program: LinkedProgram): void;
}

const foldedFunction: ReachCase = {
  more: `${equalFunction("feature_equal")} int more(int x) { return feature_equal(x); }`,
  declarations: equalFunction("retained_equal"),
  result: "retained_equal(argc) == 109 ? 0 : 1",
  retained: ["retained_equal", "feature_equal"],
};

const reachCases: Record<string, ReachCase> = {
  "a function folded into an equal one of the feature": foldedFunction,
  "a table of functions in read-only data": {
    more: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      int (*const feature_handlers[2])(int) = { first, second };
      int more(int x) { return feature_handlers[x & 1](x); }
    `,
    declarations: "extern int (*const feature_handlers[2])(int);",
    result: "feature_handlers[argc](argc) == 21 ? 0 : 1",
    retained: ["first", "second"],
  },
  "a function that runs before main": {
    more: `
      int early_value;
      static volatile int seed = 5;
      __attribute__((noinline)) int feature_early(int x) { return x * 5 + 1; }
      __attribute__((constructor)) static void early(void) { early_value = feature_early(seed); }
      int more(int x) { return feature_early(x); }
    `,
    declarations: "extern int early_value;",
    result: "early_value == 26 ? 0 : 1",
    retained: ["early", "feature_early"],
  },
  "a weak external whose default is in the feature's object": {
    more: `__attribute__((noinline)) int feature_fallback(int x) { return x + 100; } int maybe(int) __attribute__((weak, alias("feature_fallback"))); int more(int x) { return feature_fallback(x); }`,
    declarations: "int maybe(int);",
    result: "maybe(argc) == 101 ? 0 : 1",
    retained: ["feature_fallback"],
  },
  "a strong definition of the feature that replaces a weak external's default": {
    more: `__attribute__((noinline)) int replaced(int x) { return x + 2; } int more(int x) { return replaced(x); }`,
    declarations: `int local_default(int x) { return x + 1; } int replaced(int) __attribute__((weak, alias("local_default")));`,
    result: "replaced(argc) == 3 ? 0 : 1",
    retained: ["replaced"],
  },
  "the copy of an inline function the linker selected": {
    moreFile: "more.cpp",
    more: `
      inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }
      extern "C" int more(int x) { return shared_inline(x); }
    `,
    cxxDeclarations: "inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }",
    declarations: "",
    result: "shared_inline(argc) == 56 ? 0 : 1",
    retained: ["shared_inline"],
  },
  "a string literal both objects use": {
    more: `__attribute__((noinline)) const char *feature_words(void) { return "the same words in both"; } int more(int x) { return feature_words()[x & 7]; }`,
    declarations: `__attribute__((noinline)) const char *retained_words(void) { __asm__ volatile(""); return "the same words in both"; }`,
    result: "retained_words()[argc + 3] == 's' ? 0 : 1",
    retained: ["retained_words"],
    check({ symbols, featuresAt }) {
      const literal = symbols.find(([name]) => name.startsWith("??_C@") && name.includes("the?5same?5words"));
      expect(literal).toBeDefined();
      expect(featuresAt(literal![1])).toBeUndefined();
    },
  },
  "a name the link command defines": {
    more: targetSource,
    declarations: "int renamed(int);",
    result: "renamed(argc) == 7 ? 0 : 1",
    linkFlags: ["/alternatename:renamed=feature_target"],
    retained: ["feature_target"],
  },
  "the initial value of a thread-local variable": {
    more: `__attribute__((noinline)) int feature_hooked(int x) { return x + 7; } __declspec(thread) int (*hook)(int) = feature_hooked; int more(int x) { return feature_hooked(x) + hook(x); }`,
    declarations: "extern __declspec(thread) int (*hook)(int);",
    result: "hook(argc) == 8 ? 0 : 1",
    retained: ["feature_hooked"],
  },
  "an associative section of a retained function": {
    more: `__attribute__((noinline)) int feature_noted(int x) { return x * 5; } int more(int x) { return feature_noted(x); }`,
    declarations: String.raw`NEVER_INLINE int parent(int x) { return x + 1; }
__asm__(".section .rdata$note,\"dr\",associative,parent\n.quad feature_noted\n.text\n");`,
    result: "parent(argc) == 2 ? 0 : 1",
    retained: ["feature_noted", "parent"],
  },
  "equal read-only data without an external name": {
    more: `static const int feature_primes[64] = { 2, 3, 5, 7, 11 }; int more(int x) { return feature_primes[x & 63]; }`,
    declarations: "static const int retained_primes[64] = { 2, 3, 5, 7, 11 };",
    result: "retained_primes[argc] == 3 ? 0 : 1",
    retained: [],
    check({ addressOf, featuresOf }) {
      const listed = ["retained_primes", "feature_primes"].filter(name => !Number.isNaN(addressOf(name)));
      expect(listed).not.toEqual([]);
      expect(listed.map(featuresOf)).toEqual(listed.map(() => undefined));
    },
  },
  "an archive member": { ...foldedFunction, archives: { "shelf.lib": ["feature_code", "more"] } },
  "a big object": {
    more: [targetSource, ...Array.from({ length: 70_000 }, (_, index) => `int big_${index} = ${index};`)].join("\n"),
    declarations: "int feature_target(int);",
    result: "feature_target(argc) == 7 ? 0 : 1",
    retained: ["feature_target"],
    afterCompile: folder => expect([...readFileSync(join(folder, "more.obj")).subarray(0, 4)]).toEqual(bigObjectMagic),
  },
};

describeLink("retained code reaches a feature's code by", () => {
  for (const [name, reach] of Object.entries(reachCases)) {
    test(name, async () => {
      using dir = tempDir("trim-coff-reach", {
        ...sources,
        "entry.c": entryCalling("more"),
        [reach.moreFile ?? "more.c"]: reach.more,
        "main.cpp": mainSource(reach.declarations, reach.result, reach.cxxDeclarations),
      });
      const { linkFlags, archives, afterCompile } = reach;
      const program = await linked(String(dir), { objects: moreObjects, linkFlags, archives, afterCompile });
      expect(reach.retained.map(program.featuresOf)).toEqual(reach.retained.map(() => undefined));
      expect(["feature_code", "feature_code_0", "feature_code_1499"].map(program.featuresOf)).toEqual([
        [Extra],
        [Extra],
        [Extra],
      ]);
      reach.check?.(program);
      expectCleanRuns(program);
    });
  }
});

const rustMain = `extern "C" {
int printf(const char*, ...);
int rust_call_abort(int), rust_call_default(int), rust_call_or(int), rust_body_abort(int), rust_body_default(int);
bool rust_is_removed(void);
}
int main(int argc, char**) {
  if (argc == 2) return rust_call_abort(1) & 63;
  if (argc == 3) return rust_body_abort(1) & 63;
  printf("%d %d %d %d %d\\n", rust_call_default(1) != 0, rust_body_default(1) != 0, rust_body_default(-1), rust_call_or(1) == -2, rust_is_removed());
  return 0;
}
`;
const rustFiles = (toy: string) => ({
  ...sources,
  "embedder.cpp": embedderSource("coff", { stateFromRust: true }),
  "toy.rs": toy,
  "main.cpp": rustMain,
});

async function compileRustInputs(folder: string): Promise<LinkOptions | undefined> {
  const target = triple("x64");
  const crate = rustc === null ? undefined : await buildGuardCrate(folder, rustc, target);
  if (crate === undefined) {
    skipNotice(
      testFile,
      `rustc is not on PATH or cannot build the guard crate for ${target}: the cases in Rust do not run`,
    );
    return undefined;
  }
  const library = await compileRust(folder, rustc!, crate, "toy.rs", { target });
  return { objects: ["feature_code", "embedder", "main"], inputs: [library], linkFlags: [printfLibrary] };
}

describeLink("each stub", () => {
  test("from the C++ header behaves as its kind specifies", async () => {
    using dir = tempDir("trim-coff-stubs", { ...sources, "spellings.cpp": spellingsSource });
    const folder = String(dir);
    const program = await linked(folder, {
      objects: ["feature_code", "embedder", "spellings"],
      linkFlags: [printfLibrary],
    });
    const { executable, trimmedExecutable, featuresOf, programResult, trimmedResult } = program;
    const listedStubs = entryPointsText(folder, output)
      .split(foldedEntryPointsHeading)[0]!
      .trimEnd()
      .split("\n")
      .map(line => line.split(" ")[1]!);
    expect([...new Set(listedStubs)].sort()).toEqual(spellingsStubs);
    expect(spellingsEntryPoints.map(featuresOf)).toEqual(spellingsEntryPoints.map(() => [Extra]));
    const retained = [...spellingsGuardFunctions, "main", "replacement"];
    expect(retained.map(featuresOf)).toEqual(retained.map(() => undefined));
    if (programResult && trimmedResult) {
      expect(programResult.stdout.trim()).toBe(wholeSpellingsOutput);
      expect(trimmedResult.stdout.trim()).toBe(trimmedSpellingsOutput);
      expect(await exitCodeOf(folder, "trimmed.exe", ["abort"])).toBe(70);
    }
    expect(() => trimExecutable(trimmedExecutable, join(folder, "again.exe"), [Extra])).toThrow("(AlreadyTrimmed)");
    expect(() => trimExecutable(executable, join(folder, "again.exe"), ["NoSuchFeature"])).toThrow(
      `unknown feature "NoSuchFeature"`,
    );
  });

  test("from the Rust crate behaves as its kind specifies", async () => {
    using dir = tempDir("trim-coff-rust", rustFiles(rustSource));
    const folder = String(dir);
    const options = await compileRustInputs(folder);
    if (options === undefined) return;
    const { executable, symbols, featuresAt, programResult, trimmedResult } = await linked(folder, options);
    expect(readPe(executable).sections.filter(({ name }) => name === ".bunfeat")).toHaveLength(1);
    for (const name of ["rust_aborts", "rust_defaults", "rust_throws"]) {
      const symbol = symbols.find(([symbol]) => symbol.includes(name));
      expect(symbol).toBeDefined();
      expect(featuresAt(symbol![1])).toEqual([Extra]);
    }
    if (programResult === undefined || trimmedResult === undefined) return;
    expect(programResult.stdout.trim()).toBe("1 1 7 0 0");
    expect(trimmedResult.stdout.trim()).toBe("0 0 0 1 1");
    expect([
      await exitCodeOf(folder, "trimmed.exe", ["a"]),
      await exitCodeOf(folder, "trimmed.exe", ["a", "b"]),
    ]).toEqual([70, 70]);
  });
});

const inlineGuardFiles = {
  ...sources,
  "guarded.h": `#pragma once
#include "toy.h"
extern "C" int entered(int);
inline int guarded(int x) { return ${guard(Extra, "Abort", "entered")}(x); }
`,
  "main.cpp": `#include "guarded.h"
extern "C" int second(int);
int main(int argc, char**) { return argc > 5 ? (guarded(argc) + second(argc)) & 63 : 0; }
`,
  "second.cpp": `#include "guarded.h"
extern "C" int second(int x) { return guarded(x); }
extern "C" int unreferenced(int x) { return ${guard(Extra, "Abort", "entered")}(x); }
`,
};
const inlineGuardFlags = ["-O0", "-fno-inline", "-fno-addrsig"];
const inlineGuardOptions: LinkOptions = {
  objects: [...guardObjects, "second"],
  compileFlags: { main: inlineGuardFlags, second: inlineGuardFlags },
};

describeLink("two features", () => {
  const objects = ["feature_code", "entry", "other", "embedder", "main"];

  test("record a requirement when one calls the other's entry point directly", async () => {
    using dir = tempDir("trim-coff-requires", {
      ...sources,
      "entry.c": entryCalling("entry_of_other"),
      "other.c": otherSource,
      "main.cpp": guardsBoth,
    });
    const folder = String(dir);
    const { table, featuresOf } = await linked(folder, { objects });
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "Reference", isFollowed: true },
    ]);
    expect(readFileSync(join(folder, `${output}.trim`, "requires.txt"), "utf8")).toStartWith(
      `${Extra} requires ${Other}: 1 references`,
    );
    expect(featuresOf("entry_of_other")).toEqual([Other]);
  });

  test("record a guard in place of a requirement when the call is guarded", async () => {
    using dir = tempDir("trim-coff-guarded-call", {
      ...sources,
      "guarding.cpp": `#include "toy.h"
extern "C" { int feature_code(int); int entry_of_other(int); }
extern "C" int entered(int x) { return feature_code(x) * 3 + ${guard(Other, "Abort", "entry_of_other")}(x + 1); }
`,
      "other.c": otherSource,
      "main.cpp": guardsBoth,
    });
    const folder = String(dir);
    const program = await linked(folder, {
      objects: ["feature_code", "guarding", "other", "embedder", "main"],
      removed: [Other],
    });
    expect(program.table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: true },
    ]);
    expect(readFileSync(join(folder, `${output}.trim`, "requires.txt"), "utf8")).toBe(
      `${Extra} enters ${Other}: aborting guard\n`,
    );
    expectCleanRuns(program);
  });

  test("of which JavaScript enters the first as a built-in, whose code enters the second, link only when the built-in declares both uses", async () => {
    using dir = tempDir("trim-coff-builtin", { ...sources, ...builtinEnteringOtherSources });
    const folder = String(dir);
    const both = [builtinUsing(spelledBuiltin, "toy.extra", Extra, Other)];
    const { table, featuresOf } = await linked(folder, { objects: builtinEnteringOtherObjects, builtins: both });
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: false },
    ]);
    expect(["entered_as_builtin", "entry_of_other"].map(featuresOf)).toEqual([[Extra], [Other]]);
    const one = [builtinUsing(spelledBuiltin, "toy.extra", Extra)];
    expectLinkFailure(folder, output, await wrapped(folder, { objects: builtinEnteringOtherObjects, builtins: one }), [
      "UndeclaredUse: toy.extra (entered_as_builtin (guarding.obj, ",
      `reaches a guard of ${Other}, and its table entry has no "uses ${Other}"`,
    ]);
  });

  test("with equal entry points fold into one body, removed only with both", async () => {
    const equalEntry = (name: string) =>
      `int ${name}(int x) { for (int i = 0; i < 5; i++) x += feature_code(x + i) * 3 + feature_code(x ^ i); return x; }`;
    using dir = tempDir("trim-coff-folded", {
      ...sources,
      "entry.c": `int feature_code(int); ${equalEntry("entered")} ${equalEntry("entry_of_other")}`,
      "main.cpp": `#include "toy.h"
extern "C" { int entered(int); int entry_of_other(int); }
int main(int argc, char**) {
  if (argc == 2) return ${guard(Extra, "Abort", "entered")}(argc) & 63;
  if (argc == 3) return ${guard(Other, "Abort", "entry_of_other")}(argc) & 63;
  return 0;
}
`,
    });
    const folder = String(dir);
    const { executable, table, addressOf, featuresOf, retainedAddresses, programResult } = await linked(folder, {
      objects: guardObjects,
    });
    expect(addressOf("entered")).toBe(addressOf("entry_of_other"));
    expect(featuresOf("entered")).toEqual(byIndex(Extra, Other));
    const withoutBoth = "without-both.exe";
    trimExecutable(executable, join(folder, withoutBoth), [Extra, Other]);
    expectSoundPe({ folder, table, removed: [Extra, Other], retainedAddresses, trimmedName: withoutBoth });
    if (programResult === undefined) return;
    const exitCodes = async (name: string) => [
      await exitCodeOf(folder, name, ["a"]),
      await exitCodeOf(folder, name, ["a", "b"]),
    ];
    const originalCodes = await exitCodes(output);
    expect(originalCodes).not.toContain(70);
    expect(await exitCodes("trimmed.exe")).toEqual([70, originalCodes[1]!]);
    expect(await exitCodes(withoutBoth)).toEqual([70, 70]);
  });

  test("a guard in the copy of an inline function the linker dropped does not stop the cut", async () => {
    using dir = tempDir("trim-coff-inline-guard", inlineGuardFiles);
    const program = await linked(String(dir), inlineGuardOptions);
    expect(["entered", "feature_code"].map(program.featuresOf)).toEqual([[Extra], [Extra]]);
    expectCleanRuns(program);
  });
});

function readLink(folder: string) {
  const pathOf = (name: string) => join(folder, name);
  return readCoffGraph({
    executable: pathOf(output),
    chunkMap: pathOf("program.lldmap"),
    symbolMap: pathOf("program.map"),
    inputs: readFileSync(pathOf("in.rsp"), "utf8")
      .split("\n")
      .filter(line => line !== ""),
    libraryFolders: libraryFolders("x64"),
    alternateNames: [],
  });
}

describeLink("the reader of lld-link's maps", () => {
  test("reads a good link and makes the entry point a root", async () => {
    using dir = tempDir("trim-coff-reader", sources);
    const folder = String(dir);
    await plainLink(folder);
    const { graph, failures } = readLink(folder);
    expect(failures).toEqual([]);
    const node = nodeAt(graph, readPe(join(folder, output)).entryPoint);
    expect(node).toBeGreaterThanOrEqual(0);
    expect(graph.isRoot[node]).toBe(1);
  });

  test("resolves a dropped copy's record to the selected copy, counts a dead guard, and creates no node for a record", async () => {
    using dir = tempDir("trim-coff-records", inlineGuardFiles);
    const folder = String(dir);
    const command = await plainLink(folder, inlineGuardOptions);
    const reading = readLink(folder);
    const { entryPoints, failures, statistics } = readEntryPoints(reading, model);
    expect(failures).toEqual([]);
    expect(statistics).toEqual({
      records: 3,
      deadGuards: 1,
      guardsInsideEntryPoint: 0,
      definitions: 0,
      guardsOfEmptyEntryPoints: 0,
    });
    expect(entryPoints).toHaveLength(1);
    if (objcopy === null)
      return skipNotice(testFile, "llvm-objcopy is not on PATH: the link without records does not run");
    for (const name of inlineGuardOptions.objects!) {
      expect((await run([objcopy, `--remove-section=${coffRecordSectionName}`, `${name}.obj`], folder)).exitCode).toBe(
        0,
      );
    }
    expect((await run(command, folder)).exitCode).toBe(0);
    const withoutRecords = readLink(folder);
    expect(withoutRecords.recordSections).toEqual([]);
    expect(withoutRecords.graph.count).toBe(reading.graph.count);
  });

  test("marks an exported function as exported, not as a root", async () => {
    using dir = tempDir("trim-coff-exported", { ...sources, "exported.c": exportedSource });
    const folder = String(dir);
    await plainLink(folder, { objects: [...defaultObjects, "exported"], linkFlags: ["/export:exported_function"] });
    const { graph } = readLink(folder);
    const { symbols } = namedBytesOfPe(join(folder, output), join(folder, "program.map"));
    const node = nodeAt(graph, symbols.find(([name]) => name === "exported_function")![1]);
    expect({ isExported: graph.isExported[node], isRoot: graph.isRoot[node] }).toEqual({ isExported: 1, isRoot: 0 });
  });

  test("reports a reference to a name the symbol map does not list", async () => {
    using dir = tempDir("trim-coff-unresolved", {
      ...sources,
      "main.cpp": mainSource("int feature_code_7(int);", "feature_code_7(argc) & 0"),
    });
    const folder = String(dir);
    await plainLink(folder, { objects: guardObjects });
    const symbolMap = join(folder, "program.map");
    const lines = readFileSync(symbolMap, "latin1").split("\n");
    writeFileSync(symbolMap, lines.filter(line => !line.split(/\s+/).includes("feature_code_7")).join("\n"), "latin1");
    expect(readLink(folder).failures).toContainEqual(
      expect.objectContaining({ kind: "UnresolvedReference", target: "feature_code_7" }),
    );
  });

  test("does not report a name that only sections outside the image refer to", async () => {
    using dir = tempDir("trim-coff-collected", {
      ...sources,
      "tables.c": String.raw`
        int collected_callee(int);
        int collected_first(int x) { return collected_callee(x); }
        int collected_second(int x) { return x + 2; }
        int collected_third(int x) { return x + 3; }
        __asm__(
          ".section .rdata,\"dr\"\n.p2align 3\n.quad 1, 2, 3\n"
          ".section .rdata,\"dr\",discard,collected_table\n.globl collected_table\n.p2align 3\n"
          "collected_table:\n.quad collected_first, collected_second, collected_third\n"
          ".text\n");
      `,
      "callee.c": `int collected_callee(int x) { return x * 9; }`,
    });
    const folder = String(dir);
    const countSymbolsOutsideGraph = async (objects: string[]) => {
      await plainLink(folder, { objects });
      const { failures, statistics } = readLink(folder);
      expect(failures).toEqual([]);
      return statistics.symbolsOutsideGraph!;
    };
    const withoutTables = await countSymbolsOutsideGraph([...defaultObjects, "callee"]);
    expect(await countSymbolsOutsideGraph([...defaultObjects, "callee", "tables"])).toBeGreaterThan(withoutTables);
    expect(readFileSync(join(folder, "program.lldmap"), "latin1")).toMatch(
      /^[0-9a-f]{8} 00000018 .*tables\.obj:\(\.rdata\)\r?$/m,
    );
    const listedNames = new Set(
      namedBytesOfPe(join(folder, output), join(folder, "program.map")).symbols.map(([name]) => name),
    );
    expect(["collected_table", "collected_first", "collected_callee"].filter(name => listedNames.has(name))).toEqual(
      [],
    );
  });

  test("reports an object deleted after the link", async () => {
    using dir = tempDir("trim-coff-deleted", {
      ...sources,
      "entry.c": entryCalling("more"),
      "more.c": foldedFunction.more,
      "main.cpp": mainSource(foldedFunction.declarations, foldedFunction.result),
    });
    const folder = String(dir);
    await plainLink(folder, { objects: moreObjects });
    rmSync(join(folder, "more.obj"));
    expect(readLink(folder).failures).toContainEqual({
      kind: "UnreadInput",
      object: join(folder, "more.obj"),
      reason: "NotFound",
    });
  });

  test("reports two archive members with the same name", async () => {
    using dir = tempDir("trim-coff-ambiguous", {
      ...sources,
      "a/same.c": `int from_a(int x) { return x + 1; }`,
      "b/same.c": `int from_b(int x) { return x + 2; }`,
      "main.cpp": mainSource("int from_a(int); int from_b(int);", "from_a(argc) + from_b(argc) == 5 ? 0 : 1"),
    });
    const folder = String(dir);
    await plainLink(folder, {
      objects: [...guardObjects, "a/same", "b/same"],
      archives: { "a/shelf.lib": ["a/same"], "b/shelf.lib": ["b/same"] },
    });
    expect(readLink(folder).failures).toContainEqual(
      expect.objectContaining({ kind: "UnreadInput", reason: "AmbiguousArchiveMember" }),
    );
  });

  test("cannot write a table into an executable without the section reserved for it", async () => {
    using dir = tempDir("trim-coff-no-section", sources);
    const folder = String(dir);
    const command = await plainLink(folder);
    const { features, builtinUses } = writeLinkInputs(folder);
    const arguments_ = parseArguments([
      "bun",
      "link.ts",
      join(folder, "work"),
      features,
      builtinUses,
      "--",
      ...command,
    ]);
    expect(() => coff(createLinker(arguments_).linker).writeTable(Buffer.alloc(8))).toThrow(BuildError);
  });
});

describeLink("the link fails", () => {
  test("on retained code that calls an entry point without its guard", async () => {
    using dir = tempDir("trim-coff-fails", {
      ...sources,
      "main.cpp": mainSource(
        "NEVER_INLINE int calls_directly(int x) { return entered(x); }",
        "calls_directly(argc) & 0",
      ),
    });
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder, { objects: guardObjects }), [
      "EntryPointReferencedByRetainedCode",
      "calls_directly",
      "entered",
      "main",
    ]);
  });

  test("on retained code that calls an entry point by a name the link command defines", async () => {
    using dir = tempDir("trim-coff-fails", {
      ...sources,
      "main.cpp": mainSource(
        "int another_name(int); NEVER_INLINE int calls_alias(int x) { return another_name(x); }",
        "calls_alias(argc) & 0",
      ),
    });
    const folder = String(dir);
    const linkResult = await wrapped(folder, {
      objects: guardObjects,
      linkFlags: ["/alternatename:another_name=entered"],
    });
    expectLinkFailure(folder, output, linkResult, ["EntryPointReferencedByRetainedCode", "calls_alias", "entered"]);
  });

  test("on an entry point that runs before main", async () => {
    using dir = tempDir("trim-coff-fails", {
      ...sources,
      "entry.c": `${sources["entry.c"]}static int seed; __attribute__((constructor)) void entered_early(void) { seed = feature_code(1); }\n`,
      "main.cpp": `#include "toy.h"
extern "C" void entered_early(void);
int main(int argc, char**) { if (argc > 5) ${guard(Extra, "ReturnDefault", "entered_early")}(); return 0; }
`,
    });
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder, { objects: guardObjects }), [
      "EntryPointReferencedByRetainedCode",
      ".CRT$XCU",
      "entered_early",
    ]);
  });

  test("on a Rust entry point that is always inlined", async () => {
    const alwaysInlined = rustSource.replace("#[inline(never)]\nfn rust_aborts", "#[inline(always)]\nfn rust_aborts");
    expect(alwaysInlined).not.toBe(rustSource);
    using dir = tempDir("trim-coff-fails", rustFiles(alwaysInlined));
    const folder = String(dir);
    const options = await compileRustInputs(folder);
    if (options !== undefined)
      expectLinkFailure(folder, output, await wrapped(folder, options), ["GuardWithoutReference"]);
  });

  test("on a feature below its minimum size, and names what retains the rest", async () => {
    using dir = tempDir("trim-coff-fails", { ...sources, "main.cpp": mainCallingFeatureCode5 });
    const folder = String(dir);
    const linkResult = await wrapped(folder, { objects: guardObjects, minimums: { [Extra]: 1_000_000 } });
    expectLinkFailure(folder, output, linkResult, ["FeatureBelowMinimum", "feature_code_5", "main"]);
  });

  test("on a record written with 32-bit image-relative words", async () => {
    const record = String.raw`__asm__(".section ${coffRecordSectionName},\"yn\"\n.rva main\n.long 0\n.rva entered\n.long 0\n.short ${indexOf(Extra)}\n.byte 0\n.zero 5\n.text\n");`;
    using dir = tempDir("trim-coff-fails", { ...sources, "main.cpp": `${sources["main.cpp"]}\n${record}\n` });
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder), ["UnreadInput", "UnsupportedRelocations"]);
  });
});

describeLink("what the executable exports", () => {
  test("is removed with the features marked exports", async () => {
    using dir = tempDir("trim-coff-exports", {
      ...sources,
      "exported.c": exportedSource,
      "other.c": otherSource,
      "main.cpp": guardsBoth,
    });
    const program = await linked(String(dir), {
      objects: ["feature_code", "entry", "exported", "other", "embedder", "main"],
      linkFlags: ["/export:exported_function", "/export:entry_of_other"],
    });
    expect(exportFeatures).not.toEqual([]);
    expect(["exported_function", "entry_of_other"].map(program.featuresOf)).toEqual([
      exportFeatures,
      byIndex(Other, ...exportFeatures),
    ]);
    expectCleanRuns(program);
  });
});

describeLink("ICU's data package", () => {
  const items: [string, number][] = [
    ["icudt99l/af.res", 48],
    ["icudt99l/coll/de.res", 40],
    ["icudt99l/coll/root.res", 64],
    ["icudt99l/ibm-37_P100-1995.cnv", 5000],
    ["icudt99l/zoneinfo64.res", 33],
  ];
  const lineOf = (itemClass: string) => model.icuData.find(line => line.itemClass === itemClass)!;
  const featuresOfClass = (itemClass: string) =>
    lineOf(itemClass)
      .features.map(indexOf)
      .toSorted((a, b) => a - b);

  test("lists its items by class, but not the classes Windows always needs, and loses the items of a removed feature", async () => {
    using dir = tempDir("trim-coff-icu", {
      ...sources,
      "package.dat": packageOf(items),
      "data.c": String.raw`__asm__(".section .rdata,\"dr\"\n.balign 16\n.globl icudt99_dat\nicudt99_dat:\n.incbin \"package.dat\"\n.text\n");`,
      "main.cpp": mainSource("extern const unsigned char icudt99_dat[];", "icudt99_dat[argc + 1] == 0xda ? 0 : 1"),
    });
    const program = await linked(String(dir), {
      objects: ["feature_code", "entry", "embedder", "data", "main"],
      removed: ["IntlCollation"],
    });
    const { table, addressOf, trimmedExecutable } = program;
    expect(table.icuPackages.map(({ start }) => start)).toEqual([addressOf("icudt99_dat")]);
    const { start, end, runs } = table.icuPackages[0]!;
    expect(lineOf("locale").exceptWindows).toBe(true);
    expect(runs.map(({ firstItem, itemCount, set }) => ({ firstItem, itemCount, features: table.sets[set] }))).toEqual([
      { firstItem: 1, itemCount: 1, features: featuresOfClass("collation") },
      { firstItem: 2, itemCount: 1, features: featuresOfClass("collation-root") },
      { firstItem: 3, itemCount: 1, features: featuresOfClass("converter") },
    ]);
    const names = itemsOf(peImage(trimmedExecutable).bytes(start, end - start)!).map(({ name }) => name);
    expect(names).not.toContain("coll/de.res");
    expect(names).toContain("coll/root.res");
    expectCleanRuns(program);
  });
});
