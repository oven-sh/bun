import { trimExecutable } from "bun:internal-for-testing";
import { expect, setDefaultTimeout } from "bun:test";
import { describe, test } from "../../aot/harness/declare";
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
import { builtinModulesHeaderBytes, createLinker, parseArguments } from "../../../scripts/build/trim/link.ts";
import { peImage } from "../../../scripts/build/trim/linked-image.ts";
import { coff } from "../../../scripts/build/trim/linker-coff.ts";
import { foldedEntryPointsHeading } from "../../../scripts/build/trim/report.ts";
import { packageOf } from "../icu-data-package.ts";
import {
  baseRelocationDirectory,
  bigObjectMagic,
  byIndex,
  chunkAddresses,
  defaultObjects,
  expectSoundPe,
  exportedSource,
  freestandingSkipReasons,
  freestandingSources,
  guardObjects,
  linked,
  moreObjects,
  objcopy,
  output,
  plainLink,
  pointerRelocationType,
  readPe,
  recordRelocationTypes,
  rustc,
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
  builtinUsing,
  callAll,
  compileRust,
  embedderSource,
  entryCalling,
  entryGuarding,
  entryPointsText,
  equalFunction,
  expectLinkFailure,
  exportFeatures,
  Extra,
  indexOf,
  mainEnteringBuiltin,
  mainGuardingBoth,
  manyFunctions,
  model,
  Other,
  otherSource,
  plainSpellingsEntryPoints,
  plainSpellingsSource,
  reviewFiles,
  run,
  rustSource,
  skipNotice,
  spelledBuiltin,
  spellingsStubs,
  start,
  writeLinkInputs,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

const testFile = "link-coff-freestanding.test.ts";
const machines: Machine[] = ["x64", "arm64"];
for (const machine of machines) {
  const reason = freestandingSkipReasons[machine];
  if (reason !== undefined) skipNotice(testFile, `${reason}: the cases for ${machine} do not run`);
}

describe.concurrent.each(machines)("a trimmable link with lld-link and no library, for %s", machine => {
  const testLink = test.skipIf(freestandingSkipReasons[machine] !== undefined);
  // A link of thousands of functions. Beside twenty others on a machine with few processors it gets a twentieth of them, and a minute is not enough.
  const testLargeLink = test.serial.skipIf(freestandingSkipReasons[machine] !== undefined);
  const optionsWith = (more: LinkOptions = {}): LinkOptions => ({ machine, isFreestanding: true, ...more });
  const sources = freestandingSources();
  // Where the size of the feature's code decides nothing.
  const smallSources = freestandingSources(40);
  const twoFeatureObjects = ["feature_code", "entry", "other", "embedder", "main"];
  // As Bun is compiled: a function that only returns has a frame, and so unwind records.
  const framesInLeaves = ["-fasynchronous-unwind-tables", "-fno-omit-frame-pointer", "-mno-omit-leaf-frame-pointer"];
  const mainReturning = (declarations: string, result: string) => `
    ${start}
    ${declarations}
    int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : ${result}; }
  `;

  testLargeLink("removes a feature and cuts its pages out of the PE file", async () => {
    using dir = tempDir("trim-coff-freestanding", freestandingSources(4000));
    const folder = String(dir);
    const { executable, trimmedExecutable, addressOf, featuresOf, summary, soundness } = await linked(
      folder,
      optionsWith(),
    );
    expect(peImage(executable).isArm64).toBe(machine === "arm64");
    const removable = ["feature_code", "feature_code_0", "feature_code_3999", "entered", "feature_numbers"];
    expect(removable.map(featuresOf)).toEqual(removable.map(() => [Extra]));
    expect(["retained", "main", "retained_table"].map(featuresOf)).toEqual([undefined, undefined, undefined]);
    expect(addressOf("feature_table")).toBe(addressOf("retained_table"));
    // What the model says cannot be without the feature goes with it.
    expect(summary.removed).toContain(Extra);
    expect(summary.removed).not.toContain(Other);
    expect(summary.removedBytes).toBeGreaterThan(100_000);
    expect(summary.fileBytesSaved).toBeGreaterThanOrEqual(128 * 1024);
    expect(statSync(executable).size - statSync(trimmedExecutable).size).toBe(summary.fileBytesSaved);
    expect(soundness.cutSectionCount).toBeGreaterThan(0);
    expect(soundness.filledBytes).toBeGreaterThan(0);
    expect([...new Set(recordRelocationTypes(join(folder, "main.obj")))]).toEqual([pointerRelocationType[machine]]);
  });

  testLink("lists the section of the built-in modules with the features that read it", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "entry.c": entryCalling("read_builtins"),
      "builtins.c": `__attribute__((section(".bunblt"))) const char builtins_text[20000] = {1};
        __attribute__((noinline)) int read_builtins(int x) { return builtins_text[x & 8191]; }`,
    });
    const { addressOf, featuresAt, summary } = await linked(
      String(dir),
      optionsWith({ objects: ["feature_code", "entry", "builtins", "table", "embedder", "main"] }),
    );
    const builtins = addressOf("builtins_text");
    // Whoever builds an executable reads the header.
    expect([0, builtinModulesHeaderBytes - 1].map(offset => featuresAt(builtins + offset))).toEqual([
      undefined,
      undefined,
    ]);
    expect([builtinModulesHeaderBytes, 19_999].map(offset => featuresAt(builtins + offset))).toEqual([
      [Extra],
      [Extra],
    ]);
    expect(summary.removedBytes).toBeGreaterThan(20_000 - builtinModulesHeaderBytes);
  });

  testLink("reads the members of an archive where the objects that went into it lie beside it", async () => {
    using dir = tempDir("trim-coff-freestanding", smallSources);
    const { featuresOf, summary } = await linked(
      String(dir),
      optionsWith({
        archives: { "shelf.lib": ["feature_code", "entry", "table", "embedder", "main"] },
        keepsArchivedObjects: true,
      }),
    );
    expect(["feature_code", "entered", "feature_numbers"].map(featuresOf)).toEqual([[Extra], [Extra], [Extra]]);
    expect(["retained", "main"].map(featuresOf)).toEqual([undefined, undefined]);
    expect(summary.removed).toContain(Extra);
  });

  testLink("links what it compiled from bitcode where every object of bitcode is a member of an archive", async () => {
    using dir = tempDir("trim-coff-freestanding", smallSources);
    const objects = ["feature_code", "entry", "table", "embedder", "main"];
    const { featuresOf, summary } = await linked(
      String(dir),
      optionsWith({
        archives: { "shelf.lib": objects },
        compileFlags: Object.fromEntries(objects.map(name => [name, thinLtoFlags])),
      }),
    );
    expect(["entered", "retained", "main"].map(featuresOf)).toEqual([[Extra], undefined, undefined]);
    expect(summary.removed).toContain(Extra);
  });

  describe("links what it compiled from bitcode without the bitcode", () => {
    const aliasedSources = {
      ...smallSources,
      // As `??_E..`, the vector deleting destructor, is an alias of `??_G..` in every C++ class with a virtual destructor.
      "aliased.c": `
        __attribute__((noinline)) int aliased_target(int value) { return value + 1; }
        extern __typeof(aliased_target) aliased_name __attribute__((weak, alias("aliased_target")));
        extern __typeof(aliased_target) alias_nobody_names __attribute__((weak, alias("aliased_target")));
        __attribute__((noinline)) int beside_the_alias(int value) { return value * 3; }
        int (*const volatile aliased_table[])(int) = { aliased_name, beside_the_alias };`,
      "main.c": mainReturning("extern int (*const volatile aliased_table[])(int);", "aliased_table[argc & 1](argc)"),
    };
    const aliasedObjects = ["feature_code", "entry", "table", "embedder", "main", "aliased"];
    const asBitcode = (names: string[]) => Object.fromEntries(names.map(name => [name, thinLtoFlags]));
    const compilesAgain = "the second link compiles the bitcode again";

    test.each([
      ["a member of an archive", { "shelf.lib": aliasedObjects }],
      ["a file of its own", {}],
    ])("where %s refers to a weak alias, which what is compiled from it does not define", async (_, archives) => {
      if (freestandingSkipReasons[machine] !== undefined) return;
      using dir = tempDir("trim-coff-freestanding", aliasedSources);
      const folder = String(dir);
      const { addressOf, featuresOf, summary } = await linked(
        folder,
        optionsWith({ objects: aliasedObjects, archives, compileFlags: asBitcode(aliasedObjects) }),
      );
      expect(addressOf("beside_the_alias")).toBeGreaterThan(0);
      expect(["entered", "main", "aliased_target"].map(featuresOf)).toEqual([[Extra], undefined, undefined]);
      expect(summary.removed).toContain(Extra);
      // Only the alias that something refers to: the target of another may be gone.
      expect(readFileSync(join(folder, "work", "aliases.s"), "latin1")).toBe(
        '\t.weak\t"aliased_name"\n"aliased_name" = "aliased_target"\n',
      );
    });

    testLink("where the copy of a COMDAT that prevailed came from a native member of a later archive", async () => {
      const shared = `__declspec(selectany) extern const volatile int shared_words[4] = { 2, 3, 5, 7 };`;
      using dir = tempDir("trim-coff-freestanding", {
        ...smallSources,
        "native_step.c": `${shared} int bitcode_step(int); int native_step(int x) { return shared_words[x & 3] + bitcode_step(x); }`,
        "bitcode_step.c": `${shared} __attribute__((noinline)) int bitcode_step(int x) { return shared_words[(x + 1) & 3]; }`,
        "main.c": mainReturning("int native_step(int);", "native_step(argc)"),
      });
      const folder = String(dir);
      const { addressOf, summary } = await linked(
        folder,
        optionsWith({
          objects: [...defaultObjects, "native_step", "bitcode_step"],
          archives: { "bitcode.lib": ["bitcode_step"], "native.lib": ["native_step"] },
          compileFlags: asBitcode(["bitcode_step"]),
        }),
      );
      expect(["shared_words", "bitcode_step"].map(addressOf)).toEqual([expect.any(Number), expect.any(Number)]);
      expect(summary.removed).toContain(Extra);
      expect(existsSync(join(folder, "work", "aliases.s"))).toBe(false);
    });

    // Their names are too long for the header of a member, so the copy of the archive has to keep the table of long names readable.
    testLink("keeps the members of an archive that are no bitcode", async () => {
      const [bitcode, native] = ["a_member_of_bitcode_with_a_long_name", "a_native_member_with_a_long_name"];
      using dir = tempDir("trim-coff-freestanding", {
        ...smallSources,
        [`${bitcode}.c`]: `int from_native(int); __attribute__((noinline)) int from_bitcode(int x) { return from_native(x) + 1; }`,
        [`${native}.c`]: `int from_native(int x) { return x * 7; }`,
        "main.c": mainReturning("int from_bitcode(int);", "from_bitcode(argc)"),
      });
      const { addressOf } = await linked(
        String(dir),
        optionsWith({
          objects: [...defaultObjects, bitcode, native],
          archives: { "mixed.lib": [bitcode, native] },
          compileFlags: asBitcode([bitcode]),
        }),
      );
      expect(["from_bitcode", "from_native"].map(addressOf)).toEqual([expect.any(Number), expect.any(Number)]);
    });

    // lld-link writes what it compiled from both to one file name, the second over the first.
    testLink("but compiles it again where two members of bitcode of one archive have one name", async () => {
      using dir = tempDir("trim-coff-freestanding", {
        ...smallSources,
        "a/same.c": `__attribute__((noinline)) int from_a(int x) { return x + 1; }`,
        "b/same.c": `__attribute__((noinline)) int from_b(int x) { return x + 2; }`,
        "main.c": mainReturning("int from_a(int); int from_b(int);", "from_a(argc) + from_b(argc)"),
      });
      const result = await wrapped(
        String(dir),
        optionsWith({
          objects: [...defaultObjects, "a/same", "b/same"],
          archives: { "shelf.lib": ["a/same", "b/same"] },
          compileFlags: asBitcode(["a/same", "b/same"]),
        }),
      );
      expect({ stderr: result.stderr, exitCode: result.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(result.stdout).toContain(compilesAgain);
    });
  });

  testLink("writes the four review files, the table and the state", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    const { executable, table } = await linked(folder, optionsWith());
    expect(reviewFiles(folder, output)).toEqual([
      "entry-points.txt",
      "groups.txt",
      "needs.txt",
      "requires.txt",
      "retained-by.txt",
    ]);
    const entryPoints = entryPointsText(folder, output).trimEnd().split("\n");
    expect(entryPoints).toHaveLength(1);
    expect(entryPoints[0]).toStartWith(`${Extra} Abort `);
    expect(table.sets).toEqual([[indexOf(Extra)]]);
    expect(table.edges).toEqual([]);
    expect(sectionInFile(executable, ".buntrim")).toBeDefined();
    const state = sectionInFile(executable, ".bunfeat")!;
    expect(state.size).toBeGreaterThanOrEqual(stateBytes);
    const { file, sections } = readPe(executable);
    expect(file.toString("latin1", state.offset, state.offset + 8)).toBe("BUNFEAT\0");
    // The records are for the link alone.
    expect(sections.filter(({ name }) => name.startsWith(".bun_rem"))).toEqual([]);
  });

  testLink("keeps the order file that the command names behind its own", async () => {
    using dir = tempDir("trim-coff-freestanding", { ...smallSources, "mine.txt": "retained\nmain\n" });
    const folder = String(dir);
    await linked(folder, optionsWith({ linkFlags: ["/order:@mine.txt"] }));
    expect(readFileSync(join(folder, "work", "order.txt"), "latin1")).toEndWith("retained\nmain\n");
  });

  testLink("writes the same bytes in another folder", async () => {
    using first = tempDir("trim-coff-freestanding-first", smallSources);
    using second = tempDir("trim-coff-freestanding-second", smallSources);
    const linkResults = await Promise.all([first, second].map(dir => wrapped(String(dir), optionsWith())));
    expect(linkResults.map(({ exitCode }) => exitCode)).toEqual([0, 0]);
    expect(readFileSync(join(String(first), output)).equals(readFileSync(join(String(second), output)))).toBe(true);
  });

  testLink("tells two static functions with the same name apart", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "one.c": `static __attribute__((noinline)) int helper(int x) { return x * 7 + 1; } int from_one(int x) { return helper(x) + 1; }`,
      "two.c": `static __attribute__((noinline)) int helper(int x) { return x * 13 + 5; } int from_two(int x) { return helper(x) + 2; }`,
      "entry.c": entryCalling("from_two"),
      "main.c": mainReturning("int from_one(int);", "from_one(argc) == 9 ? 0 : 1"),
    });
    const objects = ["feature_code", "entry", "one", "two", "embedder", "main"];
    const { symbols, featuresOf, featuresAt } = await linked(String(dir), optionsWith({ objects }));
    expect(["from_one", "from_two"].map(featuresOf)).toEqual([undefined, [Extra]]);
    const helpers = symbols.filter(([name]) => name === "helper").map(([, address]) => featuresAt(address));
    expect(helpers).toHaveLength(2);
    expect(helpers).toContainEqual(undefined);
    expect(helpers).toContainEqual([Extra]);
  });

  testLink(
    "finds an entry point without a mark that the link compiles from bitcode, and deletes what it compiled",
    async () => {
      using dir = tempDir("trim-coff-freestanding", {
        ...smallSources,
        "entry.c": `int feature_code(int); int entered(int x) { return feature_code(x) * 3 + feature_code(x + 1); }`,
        // As the guard of the engine's header: the call is not inlined, whatever the function says of itself.
        "main.c": `
          ${start}
          int main(int argc, char **argv) {
            if (argc <= 5) return 0;
            if (Bun__removableFeatureState.removal[Extra]) Bun__abortForRemovedFeature(Extra);
            RECORD(Extra, entered);
            [[clang::noinline]] return entered(argc) & 63;
          }
        `,
      });
      const folder = String(dir);
      const compileFlags = { entry: thinLtoFlags, main: [...thinLtoFlags, "-std=c23"] };
      const { featuresOf } = await linked(folder, optionsWith({ objects: guardObjects, compileFlags }));
      expect(featuresOf("entered")).toEqual([Extra]);
      const left = [...readdirSync(folder), ...readdirSync(join(folder, "work"))];
      expect(left.filter(name => name.includes(".lto."))).toEqual([]);
    },
  );

  testLargeLink("repoints the debug directory of a file whose sections were split", async () => {
    using dir = tempDir("trim-coff-freestanding", freestandingSources(4000));
    const folder = String(dir);
    const { soundness } = await linked(folder, optionsWith({ linkFlags: ["/debug", "/pdb:program.pdb"] }));
    expect(existsSync(join(folder, "program.pdb"))).toBe(true);
    expect(soundness.cutSectionCount).toBeGreaterThan(0);
    expect(soundness.codeViewEntries).toBeGreaterThan(0);
  });

  testLink("drops the base relocations of the pages it cuts", async () => {
    const pointerCount = 40_000;
    const fullBlockBytes = 8 + 2 * 512;
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "feature_code.c": `
        ${manyFunctions("feature_code_", 1500)}
        int (*const feature_pointers[${pointerCount}])(int) = { [0 ... ${pointerCount - 1}] = feature_code_0 };
        int feature_code(int x) { ${callAll("feature_code_", 1500)} return x + feature_pointers[(unsigned)x % ${pointerCount}](x); }
      `,
    });
    const { executable, trimmedExecutable, featuresOf, soundness } = await linked(String(dir), optionsWith());
    expect(featuresOf("feature_pointers")).toEqual([Extra]);
    expect(soundness.cutSectionCount).toBeGreaterThan(0);
    const relocationBytes = (path: string) => readPe(path).directoryBytes(baseRelocationDirectory).length;
    expect(relocationBytes(executable) - relocationBytes(trimmedExecutable)).toBeGreaterThanOrEqual(
      60 * fullBlockBytes,
    );
  });

  testLink("records a reference where one feature calls the other's entry point directly", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "entry.c": entryCalling("entry_of_other"),
      "other.c": otherSource,
      "main.c": mainGuardingBoth,
    });
    const folder = String(dir);
    const { table, featuresOf } = await linked(folder, optionsWith({ objects: twoFeatureObjects }));
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "Reference", isFollowed: true },
    ]);
    expect(readFileSync(join(folder, `${output}.trim`, "requires.txt"), "utf8")).toStartWith(
      `${Extra} requires ${Other}: 1 references`,
    );
    expect(featuresOf("entry_of_other")).toEqual([Other]);
  });

  testLink("records a guard where the call is guarded", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "entry.c": entryGuarding("Other", "entry_of_other"),
      "other.c": otherSource,
      "main.c": mainGuardingBoth,
    });
    const folder = String(dir);
    const { table } = await linked(folder, { ...optionsWith({ objects: twoFeatureObjects }), removed: [Other] });
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: true },
    ]);
    expect(readFileSync(join(folder, `${output}.trim`, "requires.txt"), "utf8")).toBe(
      `${Extra} enters ${Other}: aborting guard\n`,
    );
  });

  testLink(
    "puts what the command's order file lists of the features between the features and the rest of the list",
    async () => {
      using dir = tempDir("trim-coff-freestanding", { ...sources, "mine.txt": "retained\nentered\nmain\n" });
      const folder = String(dir);
      const { addressOf, featuresOf } = await linked(folder, optionsWith({ linkFlags: ["/order:@mine.txt"] }));
      const orderedNames = readFileSync(join(folder, "work/order.txt"), "latin1").split("\n").filter(Boolean);
      expect(orderedNames.slice(-3)).toEqual(["entered", "retained", "main"]);
      expect(orderedNames.filter(name => name === "entered")).toHaveLength(1);
      expect(orderedNames).toContain("feature_code");
      const addresses = ["feature_code", "entered", "retained", "main"].map(addressOf);
      expect(addresses).toEqual(addresses.toSorted((a, b) => a - b));
      expect(new Set(addresses).size).toBe(4);
      expect(["feature_code", "entered", "retained", "main"].map(featuresOf)).toEqual([
        [Extra],
        [Extra],
        undefined,
        undefined,
      ]);
    },
  );

  describe("the unwind records and jump tables of functions, which have no name", () => {
    // A frame that no packed record on arm64 describes, and a switch that becomes a jump table.
    const framed = (name: string, frame: number, factor: number = 3) => `
      __attribute__((noinline)) int ${name}(int x) {
        volatile int slots[${frame}];
        for (int i = 0; i < ${frame}; i++) slots[i] = x * ${factor} + i;
        int sum = 0;
        for (int i = 0; i < ${frame}; i++) sum += slots[i];
        return sum;
      }`;
    const switching = (name: string, frame: number, firstCase: string = "") => `
      volatile int sink_of_${name};
      ${framed(`frame_of_${name}`, frame)}
      __attribute__((noinline)) int ${name}(int x) {
        volatile int slots[${frame + 100}];
        slots[x & 63] = x;
        switch (x) {
          case 0: ${firstCase} return 11; case 1: sink_of_${name} = 5; return 7; case 2: return x * 3; case 3: sink_of_${name} = 9; return 1;
          case 4: return 90; case 5: sink_of_${name} = x; return 4; case 6: return 77; case 7: sink_of_${name} = 2; return 8;
          case 8: return 1234; case 9: sink_of_${name} = 3; return 6; case 10: return 55; default: return frame_of_${name}(x);
        }
      }`;
    const mainCalling = (name: string) => `
      ${start}
      int ${name}(int);
      __attribute__((noinline)) int retained(int x) { return ${name}(x); }
      int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : retained(argc); }`;
    const objects = ["feature_code", "entry", "removable_shapes", "kept_shapes", "embedder", "main"];
    const shapeSources = {
      ...smallSources,
      "entry.c": entryCalling("removable"),
      "removable_shapes.c": switching("removable", 700, "sink_of_removable = 21;"),
      "kept_shapes.c": switching("kept", 900),
      "main.c": mainCalling("kept"),
    };
    const compiledWith = (flags: string[]) =>
      Object.fromEntries(objects.map(name => [name, [...flags, ...framesInLeaves]]));
    const inputKinds: [string, LinkOptions][] = [
      ["objects", { compileFlags: compiledWith(["-O2"]) }],
      ["bitcode", { compileFlags: compiledWith(thinLtoFlags) }],
      ["objects in an archive", { compileFlags: compiledWith(["-O2"]), archives: { "shelf.lib": objects } }],
      ["bitcode in an archive", { compileFlags: compiledWith(thinLtoFlags), archives: { "shelf.lib": objects } }],
    ];

    describe.each(inputKinds)("of %s", (_, inputs) => {
      testLink("go with the feature that the function belongs to, and lie together", async () => {
        using dir = tempDir("trim-coff-freestanding", shapeSources);
        const folder = String(dir);
        const { featuresAt, unwindRecordOf } = await linked(folder, optionsWith({ objects, ...inputs }));
        expect(featuresAt(unwindRecordOf("frame_of_removable"))).toEqual([Extra]);
        expect(unwindRecordOf("frame_of_kept")).not.toBeNaN();
        expect(featuresAt(unwindRecordOf("frame_of_kept"))).toBeUndefined();
        for (const section of [".rdata", ".xdata"]) {
          const removable = chunkAddresses(folder, "removable_shapes", section);
          const kept = chunkAddresses(folder, "kept_shapes", section);
          expect({ section, removable: removable.length > 0, kept: kept.length > 0 }).toEqual({
            section,
            removable: true,
            kept: true,
          });
          expect(removable.map(featuresAt)).toEqual(removable.map(() => [Extra]));
          expect(kept.map(featuresAt)).toEqual(kept.map(() => undefined));
          expect(Math.max(...removable)).toBeLessThan(Math.min(...kept));
        }
      });
    });

    testLink("keep a record that a function of the feature shares with a function that stays", async () => {
      using dir = tempDir("trim-coff-freestanding", {
        ...shapeSources,
        "removable_shapes.c": framed("removable", 800),
        "kept_shapes.c": framed("kept", 800, 5),
      });
      const { addressOf, featuresOf, featuresAt, unwindRecordOf } = await linked(
        String(dir),
        optionsWith({ objects, compileFlags: compiledWith(["-O2"]) }),
      );
      expect(addressOf("removable")).not.toBe(addressOf("kept"));
      expect(unwindRecordOf("removable")).toBe(unwindRecordOf("kept"));
      expect([featuresOf("removable"), featuresOf("kept"), featuresAt(unwindRecordOf("kept"))]).toEqual([
        [Extra],
        undefined,
        undefined,
      ]);
    });

    testLink("keep a jump table that a function of the feature shares with a function that stays", async () => {
      using dir = tempDir("trim-coff-freestanding", {
        ...shapeSources,
        "removable_shapes.c": switching("removable", 700),
      });
      const folder = String(dir);
      const { featuresOf, featuresAt } = await linked(
        folder,
        optionsWith({ objects, compileFlags: compiledWith(["-O2"]) }),
      );
      expect([featuresOf("removable"), featuresOf("kept")]).toEqual([[Extra], undefined]);
      const tables = ["removable_shapes", "kept_shapes"].flatMap(object => chunkAddresses(folder, object, ".rdata"));
      // On arm64 a table holds distances inside its function: two functions of one shape have equal tables, and the linker keeps one.
      expect(tables.map(featuresAt)).toEqual(machine === "arm64" ? [undefined] : [[Extra], undefined]);
    });

    testLink("leave nothing in the image without a known reference but the room for the table", async () => {
      using dir = tempDir("trim-coff-freestanding", shapeSources);
      const folder = String(dir);
      const { executable, table, stdout } = await linked(
        folder,
        optionsWith({ objects, compileFlags: compiledWith(["-O2"]) }),
      );
      expect(stdout).toContain("0.00 MB are in the image without a known reference and are retained");
      const retained = readFileSync(join(folder, "work/retained.txt"), "utf8").trimEnd().split("\n");
      // The second number of a line is the section before it on the way from a root: a root has none.
      const roots = retained.filter(line => Number(line.split(" ")[1]) < 0 && / \.rdata /.test(line));
      expect(roots).toEqual([]);
      expect(table.ranges.length).toBeGreaterThan(0);
      expect(sectionInFile(executable, ".buntrim")).toBeDefined();
    });

    testLink("keep a section with its function where nothing refers to the section", async () => {
      using dir = tempDir("trim-coff-freestanding", {
        ...shapeSources,
        "kept_shapes.c": `${switching("kept", 900)}
          __asm__(".section .rdata,\\"dr\\",associative,kept\\n.long 0x5eed5eed\\n.text\\n");`,
      });
      const { executable } = await linked(String(dir), optionsWith({ objects, compileFlags: compiledWith(["-O2"]) }));
      expect(readFileSync(executable).includes(Buffer.from([0xed, 0x5e, 0xed, 0x5e]))).toBe(true);
    });
  });

  describe("where JavaScript enters a feature as a built-in, whose code enters a second feature", () => {
    const files = {
      ...sources,
      "entry.c": entryGuarding("Other", "entry_of_other"),
      "other.c": otherSource,
      "main.c": mainEnteringBuiltin(spelledBuiltin),
    };

    testLink("passes when the built-in declares both uses, and the table answers for the edge", async () => {
      using dir = tempDir("trim-coff-freestanding", files);
      const builtins = [builtinUsing(spelledBuiltin, "toy.extra", Extra, Other)];
      const { table, featuresOf } = await linked(String(dir), optionsWith({ objects: twoFeatureObjects, builtins }));
      expect(table.edges).toEqual([
        { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: false },
      ]);
      expect(["entered", "entry_of_other"].map(featuresOf)).toEqual([[Extra], [Other]]);
    });

    testLink("fails when the built-in does not declare the second use", async () => {
      using dir = tempDir("trim-coff-freestanding", files);
      const folder = String(dir);
      const builtins = [builtinUsing(spelledBuiltin, "toy.extra", Extra)];
      expectLinkFailure(folder, output, await wrapped(folder, optionsWith({ objects: twoFeatureObjects, builtins })), [
        "UndeclaredUse: toy.extra (entered (entry.obj, ",
        `reaches a guard of ${Other}, and its table entry has no "uses ${Other}"`,
      ]);
    });
  });

  testLink(
    "takes a guard whose entry point does nothing, so that the compiler removes the call and the linker the function",
    async () => {
      using dir = tempDir("trim-coff-freestanding", {
        ...sources,
        "main.c": `
        ${start}
        __attribute__((noinline)) int does_nothing(int x) { return 0; }
        __attribute__((noinline)) void destroys(int x) { RECORD(Extra, does_nothing); does_nothing(x); }
        int main(int argc, char **argv) {
          destroys(argc);
          return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : 0;
        }
      `,
      });
      const options = optionsWith({ objects: guardObjects, compileFlags: { main: framesInLeaves } });
      const { addressOf, featuresOf } = await linked(String(dir), options);
      expect(addressOf("does_nothing")).toBeNaN();
      expect(["entered", "destroys"].map(featuresOf)).toEqual([[Extra], undefined]);
    },
  );

  testLink("takes such a guard where the link itself compiles both from bitcode and removes the call", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "other.c": `int does_nothing(int x) { return 0; }`,
      "main.c": `
        ${start}
        int does_nothing(int);
        __attribute__((noinline)) void destroys(int x) {
          RECORD(Extra, does_nothing);
          [[clang::noinline]] does_nothing(x);
        }
        int main(int argc, char **argv) {
          destroys(argc);
          return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : 0;
        }
      `,
    });
    const flags = [...thinLtoFlags, ...framesInLeaves];
    const compileFlags = { other: flags, main: [...flags, "-std=c23"] };
    const options = optionsWith({ objects: twoFeatureObjects, compileFlags });
    const { addressOf, featuresOf } = await linked(String(dir), options);
    expect(addressOf("does_nothing")).toBeNaN();
    expect(["entered", "destroys"].map(featuresOf)).toEqual([[Extra], undefined]);
  });

  testLink(
    "removes an entry point that only returns, to which its guard and its own unwind records refer",
    async () => {
      using dir = tempDir("trim-coff-freestanding", {
        ...sources,
        "other.c": `int entry_of_other(int x) { return 0; }`,
        "main.c": mainGuardingBoth,
      });
      const options = optionsWith({ objects: twoFeatureObjects, compileFlags: { other: framesInLeaves } });
      const { featuresOf } = await linked(String(dir), options);
      expect(["entered", "entry_of_other"].map(featuresOf)).toEqual([[Extra], [Other]]);
    },
  );

  testLink("removes an entry point that begins where a symbol marks the end of the function before it", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "entry.c": `
        int feature_code(int);
        __attribute__((noinline, cold)) int entered(int x) { return feature_code(x) * 3 + feature_code(x + 1); }
      `,
      "assembled.c": `__asm__(
        ".section .text$mn,\\"xr\\"\\n.p2align 4\\n"
        ".globl assembled\\n.def assembled\\n.scl 2\\n.type 32\\n.endef\\nassembled:\\n"
        ".fill 4, 4, ${machine === "arm64" ? "0xd65f03c0" : "0xc3c3c3c3"}\\n"
        ".def .ef\\n.scl 101\\n.endef\\n.ef:\\n.text\\n");
      `,
      "main.c": `
        ${start}
        int assembled(int);
        int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : assembled(argc) & 0; }
      `,
    });
    const objects = ["feature_code", "entry", "assembled", "embedder", "main"];
    const { addressOf, featuresOf } = await linked(String(dir), optionsWith({ objects }));
    expect(addressOf(".ef")).toBe(addressOf("entered"));
    expect(["entered", "feature_code", "assembled"].map(featuresOf)).toEqual([[Extra], [Extra], undefined]);
  });

  describe("a table in data that holds the address of a built-in's C++ function", () => {
    const builtins = [{ ...builtinUsing(spelledBuiltin, "toy.extra", Extra), nativeSymbols: ["Toy::entersFeature"] }];
    const objects = ["feature_code", "natives", "embedder", "main"];
    const natives = `
      extern "C" int feature_code(int);
      namespace Toy {
      __attribute__((noinline)) int entersFeature(int x) { return feature_code(x) * 3 + feature_code(x + 1); }
      extern int (*const natives[1])(int);
      int (*const natives[1])(int) = { entersFeature };
      }
    `;
    const mainCalling = (otherwise: string) => `
      #include "guard.h"
      namespace Toy { int entersFeature(int); extern int (*const natives[1])(int); }
      int main(int argc, char **argv) {
        return argc > 6 && !Bun__removableFeatureState.removal[Extra] ? Toy::natives[argc - 7](argc) & 63 : ${otherwise};
      }
    `;
    const files = (otherwise: string) => {
      const { "main.c": _, ...others } = sources;
      return { ...others, "natives.cpp": natives, "main.cpp": mainCalling(otherwise) };
    };

    testLink.each([
      ["alone", "0"],
      [
        "beside a guard in code",
        `argc > 5 ? GUARDED_BUILTIN(Extra, ${spelledBuiltin}, Toy::entersFeature, argc) & 63 : 0`,
      ],
    ])("guards it, %s", async (_, otherwise) => {
      using dir = tempDir("trim-coff-freestanding", files(otherwise));
      const folder = String(dir);
      const { featuresOf } = await linked(folder, optionsWith({ objects, builtins, minimums: { [Extra]: 10_000 } }));
      const names = ["entersFeature@Toy", "feature_code", "natives@Toy"];
      expect(names.map(featuresOf)).toEqual([[Extra], [Extra], undefined]);
      expect(entryPointsText(folder, output)).toMatch(
        / Toy::entersFeature\(int\) \(natives\.obj, \d+ bytes\) <- Toy::natives \(natives\.obj, /,
      );
    });

    testLink("guards functions with internal linkage that the link compiles from bitcode", async () => {
      const { "main.c": _, ...others } = sources;
      using dir = tempDir("trim-coff-freestanding", {
        ...others,
        "natives.cpp": `
          extern "C" int feature_code(int);
          namespace Toy {
          __attribute__((noinline)) static int entersFeature(int x) { return feature_code(x) * 3 + feature_code(x + 1); }
          __attribute__((noinline)) static int alsoEntersFeature(int x) { return feature_code(x) * 5 + feature_code(x + 2); }
          extern int (*const natives[2])(int);
          int (*const natives[2])(int) = { entersFeature, alsoEntersFeature };
          }
        `,
        "main.cpp": `
          #include "guard.h"
          namespace Toy { extern int (*const natives[2])(int); }
          int main(int argc, char **argv) {
            return argc > 6 && !Bun__removableFeatureState.removal[Extra] ? Toy::natives[argc - 7](argc) & 63 : 0;
          }
        `,
      });
      const folder = String(dir);
      const nativeSymbols = ["Toy::entersFeature", "Toy::alsoEntersFeature"];
      const { featuresOf } = await linked(
        folder,
        optionsWith({
          objects,
          builtins: [{ ...builtinUsing(spelledBuiltin, "toy.extra", Extra), nativeSymbols }],
          compileFlags: { natives: thinLtoFlags, main: thinLtoFlags },
          minimums: { [Extra]: 10_000 },
        }),
      );
      const names = ["entersFeature@Toy", "alsoEntersFeature@Toy", "feature_code", "natives@Toy"];
      expect(names.map(featuresOf)).toEqual([[Extra], [Extra], [Extra], undefined]);
    });
  });

  testLink("takes the functions of the instantiation that a cxx-function pattern names", async () => {
    const { "main.c": _, ...others } = sources;
    const response = `namespace uWS { template<bool SSL> struct HttpResponse { static int end(int); }; }`;
    using dir = tempDir("trim-coff-freestanding", {
      ...others,
      "sockets.cpp": `
        ${response}
        extern "C" int feature_code(int);
        template<bool SSL> __attribute__((noinline)) int uWS::HttpResponse<SSL>::end(int x) {
          return SSL ? feature_code(x) * 3 + feature_code(x + 1) : x;
        }
        template struct uWS::HttpResponse<true>;
        template struct uWS::HttpResponse<false>;
      `,
      "main.cpp": `
        ${response}
        int main(int argc, char **argv) {
          return argc > 5 ? uWS::HttpResponse<true>::end(argc) & 63 : uWS::HttpResponse<false>::end(argc) & 0;
        }
      `,
    });
    const folder = String(dir);
    const objects = ["feature_code", "sockets", "embedder", "main"];
    const builtins = [builtinUsing(spelledBuiltin, "toy.tls", "TlsSockets")];
    const { featuresOf } = await linked(folder, { ...optionsWith({ objects, builtins }), removed: ["TlsSockets"] });
    const names = ["end@?$HttpResponse@$00@uWS", "feature_code", "end@?$HttpResponse@$0A@@uWS"];
    expect(names.map(featuresOf)).toEqual([["TlsSockets"], ["TlsSockets"], undefined]);
    expect(entryPointsText(folder, output)).toMatch(
      /^TlsSockets Abort \d+ uWS::HttpResponse<1>::end\(int\) \(sockets\.obj, /,
    );
  });

  describe("retained code reaches a feature's code by", () => {
    interface ReachCase extends Pick<LinkOptions, "linkFlags" | "archives" | "afterCompile"> {
      more: string;
      declarations: string;
      result: string;
      /** Both files are C++, and these stand in front of `extern "C"`. */
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
        // What the C run time has for every program with such a variable.
        declarations: `
          unsigned _tls_index;
          char __tls_guard = 1;
          void __dyn_tls_on_demand_init(void) {}
          extern __declspec(thread) int (*hook)(int);
        `,
        result: "hook(argc) == 8 ? 0 : 1",
        retained: ["feature_hooked"],
      },
      "an associative section of a retained function": {
        more: `__attribute__((noinline)) int feature_noted(int x) { return x * 5; } int more(int x) { return feature_noted(x); }`,
        declarations: String.raw`__attribute__((noinline)) int parent(int x) { return x + 1; }
__asm__(".section .rdata$note,\"dr\",associative,parent\n.quad feature_noted\n.text\n");`,
        result: "parent(argc) == 2 ? 0 : 1",
        retained: ["feature_noted", "parent"],
      },
      "equal read-only data without an external name": {
        more: `static const int feature_primes[64] = { 2, 3, 5, 7, 11 }; int more(int x) { return feature_primes[x & 63]; }`,
        declarations: "static const int retained_primes[64] = { 2, 3, 5, 7, 11 };",
        // Asked only whether it is 3, the number is never read: LLVM 23 asks whether argc is 1, and the list is gone.
        result: "retained_primes[argc] - 3",
        retained: [],
        check({ addressOf, featuresOf }) {
          const listed = ["retained_primes", "feature_primes"];
          expect(addressOf("retained_primes")).toBe(addressOf("feature_primes"));
          expect(listed.map(featuresOf)).toEqual(listed.map(() => undefined));
        },
      },
      "an archive member": { ...foldedFunction, archives: { "shelf.lib": ["feature_code", "more"] } },
      "a big object": {
        more: [targetSource, ...Array.from({ length: 70_000 }, (_, index) => `int big_${index} = ${index};`)].join(
          "\n",
        ),
        declarations: "int feature_target(int);",
        result: "feature_target(argc) == 7 ? 0 : 1",
        retained: ["feature_target"],
        afterCompile: folder =>
          expect([...readFileSync(join(folder, "more.obj")).subarray(0, 4)]).toEqual(bigObjectMagic),
      },
    };

    for (const [name, reach] of Object.entries(reachCases)) {
      testLink(name, async () => {
        const { "main.c": _, ...withoutMain } = smallSources;
        const { cxxDeclarations } = reach;
        const main =
          cxxDeclarations === undefined
            ? mainReturning(reach.declarations, reach.result)
            : `
              #include "guard.h"
              ${cxxDeclarations}
              extern "C" int entered(int);
              extern "C" int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : ${reach.result}; }
            `;
        const extension = cxxDeclarations === undefined ? "c" : "cpp";
        using dir = tempDir("trim-coff-freestanding-reach", {
          ...withoutMain,
          "entry.c": entryCalling("more"),
          [`more.${extension}`]: reach.more,
          [`main.${extension}`]: main,
        });
        const { linkFlags, archives, afterCompile } = reach;
        const options = optionsWith({ objects: moreObjects, linkFlags, archives, afterCompile });
        const program = await linked(String(dir), options);
        expect(reach.retained.map(program.featuresOf)).toEqual(reach.retained.map(() => undefined));
        const removable = ["feature_code", "feature_code_0", "feature_code_39"];
        expect(removable.map(program.featuresOf)).toEqual(removable.map(() => [Extra]));
        reach.check?.(program);
      });
    }
  });

  testLink(
    "lists each stub, written out in C as the engine's header writes it, and cuts an executable once",
    async () => {
      using dir = tempDir("trim-coff-freestanding", { ...smallSources, "spellings.c": plainSpellingsSource });
      const folder = String(dir);
      const options = optionsWith({ objects: ["feature_code", "embedder", "spellings"], linkFlags: ["/include:body"] });
      const { executable, trimmedExecutable, featuresOf } = await linked(folder, options);
      const removableLines = entryPointsText(folder, output).split(foldedEntryPointsHeading)[0]!.trimEnd().split("\n");
      expect([...new Set(removableLines.map(line => line.split(" ")[1]!))].sort()).toEqual(spellingsStubs);
      expect(plainSpellingsEntryPoints.map(featuresOf)).toEqual(plainSpellingsEntryPoints.map(() => [Extra]));
      const retained = ["body", "main", "replacement"];
      expect(retained.map(featuresOf)).toEqual(retained.map(() => undefined));
      expect(() => trimExecutable(trimmedExecutable, join(folder, "again.exe"), [Extra])).toThrow("(AlreadyTrimmed)");
      expect(() => trimExecutable(executable, join(folder, "again.exe"), ["NoSuchFeature"])).toThrow(
        `unknown feature "NoSuchFeature"`,
      );
    },
  );

  describe("the guards of the Rust crate", () => {
    const rustMain = `
      int rust_call_abort(int), rust_call_default(int), rust_call_or(int), rust_body_abort(int), rust_body_default(int);
      _Bool rust_is_removed(void);
      int main(int argc, char **argv) {
        if (argc == 2) return rust_call_abort(1) & 63;
        if (argc == 3) return rust_body_abort(1) & 63;
        return rust_call_default(1) + rust_body_default(1) + rust_body_default(-1) + rust_call_or(1) + rust_is_removed();
      }
    `;
    // What Rust's core asks of the C library and of the C++ run time, which are not linked.
    const whatCoreAsksFor = `
      typedef __SIZE_TYPE__ size_t;
      void *memcpy(void *to, const void *from, size_t count) {
        for (size_t i = 0; i < count; i++) ((char *)to)[i] = ((const char *)from)[i];
        return to;
      }
      void *memmove(void *to, const void *from, size_t count) {
        if (to < from) return memcpy(to, from, count);
        while (count--) ((char *)to)[count] = ((const char *)from)[count];
        return to;
      }
      void *memset(void *to, int byte, size_t count) {
        for (size_t i = 0; i < count; i++) ((char *)to)[i] = (char)byte;
        return to;
      }
      int memcmp(const void *a, const void *b, size_t count) {
        for (size_t i = 0; i < count; i++) {
          int difference = ((const unsigned char *)a)[i] - ((const unsigned char *)b)[i];
          if (difference) return difference;
        }
        return 0;
      }
      int __CxxFrameHandler3(void) { __builtin_trap(); }
      int _fltused;
    `;
    const rustFiles = (toy: string) => ({
      ...smallSources,
      "embedder.c": embedderSource("coff", { stateFromRust: true, exit: () => "__builtin_trap();" }),
      "toy.rs": toy,
      "main.c": rustMain,
      "asked_for.c": whatCoreAsksFor,
    });

    async function compileRustInputs(folder: string): Promise<LinkOptions | undefined> {
      const target = triple(machine);
      const crate = rustc === null ? undefined : await buildGuardCrate(folder, rustc, target);
      if (crate === undefined) {
        skipNotice(
          testFile,
          `rustc is not on PATH or cannot build the guard crate for ${target}: the cases in Rust do not run`,
        );
        return undefined;
      }
      const library = await compileRust(folder, rustc!, crate, "toy.rs", { target });
      return optionsWith({ objects: ["feature_code", "embedder", "main", "asked_for"], inputs: [library] });
    }

    testLink("mark the functions they call, and bring the one state", async () => {
      using dir = tempDir("trim-coff-freestanding-rust", rustFiles(rustSource));
      const folder = String(dir);
      const options = await compileRustInputs(folder);
      if (options === undefined) return;
      const { executable, symbols, featuresAt } = await linked(folder, options);
      expect(readPe(executable).sections.filter(({ name }) => name === ".bunfeat")).toHaveLength(1);
      for (const name of ["rust_aborts", "rust_defaults", "rust_throws"]) {
        const symbol = symbols.find(([symbol]) => symbol.includes(name));
        expect(symbol).toBeDefined();
        expect(featuresAt(symbol![1])).toEqual([Extra]);
      }
    });

    testLink("fail the link on an entry point that is always inlined", async () => {
      const alwaysInlined = rustSource.replace("#[inline(never)]\nfn rust_aborts", "#[inline(always)]\nfn rust_aborts");
      expect(alwaysInlined).not.toBe(rustSource);
      using dir = tempDir("trim-coff-freestanding-rust", rustFiles(alwaysInlined));
      const folder = String(dir);
      const options = await compileRustInputs(folder);
      if (options !== undefined)
        expectLinkFailure(folder, output, await wrapped(folder, options), ["GuardWithoutReference"]);
    });
  });

  const inlineGuardFiles = (() => {
    const { "main.c": _, ...withoutMain } = smallSources;
    return {
      ...withoutMain,
      "guarded.h": `#pragma once
#include "guard.h"
extern "C" int entered(int);
inline int guarded(int x) { return GUARDED(Extra, entered, x); }
`,
      "main.cpp": `#include "guarded.h"
extern "C" int second(int);
extern "C" int main(int argc, char **argv) { return argc > 5 ? (guarded(argc) + second(argc)) & 63 : 0; }
`,
      "second.cpp": `#include "guarded.h"
extern "C" int second(int x) { return guarded(x); }
extern "C" int unreferenced(int x) { return GUARDED(Extra, entered, x); }
`,
    };
  })();
  const inlineGuardFlags = ["-O0", "-fno-inline", "-fno-addrsig"];
  const inlineGuardOptions = optionsWith({
    objects: [...guardObjects, "second"],
    compileFlags: { main: inlineGuardFlags, second: inlineGuardFlags },
  });

  testLink("folds equal entry points of two features into one body, which goes only with both", async () => {
    const equalEntry = (name: string) =>
      `int ${name}(int x) { for (int i = 0; i < 5; i++) x += feature_code(x + i) * 3 + feature_code(x ^ i); return x; }`;
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "entry.c": `int feature_code(int); ${equalEntry("entered")} ${equalEntry("entry_of_other")}`,
      "main.c": `
        ${start}
        int entry_of_other(int);
        int main(int argc, char **argv) {
          if (argc == 2) return GUARDED(Extra, entered, argc) & 63;
          if (argc == 3) return GUARDED(Other, entry_of_other, argc) & 63;
          return 0;
        }
      `,
    });
    const folder = String(dir);
    const program = await linked(folder, optionsWith({ objects: guardObjects }));
    const { executable, table, addressOf, featuresOf, retainedAddresses } = program;
    expect(addressOf("entered")).toBe(addressOf("entry_of_other"));
    expect(featuresOf("entered")).toEqual(byIndex(Extra, Other));
    // Without one of them the body is as it was, which linked() has looked at.
    const withoutBoth = "without-both.exe";
    trimExecutable(executable, join(folder, withoutBoth), [Extra, Other]);
    const soundness = expectSoundPe({
      folder,
      table,
      removed: [Extra, Other],
      retainedAddresses,
      trimmedName: withoutBoth,
    });
    expect(soundness.filledBytes).toBeGreaterThan(program.soundness.filledBytes);
  });

  testLink("is not stopped by a guard in the copy of an inline function that the linker dropped", async () => {
    using dir = tempDir("trim-coff-freestanding", inlineGuardFiles);
    const { featuresOf } = await linked(String(dir), inlineGuardOptions);
    expect(["entered", "feature_code"].map(featuresOf)).toEqual([[Extra], [Extra]]);
  });

  describe("the reader of lld-link's maps", () => {
    function readLink(folder: string) {
      const pathOf = (name: string) => join(folder, name);
      return readCoffGraph({
        executable: pathOf(output),
        chunkMap: pathOf("program.lldmap"),
        symbolMap: pathOf("program.map"),
        inputs: readFileSync(pathOf("in.rsp"), "utf8")
          .split("\n")
          .filter(line => line !== ""),
        libraryFolders: [],
        alternateNames: [],
      });
    }

    testLink("reads a good link and makes the entry point a root", async () => {
      using dir = tempDir("trim-coff-freestanding-reader", smallSources);
      const folder = String(dir);
      await plainLink(folder, optionsWith());
      const { graph, failures } = readLink(folder);
      expect(failures).toEqual([]);
      const node = nodeAt(graph, readPe(join(folder, output)).entryPoint);
      expect(node).toBeGreaterThanOrEqual(0);
      expect(graph.isRoot[node]).toBe(1);
    });

    testLink(
      "resolves the record of a dropped copy to the selected copy, counts a dead guard, and makes no node for a record",
      async () => {
        using dir = tempDir("trim-coff-freestanding-reader", inlineGuardFiles);
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
          const removal = await run([objcopy, `--remove-section=${coffRecordSectionName}`, `${name}.obj`], folder);
          expect(removal.exitCode).toBe(0);
        }
        expect((await run(command, folder)).exitCode).toBe(0);
        const withoutRecords = readLink(folder);
        expect(withoutRecords.recordSections).toEqual([]);
        expect(withoutRecords.graph.count).toBe(reading.graph.count);
      },
    );

    testLink("marks an exported function as exported, not as a root", async () => {
      using dir = tempDir("trim-coff-freestanding-reader", { ...smallSources, "exported.c": exportedSource });
      const folder = String(dir);
      const objects = [...defaultObjects, "exported"];
      await plainLink(folder, optionsWith({ objects, linkFlags: ["/export:exported_function"] }));
      const { graph } = readLink(folder);
      const { symbols } = namedBytesOfPe(join(folder, output), join(folder, "program.map"));
      const node = nodeAt(graph, symbols.find(([name]) => name === "exported_function")![1]);
      expect({ isExported: graph.isExported[node], isRoot: graph.isRoot[node] }).toEqual({ isExported: 1, isRoot: 0 });
    });

    testLink("reports a reference to a name that the symbol map does not list", async () => {
      using dir = tempDir("trim-coff-freestanding-reader", {
        ...smallSources,
        "main.c": mainReturning("int feature_code_7(int);", "feature_code_7(argc) & 0"),
      });
      const folder = String(dir);
      await plainLink(folder, optionsWith({ objects: guardObjects }));
      const symbolMap = join(folder, "program.map");
      const lines = readFileSync(symbolMap, "latin1").split("\n");
      const isListed = (line: string) => line.split(/\s+/).includes("feature_code_7");
      writeFileSync(symbolMap, lines.filter(line => !isListed(line)).join("\n"), "latin1");
      expect(readLink(folder).failures).toContainEqual(
        expect.objectContaining({ kind: "UnresolvedReference", target: "feature_code_7" }),
      );
    });

    testLink("does not report a name that only sections outside the image refer to", async () => {
      using dir = tempDir("trim-coff-freestanding-reader", {
        ...smallSources,
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
        await plainLink(folder, optionsWith({ objects }));
        const { failures, statistics } = readLink(folder);
        expect(failures).toEqual([]);
        return statistics.symbolsOutsideGraph!;
      };
      const withoutTables = await countSymbolsOutsideGraph([...defaultObjects, "callee"]);
      expect(await countSymbolsOutsideGraph([...defaultObjects, "callee", "tables"])).toBeGreaterThan(withoutTables);
      expect(readFileSync(join(folder, "program.lldmap"), "latin1")).toMatch(
        /^[0-9a-f]{8} 00000018 .*tables\.obj:\(\.rdata\)\r?$/m,
      );
      const { symbols } = namedBytesOfPe(join(folder, output), join(folder, "program.map"));
      const listedNames = new Set(symbols.map(([name]) => name));
      const collected = ["collected_table", "collected_first", "collected_callee"];
      expect(collected.filter(name => listedNames.has(name))).toEqual([]);
    });

    testLink("reports an object that was deleted after the link", async () => {
      using dir = tempDir("trim-coff-freestanding-reader", {
        ...smallSources,
        "entry.c": entryCalling("more"),
        "more.c": `${equalFunction("feature_equal")} int more(int x) { return feature_equal(x); }`,
        "main.c": mainReturning(equalFunction("retained_equal"), "retained_equal(argc) == 109 ? 0 : 1"),
      });
      const folder = String(dir);
      await plainLink(folder, optionsWith({ objects: moreObjects }));
      rmSync(join(folder, "more.obj"));
      expect(readLink(folder).failures).toContainEqual({
        kind: "UnreadInput",
        object: join(folder, "more.obj"),
        reason: "NotFound",
      });
    });

    testLink("reports two archive members with the same name", async () => {
      using dir = tempDir("trim-coff-freestanding-reader", {
        ...smallSources,
        "a/same.c": `int from_a(int x) { return x + 1; }`,
        "b/same.c": `int from_b(int x) { return x + 2; }`,
        "main.c": mainReturning("int from_a(int); int from_b(int);", "from_a(argc) + from_b(argc) == 5 ? 0 : 1"),
      });
      const folder = String(dir);
      const objects = [...guardObjects, "a/same", "b/same"];
      const archives = { "a/shelf.lib": ["a/same"], "b/shelf.lib": ["b/same"] };
      await plainLink(folder, optionsWith({ objects, archives }));
      expect(readLink(folder).failures).toContainEqual(
        expect.objectContaining({ kind: "UnreadInput", reason: "AmbiguousArchiveMember" }),
      );
    });

    testLink("cannot write a table into an executable without the section reserved for it", async () => {
      using dir = tempDir("trim-coff-freestanding-reader", smallSources);
      const folder = String(dir);
      const command = await plainLink(folder, optionsWith());
      const { features, builtinUses } = writeLinkInputs(folder);
      const words = ["bun", "link.ts", join(folder, "work"), features, builtinUses, "--", ...command];
      expect(() => coff(createLinker(parseArguments(words)).linker).writeTable(Buffer.alloc(8))).toThrow(BuildError);
    });
  });

  testLink("removes what the executable exports with the features marked exports", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "exported.c": exportedSource,
      "other.c": otherSource,
      "main.c": mainGuardingBoth,
    });
    const { featuresOf } = await linked(
      String(dir),
      optionsWith({
        objects: ["feature_code", "entry", "exported", "other", "embedder", "main"],
        linkFlags: ["/export:exported_function", "/export:entry_of_other"],
      }),
    );
    expect(exportFeatures).not.toEqual([]);
    expect(["exported_function", "entry_of_other"].map(featuresOf)).toEqual([
      exportFeatures,
      byIndex(Other, ...exportFeatures),
    ]);
  });

  testLink(
    "lists the items of ICU's data package by class, but not the classes Windows always needs, and cuts the items of a removed feature",
    async () => {
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
      using dir = tempDir("trim-coff-freestanding-icu", {
        ...smallSources,
        "package.dat": packageOf(items),
        "data.c": String.raw`__asm__(".section .rdata,\"dr\"\n.balign 16\n.globl icudt99_dat\nicudt99_dat:\n.incbin \"package.dat\"\n.text\n");`,
        "main.c": mainReturning("extern const unsigned char icudt99_dat[];", "icudt99_dat[argc + 1] == 0xda ? 0 : 1"),
      });
      const { table, addressOf, trimmedExecutable } = await linked(String(dir), {
        ...optionsWith({ objects: ["feature_code", "entry", "embedder", "data", "main"] }),
        removed: ["IntlCollation"],
      });
      expect(table.icuPackages.map(({ start }) => start)).toEqual([addressOf("icudt99_dat")]);
      const { start: packageStart, end, runs } = table.icuPackages[0]!;
      expect(lineOf("locale").exceptWindows).toBe(true);
      const listed = runs.map(({ firstItem, itemCount, set }) => ({ firstItem, itemCount, features: table.sets[set] }));
      expect(listed).toEqual([
        { firstItem: 1, itemCount: 1, features: featuresOfClass("collation") },
        { firstItem: 2, itemCount: 1, features: featuresOfClass("collation-root") },
        { firstItem: 3, itemCount: 1, features: featuresOfClass("converter") },
      ]);
      const left = itemsOf(peImage(trimmedExecutable).bytes(packageStart, end - packageStart)!);
      const names = left.map(({ name }) => name);
      expect(names).not.toContain("coll/de.res");
      expect(names).toContain("coll/root.res");
    },
  );

  testLink("fails on retained code that calls an entry point without its guard", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "main.c": `
        ${start}
        __attribute__((noinline)) int calls_directly(int x) { return entered(x); }
        int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : calls_directly(argc) & 0; }
      `,
    });
    const folder = String(dir);
    const objects = ["feature_code", "entry", "embedder", "main"];
    expectLinkFailure(folder, output, await wrapped(folder, optionsWith({ objects })), [
      "EntryPointReferencedByRetainedCode",
      "calls_directly",
      "entered",
      "main",
    ]);
  });

  testLink("fails on retained code that calls an entry point by a name that the link command defines", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "main.c": mainReturning(
        "int another_name(int); __attribute__((noinline)) int calls_alias(int x) { return another_name(x); }",
        "calls_alias(argc) & 0",
      ),
    });
    const folder = String(dir);
    const options = optionsWith({ objects: guardObjects, linkFlags: ["/alternatename:another_name=entered"] });
    expectLinkFailure(folder, output, await wrapped(folder, options), [
      "EntryPointReferencedByRetainedCode",
      "calls_alias",
      "entered",
    ]);
  });

  testLink("fails on an entry point that runs before main", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "entry.c": `${smallSources["entry.c"]}static int seed; __attribute__((constructor)) void entered_early(void) { seed = feature_code(1); }\n`,
      "main.c": `
        #include "guard.h"
        void entered_early(void);
        int main(int argc, char **argv) { if (argc > 5) GUARDED(Extra, entered_early); return 0; }
      `,
    });
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder, optionsWith({ objects: guardObjects })), [
      "EntryPointReferencedByRetainedCode",
      ".CRT$XCU",
      "entered_early",
    ]);
  });

  testLink("fails on a record written with 32-bit image-relative words", async () => {
    const record = String.raw`__asm__(".section ${coffRecordSectionName},\"yn\"\n.rva main\n.long 0\n.rva entered\n.long 0\n.short ${indexOf(Extra)}\n.byte 0\n.zero 5\n.text\n");`;
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "main.c": `${smallSources["main.c"]}\n${record}\n`,
    });
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder, optionsWith()), ["UnreadInput", "UnsupportedRelocations"]);
  });

  testLink("names what retains the rest of a feature below its minimum size", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...smallSources,
      "main.c": mainReturning("int feature_code_5(int);", "feature_code_5(argc) & 0"),
    });
    const folder = String(dir);
    const options = optionsWith({ objects: guardObjects, minimums: { [Extra]: 1_000_000 } });
    expectLinkFailure(folder, output, await wrapped(folder, options), [
      "FeatureBelowMinimum",
      "feature_code_5",
      "main",
    ]);
  });

  testLink("fails on a feature below its minimum size", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder, optionsWith({ minimums: { [Extra]: 10_000_000 } })), [
      "FeatureBelowMinimum",
      Extra,
    ]);
  });

  testLink("names an entry point folded with retained code where its feature is below its minimum", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "entry.c": equalFunction("entered"),
      "main.c": `
        ${start}
        ${equalFunction("retained_equal")}
        int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : retained_equal(argc) & 0; }
      `,
    });
    const folder = String(dir);
    const options = optionsWith({ objects: ["entry", "embedder", "main"], minimums: { [Extra]: 1 } });
    const linkResult = await wrapped(folder, options);
    expectLinkFailure(folder, output, linkResult, ["FeatureBelowMinimum"]);
    expect(linkResult.stderr).toMatch(
      /\n  its entry point (entered|retained_equal) \(\w+\.obj, \d+ bytes\) is folded with other code, so it stays: (entered|retained_equal)\n/,
    );
  });

  testLink("fails when nothing can ever mark a guarded feature as used", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder, optionsWith({ builtins: [] })), [
      "GuardWithoutUser: main (main.obj, ",
      `an entry point of ${Extra}, and no table entry uses ${Extra} and no feature's code enters it`,
    ]);
  });
});
