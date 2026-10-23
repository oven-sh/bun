import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDir } from "harness";
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reach } from "../../../scripts/build/trim/graph.ts";
import { readMachOGraph } from "../../../scripts/build/trim/macho-graph.ts";
import { foldedEntryPointsHeading } from "../../../scripts/build/trim/report.ts";
import {
  addOne,
  asCStrings,
  canLink,
  compile,
  compileFeatureCodeOnce,
  count,
  describeEachMachine,
  exits,
  expectTrimmedImage,
  foldsEntryPoints,
  guardedArguments,
  jumpTo,
  linkByHand,
  linked,
  linkSkipReason,
  recordRelocationKinds,
  sortedByIndex,
  sources,
  statisticOf,
  tools,
  wrapped,
} from "./link-macho-support.ts";
import {
  buildGuardCrate,
  builtinUsing,
  callAll,
  compileRust,
  cxxFlags,
  embedderSource,
  entryCalling,
  entryGuarding,
  entryPointsText,
  exitCodeOf,
  expectCleanRuns,
  expectLinkFailure,
  exportFeatures,
  Extra,
  guardHeader,
  guardHeaderSkipReason,
  indexOf,
  mainEnteringBuiltin,
  manyFunctions,
  mixingFunction,
  Other,
  reviewFiles,
  run,
  rustSource,
  skipNotice,
  spelledBuiltin,
  spellingsSource,
  start,
  toyHeader,
  trimmedSpellingsOutput,
  wholeSpellingsOutput,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

const testFile = "link-macho.test.ts";
if (!canLink) skipNotice(testFile, linkSkipReason);

compileFeatureCodeOnce();

describeEachMachine("Mach-O $name", machine => {
  describe("a trimmable link", () => {
    const removableNames = ["feature_code", "feature_code_0", `feature_code_${count - 1}`, "feature_numbers"];
    const retainedNames = [
      "main",
      "retained",
      "Bun__abortForRemovedFeature",
      "Bun__removableFeatureState",
      "retained_table",
    ];

    test("removes the code and constants that only the entry point reaches, and nothing else", async () => {
      using dir = tempDir("trim-macho", sources);
      const folder = String(dir);
      const { featuresOf, summary, programResult, trimmedResult } = await linked(machine, folder);
      expect(removableNames.map(featuresOf)).toEqual(removableNames.map(() => [Extra]));
      expect(retainedNames.map(featuresOf)).toEqual(retainedNames.map(() => undefined));
      // What the model says cannot be without the feature goes with it.
      expect(summary.removed).toContain(Extra);
      expect(summary.removed).not.toContain(Other);
      expect(summary.removedBytes).toBeGreaterThan(32768);
      expect(summary.fileBytesSaved).toBeGreaterThanOrEqual(16384);
      expect(statSync(join(folder, "program")).size - statSync(join(folder, "trimmed")).size).toBe(
        summary.fileBytesSaved,
      );
      expectCleanRuns({ programResult, trimmedResult });
      if (machine.canRun) expect(await exitCodeOf(folder, "trimmed", guardedArguments)).toBe(70);
      expect(reviewFiles(folder, "program")).toEqual([
        "entry-points.txt",
        "groups.txt",
        "requires.txt",
        "retained-by.txt",
      ]);
      await expectTrimmedImage(machine, folder);
    });

    test("gives the same bytes when the same inputs are linked again", async () => {
      using dir = tempDir("trim-macho", sources);
      const folder = String(dir);
      const first = await linked(machine, folder);
      const second = await linked(machine, folder);
      expect(second.file.equals(first.file)).toBe(true);
    });

    test("orders by the command's own order file after the groups", async () => {
      const ownOrder = "_main\n_retained\n";
      using dir = tempDir("trim-macho", { ...sources, "own-order.txt": ownOrder });
      const folder = String(dir);
      const { addressOf, featuresOf, programResult, trimmedResult } = await linked(machine, folder, {
        linkFlags: ["-Wl,-order_file,own-order.txt"],
      });
      expect(readFileSync(join(folder, "work/order.txt"), "latin1")).toEndWith(`\n${ownOrder}`);
      expect(["feature_code_0", "main", "retained"].map(featuresOf)).toEqual([[Extra], undefined, undefined]);
      expect(addressOf(`feature_code_${count - 1}`)).toBeLessThan(addressOf("main"));
      expect(addressOf("main")).toBeLessThan(addressOf("retained"));
      expectCleanRuns({ programResult, trimmedResult });
    });
  });

  describe("the link fails", () => {
    test("on a feature below its minimum size, and names what retains the rest", async () => {
      using dir = tempDir("trim-macho-fails", {
        ...sources,
        "main.c": `
          ${start}
          int feature_code_5(int);
          int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : feature_code_5(argc) != 0 ? 0 : 1; }
        `,
      });
      const folder = String(dir);
      const linkResult = await wrapped(machine, folder, {
        objects: ["feature_code", "entry", "embedder", "main"],
        minimums: { [Extra]: 1_000_000 },
      });
      expectLinkFailure(folder, "program", linkResult, ["FeatureBelowMinimum"]);
      expect(linkResult.stderr).toMatch(
        /feature_code_5 \(feature_code-\w+\.o, \d+ bytes\)\n\s+<- main \(main\.o, \d+ bytes\)/,
      );
    });

    test("on two archive members of one name", async () => {
      using dir = tempDir("trim-macho-fails", {
        ...sources,
        "one/member.c": `int feature_code_5(int); int first_member(int x) { return feature_code_5(x); }`,
        "two/member.c": `int feature_code_6(int); int second_member(int x) { return feature_code_6(x); }`,
        "main.c": `
          ${start}
          int first_member(int);
          int second_member(int);
          int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : first_member(argc) + second_member(argc) != 0 ? 0 : 1; }
        `,
      });
      const folder = String(dir);
      const linkResult = await wrapped(machine, folder, {
        objects: ["feature_code", "entry", "one/member", "two/member", "embedder", "main"],
        archived: ["one/member", "two/member"],
      });
      expectLinkFailure(folder, "program", linkResult, ["UnreadInput", "AmbiguousArchiveMember", "lib.a(member.o)"]);
    });

    test("on retained code that calls an entry point without its guard", async () => {
      using dir = tempDir("trim-macho-fails", {
        ...sources,
        "main.c": `
          ${start}
          __attribute__((noinline)) int calls_directly(int x) { return entered(x); }
          int main(int argc, char **argv) { return argc > 6 ? calls_directly(argc) : argc > 5 ? GUARDED(Extra, entered, argc) : 0; }
        `,
      });
      const folder = String(dir);
      const linkResult = await wrapped(machine, folder, { objects: ["feature_code", "entry", "embedder", "main"] });
      expectLinkFailure(folder, "program", linkResult, [
        "EntryPointReferencedByRetainedCode",
        "calls_directly",
        "entered",
        "main",
      ]);
    });

    test("on an entry point that runs before main", async () => {
      using dir = tempDir("trim-macho-fails", {
        ...sources,
        "entry.c": entryCalling("more"),
        "more.c": `
          int early_value;
          static volatile int seed = 5;
          ${mixingFunction("feature_early", 5)}
          __attribute__((constructor, noinline)) void early(void) { for (int i = 0; i < 5; i++) early_value += feature_early(seed + i); }
          int more(int x) { return feature_early(x); }
        `,
        "main.c": `
          ${start}
          void early(void);
          extern int early_value;
          int main(int argc, char **argv) {
            if (argc > 6) GUARDED(Extra, early);
            return argc > 5 ? GUARDED(Extra, entered, argc) : early_value != 0 ? 0 : 1;
          }
        `,
      });
      const folder = String(dir);
      const linkResult = await wrapped(machine, folder, {
        objects: ["feature_code", "entry", "more", "embedder", "main"],
      });
      expectLinkFailure(folder, "program", linkResult, ["EntryPointReferencedByRetainedCode", "early"]);
    });

    test("on a record with a subtractor pair instead of an address", async () => {
      using dir = tempDir("trim-macho-fails", {
        ...sources,
        "record.S": `
          .text
          .globl _subtracted
          .p2align 2
          _subtracted:
          ret
          .data
          .globl _subtrahend
          .p2align 3
          _subtrahend:
          .quad 0
          .section __DWARF,__bun_entries,regular,debug
          .p2align 3
          .quad _subtracted - _subtrahend
          .quad _subtracted
          .short ${indexOf(Extra)}
          .byte 0
          .space 5
          .subsections_via_symbols
        `,
        "main.c": `
          ${start}
          int subtracted(int);
          extern long subtrahend;
          int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : subtracted(argc) + (int)subtrahend; }
        `,
      });
      const folder = String(dir);
      const linkResult = await wrapped(machine, folder, {
        objects: ["feature_code", "entry", "record", "embedder", "main"],
      });
      expectLinkFailure(folder, "program", linkResult, ["UnreadInput", "UnsupportedRelocations", "record.o"]);
    });
  });

  describe("an entry point", () => {
    const foldedEntries = (folder: string) =>
      entryPointsText(folder, "program").split(foldedEntryPointsHeading)[1] ?? "";
    const loopingFunction = (name: string, calls: string) =>
      `__attribute__((noinline)) int ${name}(int x) { for (int i = 0; i < 5; i++) x = x * 7 + i; return ${calls}(x) & 0xffff; }`;
    const folded = {
      ...sources,
      "deeper.c": mixingFunction("folded_entry_callee", 5),
      "more.c": `int folded_entry_callee(int); ${loopingFunction("folded_entry", "folded_entry_callee")} int after_folded_entry(int x) { return x; }`,
      "main.c": `
        ${start}
        int folded_entry_callee(int);
        int folded_entry(int);
        ${loopingFunction("equal_to_entry", "folded_entry_callee")}
        int main(int argc, char **argv) { return argc > 6 ? GUARDED(Extra, folded_entry, argc) : argc > 5 ? GUARDED(Extra, entered, argc) : equal_to_entry(argc) < 0x10000 ? 0 : 1; }
      `,
    };

    for (const objects of [
      ["feature_code", "entry", "deeper", "embedder", "more", "main"],
      ["feature_code", "entry", "deeper", "embedder", "main", "more"],
    ]) {
      test(`folded with a function no record names is retained, whichever copy the linker selects: ${objects.slice(4).join(", ")}`, async () => {
        using dir = tempDir("trim-macho-entry", folded);
        const folder = String(dir);
        const { addressOf, featuresOf, programResult, trimmedResult } = await linked(machine, folder, {
          objects,
          linkFlags: foldsEntryPoints,
        });
        expect(addressOf("folded_entry")).toBe(addressOf("equal_to_entry"));
        expect(["folded_entry", "folded_entry_callee", "feature_code_0"].map(featuresOf)).toEqual([
          undefined,
          undefined,
          [Extra],
        ]);
        expect(foldedEntries(folder)).toContain("folded_entry");
        expectCleanRuns({ programResult, trimmedResult });
      });
    }

    test("with a second name at its first byte that main calls is retained", async () => {
      using dir = tempDir("trim-macho-entry", {
        ...sources,
        "more.c": `
          ${mixingFunction("shared_entry_callee", 5)}
          __asm__(${asCStrings(`.text\n.globl _shared_entry, _another_name\n.p2align 2\n_shared_entry:\n_another_name:\n${addOne}${addOne}${addOne}${addOne}${jumpTo("_shared_entry_callee")}`)});
        `,
        "main.c": `
          ${start}
          int shared_entry(int);
          int another_name(int);
          int main(int argc, char **argv) { return argc > 6 ? GUARDED(Extra, shared_entry, argc) : argc > 5 ? GUARDED(Extra, entered, argc) : another_name(argc) == 637 ? 0 : 1; }
        `,
      });
      const folder = String(dir);
      const { featuresOf, programResult, trimmedResult } = await linked(machine, folder, {
        objects: ["feature_code", "entry", "more", "embedder", "main"],
      });
      expect(["shared_entry", "shared_entry_callee", "feature_code_0"].map(featuresOf)).toEqual([
        undefined,
        undefined,
        [Extra],
      ]);
      expect(foldedEntries(folder)).toContain("shared_entry");
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("with an alternative entry that retained code calls fails the link", async () => {
      using dir = tempDir("trim-macho-entry", {
        ...sources,
        "entry.c": entryCalling("more"),
        "more.c": `${mixingFunction("feature_target", 3)} int more(int x) { return feature_target(x); }`,
        "piece.c": `__asm__(${asCStrings(`.text\n.globl _piece, _alternative\n.p2align 2\n_piece:\n${addOne}${addOne}${addOne}${addOne}\n.alt_entry _alternative\n_alternative:\n${jumpTo("_feature_target")}\n`)});`,
        "main.c": `
          ${start}
          int piece(int);
          int alternative(int);
          int main(int argc, char **argv) { return argc > 6 ? GUARDED(Extra, piece, argc) : argc > 5 ? GUARDED(Extra, entered, argc) : alternative(argc) == 35 ? 0 : 1; }
        `,
      });
      const folder = String(dir);
      const linkResult = await wrapped(machine, folder, {
        objects: ["feature_code", "entry", "more", "piece", "embedder", "main"],
      });
      expectLinkFailure(folder, "program", linkResult, ["EntryPointReferencedByRetainedCode", "alternative", "piece"]);
    });

    test("is read from a record relocation against a section and from one against a symbol, in one object", async () => {
      using dir = tempDir("trim-macho-entry", {
        ...sources,
        "external.c": `int feature_code(int); __attribute__((noinline)) int external_entry(int x) { return feature_code(x) * 7; }`,
        "guards.c": `
          #include "guard.h"
          int feature_code(int);
          int external_entry(int);
          __attribute__((noinline)) static int static_entry(int x) { return feature_code(x) * 5; }
          int call_entries(int x) { return GUARDED(Extra, static_entry, x) + GUARDED(Extra, external_entry, x + 1); }
        `,
        "main.c": `int call_entries(int); int main(int argc, char **argv) { return argc > 5 ? call_entries(argc) & 63 : 0; }`,
      });
      const folder = String(dir);
      const { featuresOf, programResult, trimmedResult } = await linked(machine, folder, {
        objects: ["feature_code", "external", "guards", "embedder", "main"],
      });
      expect(recordRelocationKinds(readFileSync(join(folder, "guards.o")))).toEqual(["section", "symbol"]);
      expect(["static_entry", "external_entry", "call_entries"].map(featuresOf)).toEqual([[Extra], [Extra], undefined]);
      expectCleanRuns({ programResult, trimmedResult });
      if (machine.canRun) expect(await exitCodeOf(folder, "trimmed", guardedArguments)).toBe(70);
    });

    test("compiled with ThinLTO is found, and the second link reuses the first link's native objects", async () => {
      using dir = tempDir("trim-macho-entry", sources);
      const folder = String(dir);
      const { featuresOf, programResult, trimmedResult } = await linked(machine, folder, {
        compileFlags: { entry: ["-flto=thin"], main: ["-flto=thin"] },
      });
      expect(featuresOf("entered")).toEqual([Extra]);
      expectCleanRuns({ programResult, trimmedResult });
      expect(readdirSync(join(folder, "work/compiled")).filter(name => name.endsWith(".lto.o")).length).toBeGreaterThan(
        0,
      );
      expect(readdirSync(join(folder, "work/unused"))).toEqual([]);
    });

    test("stays removable when a dead-stripped static guard has the name of a live function in another input", async () => {
      using dir = tempDir("trim-macho-entry", {
        ...sources,
        "stripped.c": `
          ${start}
          __attribute__((noinline)) static int helper(int x) { return GUARDED(Extra, entered, x); }
          int calls_stripped_helper(int x) { return helper(x); }
        `,
        "live.c": `
          __attribute__((noinline)) static int helper(int x) { return x * 5 + 2; }
          int calls_live_helper(int x) { return helper(x); }
        `,
        "main.c": `
          ${start}
          int calls_live_helper(int);
          int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : calls_live_helper(argc) == 7 ? 0 : 1; }
        `,
      });
      const objects = ["feature_code", "entry", "stripped", "live", "embedder", "main"];
      const { linkOutput, featuresOf, programResult, trimmedResult } = await linked(machine, String(dir), { objects });
      expect(linkOutput).toMatch(/^1 entry points in 2 records: 1 dead guards, /m);
      expect(["entered", "helper"].map(featuresOf)).toEqual([[Extra], undefined]);
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("with a C++ name is listed demangled", async () => {
      using dir = tempDir("trim-macho-entry", {
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
      const objects = ["feature_code", "mangled", "embedder", "guards"];
      const { featuresOf, programResult, trimmedResult } = await linked(machine, folder, { objects });
      expect(featuresOf("_ZN3toy13mangled_entryEi")).toEqual([Extra]);
      const [line] = entryPointsText(folder, "program").split("\n");
      expect(line).toMatch(/^\S+ Abort \d+ toy::mangled_entry\(int\) \(mangled\.o, \d+ bytes\) <- main \(guards\.o, /);
      expectCleanRuns({ programResult, trimmedResult });
    });
  });

  describe("a symbol at the end of its section, with no bytes of its own", () => {
    test.each([
      ["a label", ""],
      ["an alternative entry", ".alt_entry _table_end\n"],
    ])("is outside the graph, and the link succeeds: %s", async (_, directive) => {
      using dir = tempDir("trim-macho-end", {
        ...sources,
        "end_label.S": `.section __DATA,__toy_table\n.globl _table, _table_end\n.p2align 3\n_table:\n.quad 1, 2\n.byte 3\n${directive}_table_end:\n.subsections_via_symbols\n`,
        "main.c": `
          ${start}
          extern const char table[], table_end[];
          int main(int argc, char **argv) {
            const char *end = table_end;
            __asm__ volatile("" : "+r"(end));
            return argc > 5 ? GUARDED(Extra, entered, argc) : end - table == 17 ? 0 : 1;
          }
        `,
      });
      const objects = ["feature_code", "entry", "end_label", "embedder", "main"];
      const { linkOutput, addressOf, featuresOf, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects,
      });
      expect(addressOf("table_end") - addressOf("table")).toBe(17);
      expect(statisticOf(linkOutput, "symbolsOutsideGraph")).toBeGreaterThanOrEqual(1);
      expect(["table", "entered"].map(featuresOf)).toEqual([undefined, [Extra]]);
      expectCleanRuns({ programResult, trimmedResult });
    });
  });

  describe("the graph reader", () => {
    const mainReading = (name: string) => `
      ${start}
      extern const long ${name};
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : (int)${name} == 0; }
    `;
    const objectsWithText = ["feature_code", "entry", "text", "embedder", "main"];

    test.skipIf(machine.isArm64)("follows the difference of a string and a symbol in four bytes", async () => {
      using dir = tempDir("trim-macho-reader", {
        ...sources,
        "text.S": `.section __TEXT,__cstring,cstring_literals\nL_first: .asciz "in front"\nL_text: .asciz "reached by a difference"\n.section __TEXT,__const\n.globl _offset_of_text\n.p2align 3\n_offset_of_text: .long L_text - _offset_of_text\n.long 0\n.subsections_via_symbols\n`,
        "main.c": mainReading("offset_of_text"),
      });
      const { linkOutput, stringAt } = await linked(machine, String(dir), { objects: objectsWithText });
      expect(statisticOf(linkOutput, "stringsNotFound")).toBe(0);
      expect(statisticOf(linkOutput, "stringsRetained")).toBe(0);
      expect(stringAt("reached by a difference")).toBeGreaterThan(0);
      expect(() => stringAt("in front")).toThrow();
    });

    // zstd holds `" " + 2`, and for x86-64 the compiler writes that as the name of the string and an addend.
    test("follows the name of a string whatever is added to it", async () => {
      using dir = tempDir("trim-macho-reader", {
        ...sources,
        "text.S": `.section __TEXT,__cstring,cstring_literals\nl_first: .asciz "in front"\nl_named_text: .asciz "text"\n.section __DATA,__const\n.globl _past_text\n.p2align 3\n_past_text: .quad l_named_text + 5\n.quad l_named_text + 4096\n.subsections_via_symbols\n`,
        "main.c": mainReading("past_text"),
      });
      const { linkOutput, stringAt, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: objectsWithText,
      });
      expect(statisticOf(linkOutput, "stringsNotFound")).toBe(0);
      expect(statisticOf(linkOutput, "stringsRetained")).toBe(0);
      expect(stringAt("text")).toBeGreaterThan(0);
      expect(() => stringAt("in front")).toThrow();
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("names a reference to a string that it cannot follow, and retains every string", async () => {
      using dir = tempDir("trim-macho-reader", {
        ...sources,
        "text.S": `.section __TEXT,__objc_methname,cstring_literals\nl_selector: .asciz "aSelector"\n.section __DATA,__const\n.globl _cell_of_selector\n.p2align 3\n_cell_of_selector: .quad l_selector\n.subsections_via_symbols\n`,
        "main.c": mainReading("cell_of_selector"),
      });
      const { linkOutput, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: objectsWithText,
      });
      expect(statisticOf(linkOutput, "stringsNotFound")).toBe(1);
      expect(statisticOf(linkOutput, "stringsFollowed")).toBe(0);
      expect(linkOutput).toMatch(
        /^graph: a string is not followed: \S*text\.o: \S*_cell_of_selector: "aSelector" is not among the strings of the image$/m,
      );
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("follows a pointer that only the fixups show into a single unit of the interpreter's assembly", async () => {
      const cellHolding = (value: string) =>
        `.section __DATA,__const\n.globl _retained_cell\n.p2align 3\n_retained_cell: .quad ${value}\n.subsections_via_symbols\n`;
      using dir = tempDir("trim-macho-reader", {
        ...sources,
        "entry.c": entryCalling("more"),
        "more.c": `
          int unit_first(int);
          int unit_second(int);
          __asm__(${asCStrings(`.section __TEXT,__jsc_wasm,regular,pure_instructions\n.globl _unit_first, _unit_second\n.p2align 2\n_unit_first:\n${addOne}\n_unit_second:\n${addOne}\nret\n.text\n`)});
          int more(int x) { return unit_first(x) + unit_second(x); }
        `,
        "cell.S": cellHolding("_unit_second"),
        "cell_without_pointer.S": cellHolding("0"),
        "main.c": `
          ${start}
          extern int (*const retained_cell)(int);
          int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) : retained_cell(argc) == 2 ? 0 : 1; }
        `,
      });
      const folder = String(dir);
      const { executable, map, exportedSymbols } = await linkByHand(machine, folder, [
        "feature_code",
        "entry",
        "more",
        "cell",
        "embedder",
        "main",
      ]);
      const read = () => readMachOGraph(executable, map, [], exportedSymbols);
      const withObjectReference = read();
      expect(withObjectReference.failures).toEqual([]);
      await compile(machine, folder, "cell_without_pointer");
      copyFileSync(join(folder, "cell_without_pointer.o"), join(folder, "cell.o"));
      const { graph, failures, statistics } = read();
      expect(failures).toEqual([]);
      expect(statistics.pointersOnlyInFixups).toBe(withObjectReference.statistics.pointersOnlyInFixups! + 1);
      const [cell, unitFirst, unitSecond] = ["_retained_cell", "_unit_first", "_unit_second"].map(name =>
        graph.names.findIndex(names => names.includes(name)),
      );
      expect([cell, unitFirst, unitSecond].map(node => graph.output[node!])).toEqual([
        "__DATA_CONST,__const",
        "__TEXT,__jsc_wasm",
        "__TEXT,__jsc_wasm",
      ]);
      const reached = reach(graph, [cell!]);
      expect([reached[unitFirst!], reached[unitSecond!]]).toEqual([1, 1]);
    });
  });

  describe("two features", () => {
    const longFunction = (name: string) => `
      __attribute__((noinline)) int ${name}(int x) { __asm__ volatile(".rept 6000\\nnop\\n.endr"); for (int i = 0; i < 5; i++) x += feature_code(x + i) * 3 + feature_code(x ^ i); return x; }
    `;
    const equalEntries = {
      ...sources,
      "more.c": `int feature_code(int); ${longFunction("entry_of_extra")} ${longFunction("entry_of_other")} int after_entries(int x) { return x; }`,
      "main.c": `
        ${start}
        int entry_of_extra(int);
        int entry_of_other(int);
        int main(int argc, char **argv) {
          if (argc == 2) return GUARDED(Extra, entry_of_extra, argc) & 63;
          if (argc == 3) return GUARDED(Other, entry_of_other, argc) & 63;
          return argc > 5 ? GUARDED(Extra, entered, argc) : 0;
        }
      `,
    };

    test("with equal entry points fold into one body, which is removed only with both", async () => {
      using dir = tempDir("trim-macho-two", equalEntries);
      const folder = String(dir);
      const { addressOf, featuresOf, trim } = await linked(machine, folder, {
        objects: ["feature_code", "entry", "table", "more", "embedder", "main"],
        linkFlags: foldsEntryPoints,
      });
      expect(addressOf("entry_of_extra")).toBe(addressOf("entry_of_other"));
      expect(featuresOf("entry_of_extra")).toEqual(sortedByIndex(Extra, Other));
      trim("without-both", [Extra, Other]);
      if (!machine.canRun) return;
      const codes = async (name: string) => [
        await exitCodeOf(folder, name, ["a"]),
        await exitCodeOf(folder, name, ["a", "b"]),
      ];
      const whole = await codes("whole");
      expect(whole[0]).not.toBe(70);
      expect(await codes("trimmed")).toEqual([70, whole[1]!]);
      expect(await codes("without-both")).toEqual([70, 70]);
    });

    const requiring = (entry: string) => ({
      ...sources,
      "entry.c": entry,
      "other.c": `
        ${manyFunctions("other_", count)}
        __attribute__((noinline)) int entry_of_other(int x) { ${callAll("other_", count)} return x; }
      `,
      "main.c": `
        ${start}
        int entry_of_other(int);
        int main(int argc, char **argv) { return argc > 6 ? GUARDED(Other, entry_of_other, argc) & 63 : argc > 5 ? GUARDED(Extra, entered, argc) & 63 : 0; }
      `,
    });
    const objects = ["feature_code", "entry", "other", "embedder", "main"];

    test("have a reference edge where one calls the other's entry point directly", async () => {
      using dir = tempDir("trim-macho-two", requiring(entryCalling("entry_of_other")));
      const folder = String(dir);
      const { table, featuresOf, programResult, trimmedResult } = await linked(machine, folder, { objects });
      expect(table.edges).toEqual([
        { from: indexOf(Extra), to: indexOf(Other), strength: "Reference", isFollowed: true },
      ]);
      expect(readFileSync(join(folder, "program.trim/requires.txt"), "utf8")).toStartWith(
        `${Extra} requires ${Other}: 1 references`,
      );
      expect(["entered", "entry_of_other"].map(featuresOf)).toEqual([[Extra], [Other]]);
      expectCleanRuns({ programResult, trimmedResult });
    });

    test("have a guard edge where the call is guarded, and the guard aborts inside the first", async () => {
      using dir = tempDir("trim-macho-two", requiring(entryGuarding("Other", "entry_of_other")));
      const folder = String(dir);
      const { table, programResult, trimmedResult } = await linked(machine, folder, { objects, removed: [Other] });
      expect(table.edges).toEqual([
        { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: true },
      ]);
      expect(readFileSync(join(folder, "program.trim/requires.txt"), "utf8")).toBe(
        `${Extra} enters ${Other}: aborting guard\n`,
      );
      expectCleanRuns({ programResult, trimmedResult });
      if (machine.canRun) expect(await exitCodeOf(folder, "trimmed", guardedArguments)).toBe(70);
    });

    describe("of which JavaScript enters the first as a built-in, whose code enters the second", () => {
      const files = {
        ...requiring(entryGuarding("Other", "entry_of_other")),
        "main.c": mainEnteringBuiltin(spelledBuiltin),
      };

      test("link when the built-in declares both uses, and the table answers for the edge", async () => {
        using dir = tempDir("trim-macho-two", files);
        const builtins = [builtinUsing(spelledBuiltin, "toy.extra", Extra, Other)];
        const { table, featuresOf } = await linked(machine, String(dir), { objects, builtins });
        expect(table.edges).toEqual([
          { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: false },
        ]);
        expect(["entered", "entry_of_other"].map(featuresOf)).toEqual([[Extra], [Other]]);
      });

      test("fail the link when the built-in does not declare the second use", async () => {
        using dir = tempDir("trim-macho-two", files);
        const folder = String(dir);
        const builtins = [builtinUsing(spelledBuiltin, "toy.extra", Extra)];
        expectLinkFailure(folder, "program", await wrapped(machine, folder, { objects, builtins }), [
          "UndeclaredUse: toy.extra (entered (entry.o, ",
          `reaches a guard of ${Other}, and its table entry has no "uses ${Other}"`,
        ]);
      });
    });
  });

  describe("a table in data that holds the address of a built-in's C function", () => {
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
      using dir = tempDir("trim-macho-table", { ...sources, "natives.c": natives, "main.c": mainCalling(otherwise) });
      const folder = String(dir);
      const { featuresOf, programResult, trimmedResult } = await linked(machine, folder, { objects, builtins });
      expect(["entered", "feature_code", "natives"].map(featuresOf)).toEqual([[Extra], [Extra], undefined]);
      expect(entryPointsText(folder, "program")).toMatch(/ entered \(entry\.o, \d+ bytes\) <- natives \(natives\.o, /);
      expectCleanRuns({ programResult, trimmedResult });
    });
  });

  describe("what the executable exports", () => {
    test("belongs to the features that load code that can call it; an exported entry point has its own feature too", async () => {
      using dir = tempDir("trim-macho-exports", {
        ...sources,
        "more.c": `
          ${mixingFunction("only_for_loaded_code", 3)}
          __attribute__((noinline)) int for_loaded_code(int x) { for (int i = 0; i < 5; i++) x = x * 7 + i; return only_for_loaded_code(x); }
          __attribute__((noinline)) int entry_of_other(int x) { for (int i = 0; i < 5; i++) x = x * 11 + i; return x; }
        `,
        "main.c": `
          ${start}
          int entry_of_other(int);
          int main(int argc, char **argv) { return argc > 6 ? GUARDED(Other, entry_of_other, argc) : argc > 5 ? GUARDED(Extra, entered, argc) : 0; }
        `,
        "exported.txt": "_main\n_for_loaded_code\n_entry_of_other\n",
      });
      const { featuresOf, programResult, trimmedResult } = await linked(machine, String(dir), {
        objects: ["feature_code", "entry", "more", "embedder", "main"],
      });
      expect(["for_loaded_code", "only_for_loaded_code", "entry_of_other", "feature_code_0"].map(featuresOf)).toEqual([
        exportFeatures,
        exportFeatures,
        sortedByIndex(Other, ...exportFeatures),
        [Extra],
      ]);
      expectCleanRuns({ programResult, trimmedResult });
    });
  });

  describe("each stub", () => {
    const rustTarget = machine.isArm64 ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
    const linkFlags = machine.canRun ? [] : ["-Wl,-undefined,dynamic_lookup"];
    const headerCompiles = async (folder: string) => {
      if (guardHeader === undefined) return false;
      writeFileSync(join(folder, "probe.cpp"), `#include "toy.h"\n`);
      return (
        (await run([tools.clang!, `--target=${machine.target}`, ...cxxFlags, "-fsyntax-only", "probe.cpp"], folder))
          .exitCode === 0
      );
    };

    test("of the engine's header does what its kind says", async () => {
      using dir = tempDir("trim-macho-stubs", { ...sources, "toy.h": toyHeader, "spellings.cpp": spellingsSource });
      const folder = String(dir);
      if (!(await headerCompiles(folder)))
        return skipNotice(
          testFile,
          guardHeaderSkipReason ?? `the engine's header does not compile for ${machine.target}`,
        );
      const { entryAddresses, featuresAt, programResult, trimmedResult } = await linked(machine, folder, {
        objects: ["feature_code", "embedder", "spellings"],
        linkFlags,
      });
      expect(entryAddresses.size).toBeGreaterThan(0);
      expect([...entryAddresses].map(featuresAt)).toEqual([...entryAddresses].map(() => [Extra]));
      expectCleanRuns({ programResult, trimmedResult });
      if (programResult === undefined || trimmedResult === undefined) return;
      expect(programResult.stdout).toBe(wholeSpellingsOutput + "\n");
      expect(trimmedResult.stdout).toBe(trimmedSpellingsOutput + "\n");
      expect(await exitCodeOf(folder, "trimmed", ["abort"])).toBe(70);
    });

    test("of the Rust crate does what its kind says", async () => {
      using dir = tempDir("trim-macho-stubs", {
        ...sources,
        "embedder.c": embedderSource("macho", { stateFromRust: true, exit: exits }),
        "toy.rs": rustSource,
        "main.c": `
          int printf(const char *, ...);
          int rust_call_abort(int), rust_call_default(int), rust_call_or(int), rust_body_abort(int), rust_body_default(int);
          _Bool rust_is_removed(void);
          int main(int argc, char **argv) {
            if (argc == 2) return rust_call_abort(1) & 63;
            if (argc == 3) return rust_body_abort(1) & 63;
            printf("%d %d,%d %d %s\\n", rust_call_default(1), rust_body_default(1), rust_body_default(-1), rust_call_or(1), rust_is_removed() ? "true" : "false");
            return 0;
          }
        `,
      });
      const folder = String(dir);
      const rustc = Bun.which("rustc");
      const crate = rustc === null ? undefined : await buildGuardCrate(folder, rustc, rustTarget);
      if (crate === undefined) return skipNotice(testFile, `rustc cannot build for ${rustTarget}`);
      const archive = await compileRust(folder, rustc!, crate, "toy.rs", { target: rustTarget });
      const { entryAddresses, featuresAt, programResult, trimmedResult } = await linked(machine, folder, {
        objects: ["feature_code", "embedder", "main"],
        inputs: [archive],
        linkFlags,
      });
      expect(entryAddresses.size).toBeGreaterThan(0);
      expect([...entryAddresses].map(featuresAt)).toEqual([...entryAddresses].map(() => [Extra]));
      expectCleanRuns({ programResult, trimmedResult });
      if (programResult === undefined || trimmedResult === undefined) return;
      expect(programResult.stdout).toMatch(/^-?\d*[13579] -?\d*[13579],7 -?\d*[13579] false\n$/);
      expect(trimmedResult.stdout).toBe("0 0,0 -2 true\n");
      expect([await exitCodeOf(folder, "trimmed", ["a"]), await exitCodeOf(folder, "trimmed", ["a", "b"])]).toEqual([
        70, 70,
      ]);
    });
  });
});
