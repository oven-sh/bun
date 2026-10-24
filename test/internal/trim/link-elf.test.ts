import { trimExecutable } from "bun:internal-for-testing";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDir } from "harness";
import { closeSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { openElf } from "../../../scripts/build/trim/elf-file.ts";
import type { FeatureName } from "../../../scripts/build/trim/features.ts";
import { classOfIcuItem, itemsOf } from "../../../scripts/build/trim/icu-data.ts";
import { elfImage } from "../../../scripts/build/trim/linked-image.ts";
import { unnamedSectionPrefix } from "../../../scripts/build/trim/linker-elf.ts";
import { foldedEntryPointsHeading } from "../../../scripts/build/trim/report.ts";
import { packageOf } from "../icu-data-package.ts";
import {
  addressInMap,
  archiver,
  canLink,
  canLinkRustBitcode,
  canUseGuardHeader,
  compileFeatureCodeOnce,
  compileObjects,
  countInTrimmed,
  createElfFormat,
  cuttableSources,
  defaultObjects,
  describeLink,
  expectRetained,
  findGuardCrate,
  guardedArguments,
  guardsBoth,
  inspectAndRun,
  isX64,
  linkByHand,
  linked,
  linkSkipReason,
  mainCallingFeatureCode5,
  mainReturning,
  objectsWithMore,
  objectsWithoutTable,
  rustc,
  sectionOf,
  sortedByIndex,
  sources,
  switchFunction,
  thinLtoFlags,
  tools,
  wrapped,
  type LinkedProgram,
} from "./link-elf-support.ts";
import {
  builtinEnteringOtherObjects,
  builtinEnteringOtherSources,
  builtinUsing,
  cleanExit,
  compileRust,
  embedderSource,
  entryCalling,
  entryGuarding,
  entryPointsText,
  exitCodeOf,
  expectCleanRuns,
  expectLinkFailure,
  exportFeatures,
  Extra,
  guardHeaderSkipReason,
  indexOf,
  mainEnteringBuiltin,
  mixingFunction,
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
  start,
  toyHeader,
  trimmedSpellingsOutput,
  wholeSpellingsOutput,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

const testFile = "link-elf.test.ts";
if (!canLink) skipNotice(testFile, linkSkipReason);
else {
  if (archiver === null) skipNotice(testFile, "llvm-ar is not on PATH: the cases with an archive do not run");
  if (!canUseGuardHeader) {
    const reason = guardHeaderSkipReason ?? "the engine's header does not compile here";
    skipNotice(testFile, `${reason}: the cases with the engine's header do not run`);
  }
  if (!isX64)
    skipNotice(
      testFile,
      "only on x86-64 does the switch of the toy get a jump table in a section of its own: the case with a section without a symbol does not run",
    );
  if (rustc === null) skipNotice(testFile, "rustc is not on PATH: the cases in Rust do not run");
  else if (!canLinkRustBitcode) {
    skipNotice(testFile, "ld.lld may be older than rustc's LLVM: the case with Rust bitcode does not run");
  }
}

compileFeatureCodeOnce();

const mergedConstant = String.raw`
  __asm__(
    ".section .rodata.cst8,\"aM\",@progbits,8\n"
    ".globl merged_constant\n"
    ".hidden merged_constant\n"
    "merged_constant: .quad 0x40934a456d5cfaad\n"
    ".text\n");
  extern const double merged_constant;
`;
const addedSectionName = new RegExp(`^${unnamedSectionPrefix}\\d+_\\d+$`);

describeLink("a trimmable link", () => {
  const objectsWithBoth = ["feature_code", "both", "entry", "table", "embedder", "main"];

  test("removes what only the entry point reaches, code and constants, and nothing retained", async () => {
    using dir = tempDir("trim-elf", cuttableSources);
    const folder = String(dir);
    const result = await linked(folder, { compilesFeatureCode: true });
    const { featuresOf, summary } = result;
    const removable = ["feature_code", "feature_code_0", "feature_code_1499", "feature_numbers"];
    expect(removable.map(featuresOf)).toEqual(removable.map(() => [Extra]));
    expectRetained(result, ["main", "retained", "Bun__abortForRemovedFeature"]);
    expectCleanRuns(result);
    expect(summary.removedBytes).toBeGreaterThan(100_000);
    expect(summary.fileBytesSaved).toBeGreaterThanOrEqual(128 * 1024);
    const sizeOf = (name: string) => statSync(join(folder, name)).size;
    expect(sizeOf("program") - sizeOf("trimmed")).toBe(summary.fileBytesSaved);
    expect(await exitCodeOf(folder, "trimmed", guardedArguments)).toBe(70);
    expect(await exitCodeOf(folder, "program", guardedArguments)).toBeLessThan(64);
  });

  test("retains a constant folded into an equal one of the feature", async () => {
    using dir = tempDir("trim-elf", sources);
    const result = await linked(String(dir));
    expect(result.addressOf("retained_table")).toBe(result.addressOf("feature_table"));
    expectRetained(result, ["retained_table"]);
    expect(result.trimmedResult.exitCode).toBe(0);
  });

  test.each([
    ["with a symbol", mergedConstant, "merged_constant"],
    ["without a symbol", "", "1234.5678"],
  ])("leaves retained code the constant it shares with the feature: %s", async (_, declaration, constant) => {
    const index = "retained_table[x & 31]";
    expect(sources["main.c"]).toContain(index);
    using dir = tempDir("trim-elf", {
      ...sources,
      "entry.c": `
        int feature_code(int);
        ${declaration}
        __attribute__((noinline)) int entered(int x) { return feature_code(x) * 3 + (int)(x * ${constant}); }
      `,
      "main.c": sources["main.c"]!.replace(index, "retained_table[(int)(x * 1234.5678) / 1234 & 31]"),
    });
    expectCleanRuns(await linked(String(dir)));
  });

  test.each([
    ["native code", []],
    ["bitcode", ["-flto=thin"]],
  ])("removes the strings and constants only the feature reads, each by itself: %s", async (_, flags) => {
    const sixteen = (text: string) => `(sixteen){ ${[...text].map(character => `'${character}'`).join(", ")} }`;
    using dir = tempDir("trim-elf", {
      ...sources,
      "both.c": `
        int puts(const char *);
        typedef char sixteen __attribute__((vector_size(16)));
        __attribute__((noinline)) int feature_says(int x) {
          return puts(x ? "a sentence of the library" : "a sentence that both say");
        }
        __attribute__((noinline)) sixteen feature_compares(sixteen x) { return x == ${sixteen("sixteen that go!")}; }
        __attribute__((noinline)) int retained_says(int x) {
          return puts(x > 1 ? "a sentence that stays" : "a sentence that both say");
        }
        __attribute__((noinline)) sixteen retained_compares(sixteen x) { return x == ${sixteen("sixteen stay on!")}; }
      `,
      "entry.c": `
        typedef char sixteen __attribute__((vector_size(16)));
        int feature_code(int);
        int feature_says(int);
        sixteen feature_compares(sixteen);
        __attribute__((noinline)) int entered(int x) {
          return feature_code(x) * 3 + feature_says(x + 1) + feature_compares((sixteen){ x })[0];
        }
      `,
      "main.c": `
        ${start}
        typedef char sixteen __attribute__((vector_size(16)));
        extern const char retained_table[62];
        int retained_says(int);
        sixteen retained_compares(sixteen);
        __attribute__((noinline)) int retained(int x) {
          return retained_table[x & 31] + retained_says(x) * 0 + retained_compares((sixteen){ x })[1];
        }
        ${mainReturning("retained(argc) == '1' ? 0 : 1")}
      `,
    });
    const folder = String(dir);
    const { trimmedResult } = await linked(folder, { objects: objectsWithBoth, compileFlags: { both: flags } });
    const removedTexts = ["a sentence of the library", "sixteen that go!"];
    const retainedTexts = ["a sentence that both say", "a sentence that stays", "sixteen stay on!"];
    expect(countInTrimmed(folder, [...removedTexts, ...retainedTexts])).toEqual([0, 0, 1, 1, 1]);
    expect(trimmedResult).toEqual({ stdout: "a sentence that both say\n", stderr: "", exitCode: 0 });
  });

  test("fills a removable variable too small to cut", async () => {
    using dir = tempDir("trim-elf", {
      ...sources,
      "both.c": `
        int puts(const char *);
        char first_retained_variable[] = "the first variable stays";
        char feature_variable[] = "a variable of the library";
        char retained_variable[] = "a variable that stays";
        __attribute__((noinline)) int feature_says(int x) { feature_variable[0] += x; return puts(feature_variable); }
        __attribute__((noinline)) int retained_says(int x) {
          first_retained_variable[0] += x;
          retained_variable[0] += x;
          return puts(first_retained_variable) + puts(retained_variable);
        }
      `,
      "entry.c": `
        int feature_code(int);
        int feature_says(int);
        __attribute__((noinline)) int entered(int x) { return feature_says(feature_code(x)) + 1; }
      `,
      "main.c": `
        ${start}
        extern const char retained_table[62];
        int retained_says(int);
        __attribute__((noinline)) int retained(int x) { return retained_table[x & 31] + retained_says(0) * 0; }
        ${mainReturning("retained(argc) == '1' ? 0 : 1")}
      `,
    });
    const folder = String(dir);
    const result = await linked(folder, { objects: objectsWithBoth });
    expect(["feature_variable", "feature_says"].map(result.featuresOf)).toEqual([[Extra], [Extra]]);
    expectRetained(result, ["retained_variable", "retained_says"]);
    const texts = ["a variable of the library", "the first variable stays", "a variable that stays"];
    expect(countInTrimmed(folder, texts)).toEqual([0, 1, 1]);
    const stdout = "the first variable stays\na variable that stays\n";
    expect(result.trimmedResult).toEqual({ stdout, stderr: "", exitCode: 0 });
    const sections = readFileSync(join(folder, "work/sections.txt"), "utf8");
    expect(sections).toMatch(/^[0-9a-f]+ 26 Atomics \.data \S*feature_variable$/m);
  });

  test("finds an entry point that the link compiles from bitcode, and deletes the compiled objects", async () => {
    using dir = tempDir("trim-elf", sources);
    const folder = String(dir);
    const result = await linked(folder, { compileFlags: { entry: thinLtoFlags, main: thinLtoFlags } });
    expect(result.featuresOf("entered")).toEqual([Extra]);
    const files = [...readdirSync(folder), ...readdirSync(join(folder, "work"))];
    expect(files.filter(name => name.includes(".lto."))).toEqual([]);
    expectCleanRuns(result);
  });

  test("takes a guard whose entry point does nothing, so that the compiler removes the call and the linker the function", async () => {
    using dir = tempDir("trim-elf", {
      ...sources,
      "main.c": `
        ${start}
        extern const char retained_table[62];
        __attribute__((noinline)) int does_nothing(int x) { return 0; }
        __attribute__((noinline)) void destroys(int x) { RECORD(Extra, does_nothing); does_nothing(x); }
        int main(int argc, char **argv) {
          destroys(argc);
          return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : retained_table[argc & 31] == '1' ? 0 : 1;
        }
      `,
    });
    const result = await linked(String(dir));
    expect(result.featuresOf("entered")).toEqual([Extra]);
    expect(() => result.featuresOf("does_nothing")).toThrow("has no symbol does_nothing");
    expectRetained(result, ["destroys"]);
    expectCleanRuns(result);
  });

  test.skipIf(archiver === null)("relinks objects compiled from bitcode in an archive", async () => {
    using dir = tempDir("trim-elf", {
      ...sources,
      "member.c": `
        static int calls;
        __attribute__((noinline)) static int counted(int x) { return x + ++calls; }
        int archive_member(int x) { return counted(x) + counted(x + 1); }
      `,
      "main.c": `
        ${start}
        extern const char retained_table[62];
        int archive_member(int);
        ${mainReturning("archive_member(argc) == 6 && retained_table[1] == '1' ? 0 : 1")}
      `,
    });
    const { featuresOf, trimmedResult } = await linked(String(dir), {
      objects: [...defaultObjects, "member"],
      compileFlags: { main: thinLtoFlags, member: thinLtoFlags },
      archived: ["member"],
    });
    expect(featuresOf("feature_code")).toEqual([Extra]);
    expect(trimmedResult).toEqual(cleanExit);
  });

  test.skipIf(!isX64)("orders a section without a symbol with its feature", async () => {
    using dir = tempDir("trim-elf", {
      ...sources,
      "entry.c": entryCalling("more"),
      "more.c": `
        volatile int seen;
        __attribute__((noinline)) int note(int value) { seen = value; return value; }
        ${switchFunction("feature_choice")}
        int more(int x) { return feature_choice(x); }
      `,
      "main.c": `${start} ${mainReturning("0")}`,
    });
    const folder = String(dir);
    const result = await linked(folder, { objects: objectsWithMore });
    const jumpTable = addressInMap(folder, "more.o", ".rodata.feature_choice");
    const orderedNames = readFileSync(join(folder, "work/order.txt"), "latin1").split("\n");
    const addedNames = orderedNames.filter(name => addedSectionName.test(name));
    expect(addedNames.map(result.addressOf)).toContain(jumpTable);
    expect(result.featuresAt(jumpTable)).toEqual([Extra]);
    expectCleanRuns(result);
  });

  test("cannot write the table into an executable without the section reserved for it", async () => {
    using dir = tempDir("trim-elf", sources);
    const folder = String(dir);
    await compileObjects(folder, defaultObjects);
    await linkByHand(folder, { name: "second", output: "hand", objects: defaultObjects });
    const { format } = createElfFormat(folder, "hand");
    expect(() => format.writeTable(Buffer.alloc(8))).toThrow("has no section .bun_trim");
  });

  test("writes the four review files and lists the entry point", async () => {
    using dir = tempDir("trim-elf", sources);
    const folder = String(dir);
    await linked(folder);
    const reviewFileNames = ["entry-points.txt", "groups.txt", "requires.txt", "retained-by.txt"];
    expect(reviewFiles(folder, "program")).toEqual(reviewFileNames);
    const lines = entryPointsText(folder, "program").split("\n");
    expect(lines.filter(line => line.startsWith(`${Extra} Abort `))).toHaveLength(1);
  });

  test("lists an entry point with a C++ name demangled", async () => {
    using dir = tempDir("trim-elf", {
      ...sources,
      "mangled.cpp": `
        extern "C" int feature_code(int);
        namespace toy { __attribute__((noinline)) int mangled_entry(int x) { return feature_code(x) * 3; } }
      `,
      "guards.cpp": `
        #include "guard.h"
        namespace toy { int mangled_entry(int); }
        int main(int argc, char **) { return argc > 5 ? GUARDED(Extra, toy::mangled_entry, argc) & 63 : 0; }
      `,
    });
    const folder = String(dir);
    const result = await linked(folder, { objects: ["feature_code", "mangled", "embedder", "guards"] });
    expect(result.featuresOf("_ZN3toy13mangled_entryEi")).toEqual([Extra]);
    const [line] = entryPointsText(folder, "program").split("\n");
    expect(line).toMatch(/^\S+ Abort \d+ toy::mangled_entry\(int\) \(mangled\.o, \d+ bytes\) <- main \(guards\.o, /);
    expectCleanRuns(result);
  });

  test("has an aligned table", async () => {
    using dir = tempDir("trim-elf", sources);
    const folder = String(dir);
    await linked(folder);
    expect(sectionOf(join(folder, "program"), ".bun_trim").address % 8).toBe(0);
  });

  test("retains the order file the command names, after its own", async () => {
    using dir = tempDir("trim-elf", { ...sources, "mine.txt": "retained\nmain\n" });
    const folder = String(dir);
    const result = await linked(folder, { linkFlags: ["-Wl,--symbol-ordering-file=mine.txt"] });
    expect(readFileSync(join(folder, "work/order.txt"), "latin1")).toEndWith("retained\nmain\n");
    expectCleanRuns(result);
  });

  test("does not reorder a retained static function that shares its name with a removable one", async () => {
    using dir = tempDir("trim-elf", {
      ...sources,
      "entry.c": entryCalling("more"),
      "more.c": `static ${mixingFunction("same_name", 3)} int more(int x) { return same_name(x); }`,
      "main.c": `${start} static ${mixingFunction("same_name", 5)} ${mainReturning("same_name(argc) == 129 ? 0 : 1")}`,
    });
    const folder = String(dir);
    const result = await linked(folder, { objects: objectsWithMore });
    const featuresIn = (object: string) => result.featuresAt(addressInMap(folder, object, ".text.same_name"));
    expect(featuresIn("main.o")).toBeUndefined();
    expect([[Extra], undefined]).toContainEqual(featuresIn("more.o"));
    expectCleanRuns(result);
  });

  test("is reproducible", async () => {
    using dir = tempDir("trim-elf", sources);
    const folder = String(dir);
    expect((await wrapped(folder)).exitCode).toBe(0);
    const first = readFileSync(join(folder, "program"));
    expect((await wrapped(folder)).exitCode).toBe(0);
    expect(readFileSync(join(folder, "program")).equals(first)).toBe(true);
  });
});

const rustMain = `
  int printf(const char *, ...);
  int rust_call_abort(int), rust_call_default(int), rust_call_or(int), rust_body_abort(int), rust_body_default(int);
  _Bool rust_is_removed(void);
  int main(int argc, char **argv) {
    if (argc == 2) return rust_call_abort(1) & 63;
    if (argc == 3) return rust_body_abort(1) & 63;
    const char *is_removed = rust_is_removed() ? "true" : "false";
    printf("%d %d,%d %d %s\\n",
      rust_call_default(1), rust_body_default(1), rust_body_default(-1), rust_call_or(1), is_removed);
    return 0;
  }
`;
const rustFiles = (toy: string) => ({
  ...sources,
  "embedder.c": embedderSource("elf", { stateFromRust: true }),
  "toy.rs": toy,
  "main.c": rustMain,
});

const endedByTrap = 128 + constants.signals.SIGTRAP;

async function wrappedRust(folder: string, isBitcode: boolean) {
  const crate = await findGuardCrate();
  expect(crate).toBeDefined();
  const archive = await compileRust(folder, rustc!, crate!, "toy.rs", { bitcode: isBitcode });
  const compileFlags: Record<string, string[]> = isBitcode ? { main: ["-flto=thin"] } : {};
  return await wrapped(folder, { objects: ["feature_code", "embedder", "main"], inputs: [archive], compileFlags });
}

describeLink("each stub", () => {
  test.skipIf(!canUseGuardHeader).each([
    ["native code", {}],
    ["bitcode", { spellings: thinLtoFlags }],
  ])(
    "of the engine's header does what its kind says, and Abort, which tests nothing at run time, lands on the traps that fill the removed range: %s",
    async (_, compileFlags) => {
      using dir = tempDir("trim-elf-stubs", { ...sources, "toy.h": toyHeader, "spellings.cpp": spellingsSource });
      const folder = String(dir);
      const objects = ["feature_code", "embedder", "spellings"];
      const linkFlags = spellingsGuardFunctions.map(name => `-Wl,--undefined=${name}`);
      const result = await linked(folder, { objects, compileFlags, linkFlags });
      expect(result.programResult.stdout).toBe(wholeSpellingsOutput + "\n");
      expect(result.trimmedResult.stdout).toBe(trimmedSpellingsOutput + "\n");
      expect(await exitCodeOf(folder, "trimmed", ["abort"])).toBe(endedByTrap);
      const removableLines = entryPointsText(folder, "program")
        .split(foldedEntryPointsHeading)[0]!
        .trimEnd()
        .split("\n");
      const listedStubs = removableLines.map(line => line.split(" ")[1]!);
      expect([...new Set(listedStubs)].sort()).toEqual(spellingsStubs);
      const symbols = (await run([tools["llvm-nm"]!, "--demangle", "program"], folder)).stdout;
      const addressOfFunction = (name: string) =>
        parseInt(new RegExp(`^([0-9a-f]+) [tT] ${name}\\(`, "m").exec(symbols)![1]!, 16);
      const featuresOfEntryPoints = spellingsEntryPoints.map(name => result.featuresAt(addressOfFunction(name)));
      expect(featuresOfEntryPoints).toEqual(spellingsEntryPoints.map(() => [Extra]));
      expectRetained(result, [...spellingsGuardFunctions, "main"]);
    },
  );

  for (const [name, isBitcode] of [
    ["native code", false],
    ["bitcode", true],
  ] as const) {
    const isSkipped = rustc === null || (isBitcode && !canLinkRustBitcode);
    test.skipIf(isSkipped)(
      `of the Rust crate does what its kind says, and Abort, which tests nothing at run time, lands on the traps that fill the removed range: ${name}`,
      async () => {
        using dir = tempDir("trim-elf-stubs", rustFiles(rustSource));
        const folder = String(dir);
        const result = await inspectAndRun(folder, await wrappedRust(folder, isBitcode));
        expect(result.programResult.stdout).toMatch(/^-?\d*[13579] -?\d*[13579],7 -?\d*[13579] false\n$/);
        expect(result.trimmedResult.stdout).toBe("0 0,0 -2 true\n");
        expect(await exitCodeOf(folder, "trimmed", ["a"])).toBe(endedByTrap);
        expect(await exitCodeOf(folder, "trimmed", ["a", "b"])).toBe(endedByTrap);
      },
    );
  }

  for (const [name, isBitcode] of [
    ["native code", false],
    ["bitcode", true],
  ] as const) {
    test.skipIf(rustc === null || (isBitcode && !canLinkRustBitcode))(
      `a body of removable_body! that does nothing, returns a constant or has a result that nobody reads is still called: ${name}`,
      async () => {
        const bodiesWithoutEffect = `${rustSource}
#[unsafe(no_mangle)]
pub extern "C" fn rust_bodies_without_effect(x: i32) -> i32 {
    let y = feature_code(x);
    removable_body!(Atomics, Abort, {});
    let constant: i32 = removable_body!(Atomics, Abort, { 5 });
    let _ = removable_body!(Atomics, Abort, { y.wrapping_add(1) });
    feature_code(y).wrapping_add(constant)
}
`;
        const main = rustMain.replace("int main(", "int rust_bodies_without_effect(int);\nint main(");
        const calling = main.replace(
          /(int main\([^)]*\) \{\n)/,
          "$1  if (argc == 9) return rust_bodies_without_effect(1) & 63;\n",
        );
        expect(calling).toContain("argc == 9");
        using dir = tempDir("trim-elf-stubs", { ...rustFiles(bodiesWithoutEffect), "main.c": calling });
        const linkResult = await wrappedRust(String(dir), isBitcode);
        expect(linkResult.stderr).toBe("");
        expect(linkResult.exitCode).toBe(0);
      },
    );
  }

  test("trimExecutable rejects an already trimmed executable, an unknown feature name and a missing file", async () => {
    using dir = tempDir("trim-elf-stubs", sources);
    const folder = String(dir);
    await linked(folder);
    const trim = (name: string, features: FeatureName[]) => () =>
      trimExecutable(join(folder, name), join(folder, "again"), features);
    expect(trim("trimmed", [Extra])).toThrow("(AlreadyTrimmed)");
    expect(trim("program", ["NoSuchFeature"])).toThrow(`unknown feature "NoSuchFeature"`);
    expect(() => trimExecutable(join(folder, "absent"), join(folder, "absent-out"), [Extra])).toThrow();
    expect(existsSync(join(folder, "absent-out"))).toBe(false);
  });
});

describeLink("two features", () => {
  const objects = ["feature_code", "entry", "other", "embedder", "main"];

  test("with equal entry points fold into one body, removed only with both", async () => {
    const largeFunction = (name: string) => `
      __attribute__((noinline)) int ${name}(int x) {
        __asm__ volatile(".rept 6000\\nnop\\n.endr");
        for (int i = 0; i < 5; i++) x += feature_code(x + i) * 3 + feature_code(x ^ i);
        return x;
      }
    `;
    using dir = tempDir("trim-elf-two", {
      ...sources,
      "more.c": `int feature_code(int); ${largeFunction("entry_of_extra")} ${largeFunction("entry_of_other")}`,
      "main.c": `
        ${start}
        int entry_of_extra(int);
        int entry_of_other(int);
        int main(int argc, char **argv) {
          if (argc == 2) return GUARDED(Extra, entry_of_extra, argc) & 63;
          if (argc == 3) return GUARDED(Other, entry_of_other, argc) & 63;
          return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : 0;
        }
      `,
    });
    const folder = String(dir);
    const { addressOf, featuresOf } = await linked(folder, { objects: objectsWithMore });
    expect(addressOf("entry_of_extra")).toBe(addressOf("entry_of_other"));
    expect(featuresOf("entry_of_extra")).toEqual(sortedByIndex(Extra, Other));
    trimExecutable(join(folder, "program"), join(folder, "without-both"), [Extra, Other]);
    const exitCodesOf = async (name: string) => [
      await exitCodeOf(folder, name, ["a"]),
      await exitCodeOf(folder, name, ["a", "b"]),
    ];
    const whole = await exitCodesOf("program");
    expect(whole.filter(code => code >= 64)).toEqual([]);
    expect(await exitCodesOf("trimmed")).toEqual([70, whole[1]!]);
    expect(await exitCodesOf("without-both")).toEqual([70, 70]);
  });

  test("record a requirement when one calls the other's entry point directly", async () => {
    using dir = tempDir("trim-elf-two", {
      ...sources,
      "entry.c": entryCalling("entry_of_other"),
      "other.c": otherSource,
      "main.c": guardsBoth,
    });
    const folder = String(dir);
    const { table, featuresOf } = await linked(folder, { objects });
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "Reference", isFollowed: true },
    ]);
    const requiresText = readFileSync(join(folder, "program.trim/requires.txt"), "utf8");
    expect(requiresText).toStartWith(`${Extra} requires ${Other}: 1 references`);
    expect(featuresOf("entry_of_other")).toEqual([Other]);
  });

  test("record a guard in place of a requirement when the call is guarded", async () => {
    using dir = tempDir("trim-elf-two", {
      ...sources,
      "entry.c": entryGuarding("Other", "entry_of_other"),
      "other.c": otherSource,
      "main.c": guardsBoth,
    });
    const folder = String(dir);
    const { table, trimmedResult } = await linked(folder, { objects, removed: [Other] });
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: true },
    ]);
    expect(readFileSync(join(folder, "program.trim/requires.txt"), "utf8")).toBe(
      `${Extra} enters ${Other}: aborting guard\n`,
    );
    expect(trimmedResult.exitCode).toBe(0);
  });

  describe("of which JavaScript enters the first as a built-in, whose code enters the second", () => {
    const files = {
      ...sources,
      "entry.c": entryGuarding("Other", "entry_of_other"),
      "other.c": otherSource,
      "main.c": mainEnteringBuiltin(spelledBuiltin),
    };

    test("link when the built-in declares both uses, and the table answers for the edge", async () => {
      using dir = tempDir("trim-elf-two", files);
      const builtins = [builtinUsing(spelledBuiltin, "toy.extra", Extra, Other)];
      const { table, featuresOf } = await linked(String(dir), { objects, builtins });
      expect(table.edges).toEqual([
        { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: false },
      ]);
      expect(featuresOf("entered")).toEqual([Extra]);
      expect(featuresOf("entry_of_other")).toEqual([Other]);
    });

    test("fail the link when the built-in does not declare the second use", async () => {
      using dir = tempDir("trim-elf-two", files);
      const folder = String(dir);
      const builtins = [builtinUsing(spelledBuiltin, "toy.extra", Extra)];
      expectLinkFailure(folder, "program", await wrapped(folder, { objects, builtins }), [
        "UndeclaredUse: toy.extra (entered (entry.o, ",
        `reaches a guard of ${Other}, and its table entry has no "uses ${Other}"`,
        "\n      -> entry_of_other (other.o, ",
      ]);
    });

    test.skipIf(!canUseGuardHeader)("do both with the guards of the engine's header", async () => {
      const { "main.c": _, ...withoutMain } = sources;
      using dir = tempDir("trim-elf-two", { ...withoutMain, ...builtinEnteringOtherSources });
      const folder = String(dir);
      const both = [builtinUsing(spelledBuiltin, "toy.extra", Extra, Other)];
      const { table, featuresOf } = await linked(folder, { objects: builtinEnteringOtherObjects, builtins: both });
      expect(table.edges).toEqual([
        { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: false },
      ]);
      expect(["entered_as_builtin", "entry_of_other"].map(featuresOf)).toEqual([[Extra], [Other]]);
      const one = [builtinUsing(spelledBuiltin, "toy.extra", Extra)];
      expectLinkFailure(
        folder,
        "program",
        await wrapped(folder, { objects: builtinEnteringOtherObjects, builtins: one }),
        [
          "UndeclaredUse: toy.extra (entered_as_builtin (guarding.o, ",
          `reaches a guard of ${Other}, and its table entry has no "uses ${Other}"`,
        ],
      );
    });

    test("fail the link when the table does not list the built-in", async () => {
      using dir = tempDir("trim-elf-two", files);
      const folder = String(dir);
      const builtins = [builtinUsing(spelledBuiltin + 1, "toy.extra", Extra, Other)];
      expectLinkFailure(folder, "program", await wrapped(folder, { objects, builtins }), [
        "GuardOfUnknownBuiltin: the guard in main (main.o, ",
        `as built-in ${spelledBuiltin}, which builtin-uses.json does not list`,
      ]);
    });

    test("fail the link when nothing can ever mark a guarded feature as used", async () => {
      using dir = tempDir("trim-elf-two", { ...sources });
      const folder = String(dir);
      expectLinkFailure(folder, "program", await wrapped(folder, { builtins: [] }), [
        "GuardWithoutUser: main (main.o, ",
        `an entry point of ${Extra}, and no table entry uses ${Extra} and no feature's code enters it`,
      ]);
    });
  });

  test("a guard in the copy of an inline function the linker dropped is dead", async () => {
    using dir = tempDir("trim-elf-two", {
      ...sources,
      "guarded.h": `
        #include "guard.h"
        extern "C" int entered(int);
        inline __attribute__((noinline)) int guarded_inline(int x) { return GUARDED(Extra, entered, x); }
      `,
      "first.cpp": `
        #include "guarded.h"
        extern "C" int second(int);
        int main(int argc, char **) { return argc > 5 ? (guarded_inline(argc) + second(argc)) & 63 : 0; }
      `,
      "second.cpp": `
        #include "guarded.h"
        extern "C" int second(int x) { return guarded_inline(x); }
      `,
    });
    const folder = String(dir);
    const result = await linked(folder, { objects: ["feature_code", "entry", "embedder", "first", "second"] });
    expect(result.linkOutput).toMatch(/\b1 dead guards?\b/);
    expect(result.featuresOf("feature_code")).toEqual([Extra]);
    expectCleanRuns(result);
    expect(await exitCodeOf(folder, "trimmed", guardedArguments)).toBe(70);
  });

  test("an entry point folded with a retained function stays, with what only it reaches", async () => {
    const loopingFunction = (name: string) => `
      __attribute__((noinline)) int ${name}(int x) {
        for (int i = 0; i < 5; i++) x = x * 7 + i;
        return folded_entry_callee(x) & 0xffff;
      }
    `;
    using dir = tempDir("trim-elf-two", {
      ...sources,
      "deeper.c": mixingFunction("folded_entry_callee", 5),
      "more.c": `int folded_entry_callee(int); ${loopingFunction("folded_entry")}`,
      "main.c": `
        ${start}
        int folded_entry_callee(int);
        int folded_entry(int);
        ${loopingFunction("equal_to_entry")}
        int main(int argc, char **argv) {
          if (argc > 6) return GUARDED(Extra, folded_entry, argc) & 63;
          return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : equal_to_entry(argc) < 0x10000 ? 0 : 1;
        }
      `,
    });
    const folder = String(dir);
    const result = await linked(folder, { objects: ["feature_code", "entry", "deeper", "embedder", "more", "main"] });
    expect(result.addressOf("folded_entry")).toBe(result.addressOf("equal_to_entry"));
    expectRetained(result, ["folded_entry", "folded_entry_callee"]);
    expect(result.featuresOf("feature_code_0")).toEqual([Extra]);
    expect(entryPointsText(folder, "program").split(foldedEntryPointsHeading)[1]).toContain("folded_entry");
    expectCleanRuns(result);
  });
});

describeLink("a table in data that holds the address of a built-in's C function", () => {
  const builtins = [{ ...builtinUsing(spelledBuiltin, "toy.extra", Extra), nativeSymbols: ["entered"] }];
  const objects = ["feature_code", "entry", "natives", "embedder", "main"];
  const natives = `int entered(int); int (*const natives[1])(int) = { entered };`;
  const mainCalling = (otherwise: string) => `
    ${start}
    extern int (*const natives[1])(int);
    int main(int argc, char **argv) {
      return argc > 6 && !Bun__removableFeatureState.removal[Extra] ? natives[argc - 7](argc) & 63 : ${otherwise};
    }
  `;

  test.each([
    ["alone", "0"],
    ["beside a guard in code", `argc > 5 ? GUARDED_BUILTIN(Extra, ${spelledBuiltin}, entered, argc) & 63 : 0`],
  ])("guards it, %s", async (_, otherwise) => {
    using dir = tempDir("trim-elf-table", { ...sources, "natives.c": natives, "main.c": mainCalling(otherwise) });
    const folder = String(dir);
    const result = await linked(folder, { objects, builtins });
    expect(["entered", "feature_code", "natives"].map(result.featuresOf)).toEqual([[Extra], [Extra], undefined]);
    expect(entryPointsText(folder, "program")).toMatch(/ entered \(entry\.o, \d+ bytes\) <- natives \(natives\.o, /);
    expectCleanRuns(result);
  });
});

describeLink("the link fails", () => {
  test("on retained code that calls an entry point without its guard", async () => {
    using dir = tempDir("trim-elf-fails", {
      ...sources,
      "main.c": `
        ${start}
        __attribute__((noinline)) int calls_directly(int x) { return entered(x); }
        ${mainReturning("argc > 4 ? calls_directly(argc) : 0")}
      `,
    });
    const folder = String(dir);
    const texts = ["EntryPointReferencedByRetainedCode", "calls_directly", "entered", "main"];
    expectLinkFailure(folder, "program", await wrapped(folder, { objects: objectsWithoutTable }), texts);
  });

  test("on retained code that calls an entry point by an alias", async () => {
    using dir = tempDir("trim-elf-fails", {
      ...sources,
      "more.c": `
        ${mixingFunction("shared_entry_callee", 3)}
        __attribute__((noinline)) int shared_entry(int x) {
          for (int i = 0; i < 5; i++) x = x * 7 + i;
          return shared_entry_callee(x) & 0xffff;
        }
        int another_name(int) __attribute__((alias("shared_entry")));
      `,
      "main.c": `
        ${start}
        int shared_entry(int);
        int another_name(int);
        __attribute__((noinline)) int calls_alias(int x) { return another_name(x); }
        int main(int argc, char **argv) {
          if (argc > 6) return GUARDED(Extra, shared_entry, argc) & 63;
          return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : calls_alias(argc) < 0x10000 ? 0 : 1;
        }
      `,
    });
    const folder = String(dir);
    const texts = ["EntryPointReferencedByRetainedCode", "calls_alias"];
    expectLinkFailure(folder, "program", await wrapped(folder, { objects: objectsWithMore }), texts);
  });

  test("on an entry point that runs before main", async () => {
    using dir = tempDir("trim-elf-fails", {
      ...sources,
      "entry.c": entryCalling("more"),
      "more.c": `
        int early_value;
        static volatile int seed = 5;
        ${mixingFunction("feature_early", 5)}
        __attribute__((constructor, noinline)) void early(void) {
          for (int i = 0; i < 5; i++) early_value += feature_early(seed + i);
        }
        int more(int x) { return feature_early(x); }
      `,
      "main.c": `
        ${start}
        void early(void);
        extern int early_value;
        int main(int argc, char **argv) {
          if (argc > 6) GUARDED(Extra, early);
          return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : early_value != 0 ? 0 : 1;
        }
      `,
    });
    const folder = String(dir);
    const texts = ["EntryPointReferencedByRetainedCode", "early"];
    expectLinkFailure(folder, "program", await wrapped(folder, { objects: objectsWithMore }), texts);
  });

  test("on an entry point the compiler inlined into its guard", async () => {
    using dir = tempDir("trim-elf-fails", {
      ...sources,
      "entry.c": `int feature_code(int); int entered(int x) { return feature_code(x) * 3 + feature_code(x + 1); }`,
    });
    const folder = String(dir);
    const linkResult = await wrapped(folder, { compileFlags: { entry: thinLtoFlags, main: thinLtoFlags } });
    expectLinkFailure(folder, "program", linkResult, ["GuardWithoutReference", "entered"]);
  });

  test.skipIf(rustc === null)("on a Rust entry point that is always inlined", async () => {
    const neverInlined = "#[inline(never)]\nfn rust_aborts";
    expect(rustSource).toContain(neverInlined);
    const alwaysInlined = rustSource.replace(neverInlined, "#[inline(always)]\nfn rust_aborts");
    using dir = tempDir("trim-elf-fails", rustFiles(alwaysInlined));
    const folder = String(dir);
    expectLinkFailure(folder, "program", await wrappedRust(folder, false), ["GuardWithoutReference"]);
  });

  test("on a record whose guard site has no reference to the entry point", async () => {
    using dir = tempDir("trim-elf-fails", {
      ...sources,
      "record.c": `
        #include "guard.h"
        __attribute__((noinline)) int unrelated(int x) {
          __asm__ volatile(
            "771:\\n" RECORDS ".p2align 3\\n.quad 771b\\n.quad entered\\n"
            ".short %c0\\n.byte 0\\n.space 5\\n.popsection\\n"
            : : "i"(Extra));
          return x + 1;
        }
      `,
      "main.c": `
        ${start}
        int unrelated(int);
        ${mainReturning("unrelated(argc) == 2 ? 0 : 1")}
      `,
    });
    const folder = String(dir);
    const linkResult = await wrapped(folder, { objects: ["feature_code", "entry", "record", "embedder", "main"] });
    expectLinkFailure(folder, "program", linkResult, ["GuardWithoutReference", "unrelated", "entered"]);
  });

  test("on a feature below its minimum size, and names what retains the rest", async () => {
    using dir = tempDir("trim-elf-fails", { ...sources, "main.c": mainCallingFeatureCode5 });
    const folder = String(dir);
    const linkResult = await wrapped(folder, { objects: objectsWithoutTable, minimums: { [Extra]: 1_000_000 } });
    expectLinkFailure(folder, "program", linkResult, ["FeatureBelowMinimum"]);
    const chain = /feature_code_5 \(feature_code\.o, \d+ bytes\)\n\s+<- main \(main\.o, \d+ bytes\)/;
    expect(linkResult.stderr).toMatch(chain);
  });

  test("on an unsupported relocation format (CREL)", async () => {
    using dir = tempDir("trim-elf-fails", sources);
    const folder = String(dir);
    const linkResult = await wrapped(folder, { compileFlags: { main: ["-Wa,--crel,--allow-experimental-crel"] } });
    expectLinkFailure(folder, "program", linkResult, ["UnreadInput", "UnsupportedRelocations"]);
  });
});

describeLink("what the executable exports", () => {
  test("assigns exported symbols to export features", async () => {
    using dir = tempDir("trim-elf-exports", {
      ...sources,
      "more.c": `
        ${mixingFunction("exported_callee", 3)}
        __attribute__((noinline)) int exported_function(int x) {
          for (int i = 0; i < 5; i++) x = x * 7 + i;
          return exported_callee(x);
        }
        __attribute__((noinline)) int entry_of_other(int x) { for (int i = 0; i < 5; i++) x = x * 11 + i; return x; }
      `,
      "main.c": guardsBoth,
    });
    const linkFlags = ["-Wl,--export-dynamic-symbol=exported_function", "-Wl,--export-dynamic-symbol=entry_of_other"];
    const { featuresOf, trimmedResult } = await linked(String(dir), { objects: objectsWithMore, linkFlags });
    expect(["exported_function", "exported_callee"].map(featuresOf)).toEqual([exportFeatures, exportFeatures]);
    expect(featuresOf("entry_of_other")).toEqual(sortedByIndex(Other, ...exportFeatures));
    expect(trimmedResult.exitCode).toBe(0);
  });
});

describeLink("ICU's data package", () => {
  const items: [path: string, size: number][] = [
    ["icudt99l/af.res", 48],
    ["icudt99l/coll/de.res", 40],
    ["icudt99l/coll/root.res", 64],
    ["icudt99l/ibm-37_P100-1995.cnv", 5000],
    ["icudt99l/nothing-knows-this.bin", 33],
  ];
  const objects = ["feature_code", "entry", "embedder", "data", "main"];
  const dataFiles = (afterPackage: string) => ({
    ...sources,
    "package.dat": packageOf(items),
    "data.c": `
      __asm__(
        ".section .rodata\\n.balign 16\\n.globl icudt99_dat\\nicudt99_dat:\\n.incbin \\"package.dat\\"\\n"
        "${afterPackage}.text\\n");
    `,
    "main.c": `
      ${start}
      extern const unsigned char icudt99_dat[];
      ${mainReturning("icudt99_dat[argc + 1] == 0xda ? 0 : 1")}
    `,
  });
  const readersOf = (name: string) => {
    const itemClass = classOfIcuItem(name);
    const features = model.icuData.find(line => line.itemClass === itemClass)?.features ?? [];
    return features.map(indexOf).toSorted((a, b) => a - b);
  };
  const extentsOf = ({ table }: LinkedProgram) => table.icuPackages.map(({ start, end }) => ({ start, end }));

  test("ends at the next name in its section and lists its items by the features that read them", async () => {
    using dir = tempDir("trim-elf-icu", dataFiles(".balign 16\\n.globl dictionary\\ndictionary:\\n.zero 64\\n"));
    const result = await linked(String(dir), { objects });
    const { table, addressOf, programResult } = result;
    expect(extentsOf(result)).toEqual([{ start: addressOf("icudt99_dat"), end: addressOf("dictionary") }]);
    expect(addressOf("dictionary") - addressOf("icudt99_dat")).toBe(Math.ceil(packageOf(items).length / 16) * 16);
    const featuresOfItem: number[][] = items.map(() => []);
    for (const { firstItem, itemCount, set } of table.icuPackages[0]!.runs) {
      featuresOfItem.fill(table.sets[set]!, firstItem, firstItem + itemCount);
    }
    expect(featuresOfItem).toEqual(items.map(([path]) => readersOf(path.slice(path.indexOf("/") + 1))));
    expect(readersOf("coll/de.res")).toEqual([indexOf("IntlCollation")]);
    expect(readersOf("nothing-knows-this.bin")).toEqual([]);
    expect(programResult.exitCode).toBe(0);
  });

  test("ends where its section ends when no name follows", async () => {
    using dir = tempDir("trim-elf-icu", dataFiles(""));
    const result = await linked(String(dir), { objects });
    const start = result.addressOf("icudt99_dat");
    expect(extentsOf(result)).toEqual([{ start, end: start + packageOf(items).length }]);
  });

  test("loses the items of a removed feature", async () => {
    using dir = tempDir("trim-elf-icu", dataFiles(""));
    const folder = String(dir);
    const { table } = await linked(folder, { objects, removed: ["IntlCollation"] });
    const { start, end } = table.icuPackages[0]!;
    const trimmed = join(folder, "trimmed");
    const file = openElf(trimmed, "r")!;
    const image = elfImage(trimmed, file);
    closeSync(file.fd);
    const names = itemsOf(image.bytes(start, end - start)!).map(({ name }) => name);
    expect(names).not.toContain("coll/de.res");
    expect(names).toContain("coll/root.res");
  });

  test("a program without it lists none", async () => {
    using dir = tempDir("trim-elf-icu", sources);
    const { table } = await linked(String(dir));
    expect(table.icuPackages).toEqual([]);
  });
});
