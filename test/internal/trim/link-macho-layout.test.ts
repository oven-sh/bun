import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { builtinModulesHeaderBytes } from "../../../scripts/build/trim/link.ts";
import type { TrimTable } from "../../../scripts/build/trim/table.ts";
import {
  addOne,
  asCStrings,
  canLink,
  compileFeatureCodeOnce,
  count,
  describeEachMachine,
  expectTrimmedImage,
  featureName,
  linked,
  linkSkipReason,
  mergedRanges,
  perMachine,
  sortedByIndex,
  sources,
  type LinkedProgram,
} from "./link-macho-support.ts";
import {
  entryCalling,
  exitCodeOf,
  expectCleanRuns,
  Extra,
  mixingFunction,
  Other,
  skipNotice,
  start,
  Third,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

if (!canLink) skipNotice("link-macho-layout.test.ts", linkSkipReason);

compileFeatureCodeOnce();

describeEachMachine("Mach-O $name", machine => {
  describe("a string", () => {
    const word = (index: number) => `words that only the feature names, ${index}`;
    const words = `const char *const feature_words[${count}] = { ${Array.from({ length: count }, (_, index) => JSON.stringify(word(index))).join(", ")} };`;
    const stringFunction = (name: string, text: string, from = 0) =>
      `__attribute__((noinline)) const char *${name}(void) { return &${JSON.stringify(text)}[${from}]; }`;
    const inBoth = "the same words in both";
    const onlyFeature = "only the feature names these words";
    const inTwoInputs = "equal words from two inputs of the feature";
    const endRetained = "words of which retained code names the end";
    const endRemovable = "words of which only the feature names the end";
    const strings = {
      ...sources,
      "entry.c": entryCalling("more"),
      "more.c": `
        ${words}
        int more_words(int);
        const char *feature_shared(void), *feature_only(void), *feature_equal(void), *feature_whole(void), *feature_end(void);
        int more(int x) { return feature_words[x % ${count}][x & 7] + feature_shared()[x & 7] + feature_only()[x & 7] + feature_equal()[x & 7] + feature_whole()[x & 7] + feature_end()[x & 3] + more_words(x); }
      `,
      "removable_strings.c": `${stringFunction("feature_shared", inBoth)} ${stringFunction("feature_only", onlyFeature)} ${stringFunction("feature_equal", inTwoInputs)} ${stringFunction("feature_whole", endRetained)} ${stringFunction("feature_end", endRemovable, 41)}`,
      "more_words.c": `${stringFunction("feature_second_equal", inTwoInputs)} int more_words(int x) { return feature_second_equal()[x & 7]; }`,
      "retained_strings.c": `${stringFunction("retained_shared", inBoth)} ${stringFunction("retained_end", endRetained, 39)}`,
      "main.c": `
        ${start}
        const char *retained_shared(void), *retained_end(void);
        int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : retained_shared()[argc + 3] == 's' && retained_end()[argc] == 'n' ? 0 : 1; }
      `,
    };
    const objects = [
      "feature_code",
      "entry",
      "more",
      "removable_strings",
      "more_words",
      "retained_strings",
      "embedder",
      "main",
    ];

    test("only the feature names is removable, from one input or two, by its start or middle; one retained code names is retained", async () => {
      using dir = tempDir("trim-macho-strings", strings);
      const { stringAt, isRemovableAt, programResult, trimmedResult } = await linked(machine, String(dir), { objects });
      const removable = [word(1), word(count - 1), onlyFeature, inTwoInputs, endRemovable];
      expect(Object.fromEntries(removable.map(text => [text, isRemovableAt(stringAt(text))]))).toEqual(
        Object.fromEntries(removable.map(text => [text, true])),
      );
      expect(Object.fromEntries([inBoth, endRetained].map(text => [text, isRemovableAt(stringAt(text))]))).toEqual({
        [inBoth]: false,
        [endRetained]: false,
      });
      expectCleanRuns({ programResult, trimmedResult });
    });

    for (const inputs of [
      ["more", "listed"],
      ["listed", "more"],
    ]) {
      test(`in an input with no visible reference is retained: ${inputs.join(" before ")}`, async () => {
        const unreferenced = "words that an input retains and does not name";
        using dir = tempDir("trim-macho-strings", {
          ...strings,
          "more_words.c": `${stringFunction("feature_listed", unreferenced)} int more_words(int x) { return feature_listed()[x & 7]; }`,
          "listed.S": `.section __TEXT,__cstring,cstring_literals\nl_listed: .asciz ${JSON.stringify(unreferenced)}\n.no_dead_strip l_listed\n.subsections_via_symbols\n`,
        });
        const { stringAt, isRemovableAt, programResult, trimmedResult } = await linked(machine, String(dir), {
          objects: [
            "feature_code",
            "entry",
            "retained_strings",
            "embedder",
            "main",
            ...inputs.flatMap(input => (input === "more" ? ["more", "removable_strings", "more_words"] : [input])),
          ],
        });
        expect([word(1), onlyFeature, unreferenced].map(text => isRemovableAt(stringAt(text)))).toEqual([
          true,
          true,
          false,
        ]);
        expectCleanRuns({ programResult, trimmedResult });
      });
    }

    test("with a symbol is retained when retained code reads it from another input, and removable when only the feature does", async () => {
      const [readByRetained, readByFeature] = [
        "words with a name, read by retained code",
        "words with a name, read only by the feature",
      ];
      using dir = tempDir("trim-macho-strings", {
        ...strings,
        "named.S": `.section __TEXT,__cstring,cstring_literals\n.private_extern _read_by_retained, _read_by_feature\n_read_by_retained: .asciz ${JSON.stringify(readByRetained)}\n_read_by_feature: .asciz ${JSON.stringify(readByFeature)}\n.subsections_via_symbols\n`,
        "more_words.c": `extern const char read_by_retained[], read_by_feature[]; int more_words(int x) { return read_by_retained[x & 7] + read_by_feature[x & 7]; }`,
        "main.c": strings["main.c"]
          .replace("int main(", "extern const char read_by_retained[]; int main(")
          .replace("retained_end()[argc] == 'n'", "retained_end()[argc] == 'n' && read_by_retained[argc] == 'o'"),
      });
      const { stringAt, isRemovableAt, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: [...objects, "named"],
      });
      expect([readByRetained, readByFeature, onlyFeature].map(text => isRemovableAt(stringAt(text)))).toEqual([
        false,
        true,
        true,
      ]);
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("is never removable once one reference matches no string in the map", async () => {
      const lea = (name: string, to: string) =>
        `${name}:${perMachine(`adrp x0, ${to}@PAGE\nadd x0, x0, ${to}@PAGEOFF`, `leaq ${to}(%rip), %rax`)}ret\n`;
      using dir = tempDir("trim-macho-strings", {
        ...strings,
        "labels.S": `
          .section __TEXT,__cstring,cstring_literals
          l_first: .asciz "the first of two under one name"
          .asciz "the second, which is named by the first and a distance"
          l_third: .asciz "the third, which the linker places where the second was"
          .text
          .globl _retained_second, _retained_third
          .p2align 2\n${lea("_retained_second", "l_first+32")}.p2align 2\n${lea("_retained_third", "l_third")}.subsections_via_symbols
        `,
        "main.c": `
          ${start}
          const char *retained_second(void), *retained_third(void);
          int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : retained_second() != 0 && retained_third() != 0 ? 0 : 1; }
        `,
      });
      const { stringAt, isRemovableAt, featuresOf, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: [...objects, "labels"],
      });
      expect([word(1), word(count - 1), onlyFeature].map(text => isRemovableAt(stringAt(text)))).toEqual([
        false,
        false,
        false,
      ]);
      expect(featuresOf("feature_code_0")).toEqual([Extra]);
      expectCleanRuns({ programResult, trimmedResult });
    });
  });

  describe("a literal", () => {
    const vector = "typedef char sixteen __attribute__((vector_size(16)));";
    const comparingFunction = (name: string, text: string) =>
      `__attribute__((noinline)) sixteen ${name}(sixteen x) { return x == (sixteen){ ${[...text].map(character => `'${character}'`).join(", ")} }; }`;
    const [onlyFeature, inBoth, onlyRetained] = ["sixteen removed!", "sixteen for both", "sixteen retained"];
    const literals = {
      ...sources,
      "entry.c": entryCalling("more"),
      "more.c": `
        ${vector} ${comparingFunction("feature_compares", onlyFeature)} ${comparingFunction("feature_shares", inBoth)}
        int more(int x) { return feature_compares((sixteen){ x })[0] + feature_shares((sixteen){ x })[1]; }
      `,
      "main.c": `
        ${start} ${vector} ${comparingFunction("retained_compares", onlyRetained)} ${comparingFunction("retained_shares", inBoth)}
        int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : retained_compares((sixteen){ 's' })[0] == -1 && retained_shares((sixteen){ 's' })[0] == -1 ? 0 : 1; }
      `,
    };
    const objects = ["feature_code", "entry", "more", "embedder", "main"];
    const literalAt = ({ file, section }: LinkedProgram, text: string) => {
      const literalSection = section("__TEXT,__literals")!;
      const at = file
        .subarray(literalSection.offset, literalSection.offset + literalSection.size)
        .indexOf(Buffer.from(text, "latin1"));
      if (at < 0) throw new Error(`program has no literal ${JSON.stringify(text)} in __TEXT,__literals`);
      return literalSection.address + at;
    };
    const removableCells = (result: LinkedProgram) =>
      [onlyFeature, inBoth, onlyRetained].map(text =>
        [0, 4, 8, 12].map(offset => result.isRemovableAt(literalAt(result, text) + offset)).join(),
      );

    test("only the feature reads is removable; one retained code reads, alone or too, is retained", async () => {
      using dir = tempDir("trim-macho-literals", literals);
      const result = await linked(machine, String(dir), { objects });
      expect(removableCells(result)).toEqual([
        "true,true,true,true",
        "false,false,false,false",
        "false,false,false,false",
      ]);
      expectCleanRuns(result);
    });

    test("a data pointer refers to is retained", async () => {
      const pointed = "sixteen pointed!";
      using dir = tempDir("trim-macho-literals", {
        ...literals,
        "pointer.S": `.section __TEXT,__literal16,16byte_literals\n.p2align 4\nl_pointed: .ascii ${JSON.stringify(pointed)}\n.section __DATA,__data\n.globl _points\n.p2align 3\n_points: .quad l_pointed\n.no_dead_strip _points\n.subsections_via_symbols\n`,
      });
      const result = await linked(machine, String(dir), { objects: [...objects, "pointer"] });
      expect(removableCells(result)).toEqual([
        "true,true,true,true",
        "false,false,false,false",
        "false,false,false,false",
      ]);
      expect(result.isRemovableAt(literalAt(result, pointed))).toBe(false);
      expectCleanRuns(result);
    });
  });

  describe("the layout", () => {
    const word = (index: number) => `words removed with the feature, ${index}`;
    const builtinsBytes = 400_000;
    const everyKind = {
      ...sources,
      "entry.c": entryCalling("more"),
      "more.c": `
        extern const char builtins_text[${builtinsBytes}];
        const char *const feature_words[${count * 3}] = { ${Array.from({ length: count * 3 }, (_, index) => JSON.stringify(word(index % count))).join(", ")} };
        int more(int x) { return feature_words[x % ${count * 3}][x & 7] + builtins_text[x % ${builtinsBytes}]; }
      `,
      "builtins.S": `.section __TEXT,__bun_builtins,regular,no_dead_strip\n.globl _builtins_text\n.p2align 4\n_builtins_text:\n.fill ${builtinsBytes}, 1, 0x61\n`,
      "main.c": `
        ${start}
        extern const char retained_table[62];
        volatile int changes = 1;
        const char *const retained_words[2] = { "words that stay", "more words that stay" };
        typedef double pair __attribute__((vector_size(16)));
        __attribute__((noinline)) pair scaled(pair x) { return x * (pair){ 1.000123, 2.000321 }; }
        int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : scaled((pair){ argc, argc })[1] > 2 && retained_words[argc][0] == 'm' && retained_table[argc] == '1' && changes == 1 ? 0 : 1; }
      `,
    };
    const objects = ["feature_code", "entry", "table", "more", "embedder", "main", "builtins"];

    const expectedRuns = [
      "__TEXT,__text .. __TEXT,__text",
      "__TEXT,__cstring .. __TEXT,__cstring",
      "__TEXT,__bun_builtins .. __TEXT,__const",
      "__DATA_CONST,__const .. the end of __DATA_CONST",
    ];
    const describeRange = (
      { sections, sectionAt, segmentAt }: Pick<LinkedProgram, "sections" | "sectionAt" | "segmentAt">,
      { start, end }: { start: number; end: number },
    ) =>
      `${sectionAt(start)!.name} .. ${end === segmentAt(end - 1)!.address + segmentAt(end - 1)!.size ? `the end of ${segmentAt(end - 1)!.name}` : sections.findLast(section => section.offset > 0 && section.address < end)!.name}`;
    const allWords = Array.from({ length: count - 1 }, (_, index) => word(index + 1));
    const featureSetNames = (table: TrimTable, set: number) => table.sets[set]!.map(featureName);

    test("removing the feature leaves four dead runs: code, strings, built-in module text with constants, pointer constants", async () => {
      using dir = tempDir("trim-macho-layout", everyKind);
      const folder = String(dir);
      const image = await linked(machine, folder, { objects });
      const {
        table,
        sections,
        section,
        stringAt,
        isRemovableAt,
        featuresAt,
        featuresOf,
        addressOf,
        summary,
        programResult,
        trimmedResult,
      } = image;
      const laidOut = ["__TEXT,__literals", "__TEXT,__cstring", "__TEXT,__bun_builtins", "__TEXT,__const"];
      expect(sections.map(({ name }) => name).filter(name => laidOut.includes(name))).toEqual(laidOut);
      const dead = mergedRanges(table.ranges);
      expect(dead.map(run => describeRange(image, run))).toEqual(expectedRuns);
      const [, deadStrings, deadConstants, deadAddresses] = dead;
      const builtins = section("__TEXT,__bun_builtins")!;
      expect(deadStrings!.end).toBe(builtins.address);
      expect(deadConstants!.start).toBe(builtins.address + builtinModulesHeaderBytes);
      expect(deadConstants!.end).toBeGreaterThan(builtins.address + builtins.size);
      expect(["words that stay", "more words that stay"].map(text => isRemovableAt(stringAt(text)))).toEqual([
        false,
        false,
      ]);
      expect(allWords.filter(text => !isRemovableAt(stringAt(text)))).toEqual([]);
      expect(Math.max(stringAt("words that stay"), stringAt("more words that stay"))).toBeLessThan(deadStrings!.start);
      expect(["feature_numbers", "feature_words", "retained_table", "retained_words"].map(featuresOf)).toEqual([
        [Extra],
        [Extra],
        undefined,
        undefined,
      ]);
      const inBuiltins = [0, builtinModulesHeaderBytes - 1, builtinModulesHeaderBytes, builtinsBytes - 1];
      expect(inBuiltins.map(offset => featuresAt(addressOf("builtins_text") + offset))).toEqual([
        undefined,
        undefined,
        [Extra],
        [Extra],
      ]);
      expect(addressOf("retained_table")).toBeGreaterThanOrEqual(deadConstants!.end);
      expect(addressOf("retained_words")).toBeLessThan(deadAddresses!.start);
      expect(summary.fileBytesSaved).toBeGreaterThan(0);
      expect(statSync(join(folder, "trimmed")).size).toBeLessThan(statSync(join(folder, "program")).size);
      expectCleanRuns({ programResult, trimmedResult });
      await expectTrimmedImage(machine, folder);
    });

    test("a retained string is not laid out among removable ones because one has its hash", async () => {
      const [retained, removable] = ["words number 36578", "words number 85708"];
      expect(Bun.hash.xxHash3(retained) & 0x7fffffffn).toBe(Bun.hash.xxHash3(removable) & 0x7fffffffn);
      using dir = tempDir("trim-macho-layout", {
        ...everyKind,
        "more.c": everyKind["more.c"].replace(
          "int more(int x) { return ",
          `int more(int x) { return ${JSON.stringify(removable)}[x & 7] + `,
        ),
        "main.c": everyKind["main.c"].replace(`"words that stay"`, JSON.stringify(retained)),
      });
      const image = await linked(machine, String(dir), { objects });
      const { table, stringAt, isRemovableAt, programResult, trimmedResult } = image;
      const dead = mergedRanges(table.ranges);
      expect(dead.map(run => describeRange(image, run))).toEqual([
        expectedRuns[0],
        "__TEXT,__cstring .. __TEXT,__cstring",
        ...expectedRuns.slice(1),
      ]);
      expect([retained, removable].map(text => isRemovableAt(stringAt(text)))).toEqual([false, true]);
      expect(dead[1]).toEqual({ start: stringAt(removable), end: stringAt(removable) + removable.length + 1 });
      expect(stringAt(retained)).toBeLessThan(dead[2]!.start);
      expect(allWords.filter(text => !isRemovableAt(stringAt(text)))).toEqual([]);
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("the strings of each group lie together, after the retained ones", async () => {
      const stringFunction = (index: number) =>
        `__attribute__((noinline)) const char *string_${index}(void) { return ${JSON.stringify(`${word(index)}, named by one of two features`)}; }`;
      const sum = (parity: number) =>
        Array.from({ length: count }, (_, index) => index)
          .filter(index => index % 2 === parity)
          .map(index => `string_${index}()[x & 7]`)
          .join(" + ");
      using dir = tempDir("trim-macho-layout", {
        ...sources,
        "entry.c": entryCalling("more"),
        "more.c": `
          ${Array.from({ length: count }, (_, index) => stringFunction(index)).join("\n")}
          int more(int x) { return ${sum(0)}; }
          __attribute__((noinline)) int entry_of_other(int x) { return ${sum(1)}; }
        `,
        "main.c": `
          ${start}
          int entry_of_other(int);
          __attribute__((noinline)) const char *retained_string(void) { return "words that stay"; }
          int main(int argc, char **argv) {
            const char *text = retained_string();
            __asm__ volatile("" : "+r"(text));
            return argc > 6 ? GUARDED(Other, entry_of_other, argc) : argc > 5 ? GUARDED(Extra, entered, argc) : text[argc] == 'o' ? 0 : 1;
          }
        `,
      });
      const { table, section, stringAt, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: ["feature_code", "entry", "embedder", "main", "more"],
      });
      const strings = section("__TEXT,__cstring")!;
      const inStrings = table.ranges.filter(
        ({ start }) => strings.address <= start && start < strings.address + strings.size,
      );
      expect(
        inStrings
          .map(({ set }) => featureSetNames(table, set))
          .flat()
          .toSorted(),
      ).toEqual([Extra, Other].toSorted());
      expect(stringAt("words that stay")).toBeLessThan(inStrings[0]!.start);
      expect(inStrings[0]!.end).toBe(inStrings[1]!.start);
      expectCleanRuns({ programResult, trimmedResult });
    });

    test.each([
      ["large enough for a group", 6000, false],
      ["too small for a group", 1, false],
      ["with a name that a retained function has in another input", 6000, true],
    ])("a function folded across inputs belongs to both features: %s", async (_, length, sharesRetainedName) => {
      const foldableFunction = (name: string) =>
        `static __attribute__((noinline)) int ${name}(int x) { __asm__ volatile(".rept ${length}\\nnop\\n.endr"); for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 77; }`;
      using dir = tempDir("trim-macho-layout", {
        ...sources,
        "entry.c": entryCalling("early"),
        "early.c": `
          static ${mixingFunction("same_name", 5)} static ${mixingFunction("retained_name", 11)} ${foldableFunction("first_copy")}
          int early(int x) { return same_name(x) + first_copy(x + 1); }
          int calls_retained(int x) { return retained_name(x); }
          int after_early(int x) { return x; }
        `,
        "late.c": `
          ${foldableFunction("same_name")} ${sharesRetainedName ? foldableFunction("retained_name") : ""}
          __attribute__((noinline)) int entry_of_other(int x) { __asm__ volatile(".rept 6000\\nnop\\n.endr"); return same_name(x) * 5${sharesRetainedName ? " + retained_name(x + 2)" : ""}; }
          int after_late(int x) { return x; }
        `,
        "main.c": `${start} int entry_of_other(int); int calls_retained(int); int main(int argc, char **argv) { return argc > 6 ? GUARDED(Other, entry_of_other, argc) : argc > 5 ? GUARDED(Extra, entered, argc) : calls_retained(argc) & 0; }`,
      });
      const { table, addressOf, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: ["early", "feature_code", "entry", "late", "embedder", "main"],
      });
      const copy = addressOf("first_copy");
      if (sharesRetainedName) expect(addressOf("retained_name")).toBe(copy);
      expect(
        table.ranges
          .filter(({ start, end }) => start <= copy && copy < end)
          .map(({ set }) => featureSetNames(table, set)),
      ).toEqual([sortedByIndex(Extra, Other)]);
      expect(
        Math.max(...["early", "feature_code", "feature_code_0", `feature_code_${count - 1}`].map(addressOf)),
      ).toBeLessThan(copy);
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("what two features share is one group of its own", async () => {
      const longFunction = (name: string, by: number) =>
        `__attribute__((noinline)) int ${name}(int x) { __asm__ volatile(".rept 6000\\nnop\\n.endr"); return x * ${by}; }`;
      using dir = tempDir("trim-macho-layout", {
        ...sources,
        "more.c": `
          ${longFunction("shared_function", 3)} ${longFunction("other_only", 5)} ${longFunction("third_only", 7)}
          __attribute__((noinline)) int entry_of_other(int x) { return shared_function(x) + other_only(x); }
          __attribute__((noinline)) int entry_of_third(int x) { return shared_function(x) - third_only(x); }
        `,
        "main.c": `
          ${start} int entry_of_other(int); int entry_of_third(int);
          int main(int argc, char **argv) { return argc > 7 ? GUARDED(Other, entry_of_other, argc) : argc > 6 ? GUARDED(Third, entry_of_third, argc) : argc > 5 ? GUARDED(Extra, entered, argc) : 0; }
        `,
      });
      const { table, addressOf, featuresOf, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: ["feature_code", "entry", "more", "embedder", "main"],
      });
      expect(["shared_function", "other_only", "third_only", "feature_code"].map(featuresOf)).toEqual([
        sortedByIndex(Other, Third),
        [Other],
        [Third],
        [Extra],
      ]);
      const shared = table.ranges.filter(
        ({ set }) => featureSetNames(table, set).join() === sortedByIndex(Other, Third).join(),
      );
      expect(shared.length).toBe(1);
      expect(shared[0]!.start).toBeLessThanOrEqual(addressOf("shared_function"));
      expect(shared[0]!.end).toBeGreaterThan(addressOf("shared_function"));
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("a retained feature's pointers stay on their fixup chain in a page it shares with a removed feature's", async () => {
      const length = count * 3;
      const wordsOf = (table: string) =>
        `const char *const ${table}[${length}] = { ${Array.from({ length }, (_, index) => JSON.stringify(`${table} ${index % count}`)).join(", ")} };`;
      const tableReader = (name: string, table: string) => `
        ${wordsOf(table)}
        __attribute__((noinline)) int ${name}(int x) {
          const char *const *words = ${table};
          __asm__ volatile("" : "+r"(words));
          int matching = 0;
          for (int i = 0; i < ${length}; i++) matching += words[i][0] == '${table[0]}';
          return matching == ${length} ? 42 : x & 1;
        }
      `;
      using dir = tempDir("trim-macho-layout", {
        ...sources,
        "entry.c": tableReader("entered", "extra_words"),
        "other.c": tableReader("entry_of_other", "other_words"),
        "main.c": `${start} int entry_of_other(int); int main(int argc, char **argv) { return argc == 2 ? GUARDED(Extra, entered, argc) : argc == 3 ? GUARDED(Other, entry_of_other, argc) : 0; }`,
      });
      const folder = String(dir);
      const { addressOf, featuresOf, sectionAt, trim, programResult, trimmedResult } = await linked(machine, folder, {
        objects: ["entry", "other", "embedder", "main"],
      });
      expect(["extra_words", "other_words"].map(featuresOf)).toEqual([[Extra], [Other]]);
      expect(["extra_words", "other_words"].map(name => sectionAt(addressOf(name))!.name)).toEqual([
        "__DATA_CONST,__const",
        "__DATA_CONST,__const",
      ]);
      expect(Math.abs(addressOf("extra_words") - addressOf("other_words"))).toBe(length * 8);
      expect(Math.max(addressOf("extra_words"), addressOf("other_words")) % 4096).not.toBe(0);
      trim("without-other", [Other]);
      expectCleanRuns({ programResult, trimmedResult });
      if (!machine.canRun) return;
      const codes = async (name: string) => [
        await exitCodeOf(folder, name, ["a"]),
        await exitCodeOf(folder, name, ["a", "b"]),
      ];
      expect({
        whole: await codes("whole"),
        withoutExtra: await codes("trimmed"),
        withoutOther: await codes("without-other"),
      }).toEqual({ whole: [42, 42], withoutExtra: [70, 42], withoutOther: [42, 70] });
    });

    test("a single unit of the interpreter's assembly is removed whole with the feature that alone calls it", async () => {
      using dir = tempDir("trim-macho-layout", {
        ...sources,
        "entry.c": entryCalling("more"),
        "more.c": `
          int unit_first(int);
          int unit_second(int);
          __asm__(${asCStrings(`.section __TEXT,__jsc_wasm,regular,pure_instructions\n.globl _unit_first, _unit_second\n.p2align 2\n_unit_first:\n${addOne}\n.space 20000\n_unit_second:\n${addOne}\nret\n.text\n`)});
          int more(int x) { return unit_first(x) + unit_second(x); }
        `,
        "main.c": `${start} int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : 0; }`,
      });
      const { featuresOf, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: ["feature_code", "entry", "more", "embedder", "main"],
      });
      expect(["unit_first", "unit_second"].map(featuresOf)).toEqual([[Extra], [Extra]]);
      expectCleanRuns({ programResult, trimmedResult });
    });
  });
});
