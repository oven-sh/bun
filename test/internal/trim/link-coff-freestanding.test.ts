import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sectionInFile } from "../../../scripts/build/trim/coff-graph.ts";
import { builtinModulesHeaderBytes } from "../../../scripts/build/trim/link.ts";
import { peImage } from "../../../scripts/build/trim/linked-image.ts";
import { trimTableMagic } from "../../../scripts/build/trim/table.ts";
import {
  freestandingSkipReasons,
  freestandingSources,
  guardObjects,
  linked,
  output,
  plainLink,
  pointerRelocationType,
  recordRelocationTypes,
  stateBytes,
  thinLtoFlags,
  wrapped,
  type LinkOptions,
  type Machine,
} from "./link-coff-support.ts";
import {
  builtinUsing,
  entryCalling,
  entryGuarding,
  entryPointsText,
  equalFunction,
  expectLinkFailure,
  Extra,
  indexOf,
  mainEnteringBuiltin,
  mainGuardingBoth,
  Other,
  otherSource,
  reviewFiles,
  skipNotice,
  spelledBuiltin,
  start,
  type ProcessResult,
} from "./toy-program.ts";

setDefaultTimeout(60_000);

const machines: Machine[] = ["x64", "arm64"];
for (const machine of machines) {
  const reason = freestandingSkipReasons[machine];
  if (reason !== undefined)
    skipNotice("link-coff-freestanding.test.ts", `${reason}: the cases for ${machine} do not run`);
}

// A size is the compiler's. It reads # in what a link prints, and in the list of its entry points.
const withoutSizes = (text: string) => text.replace(/(?<= (?:Abort|ReturnDefault|Throw) )\d+|\d+(?= bytes\))/g, "#");

describe.concurrent.each(machines)("a trimmable link with lld-link and no library, for %s", machine => {
  const testLink = test.skipIf(freestandingSkipReasons[machine] !== undefined);
  const optionsWith = (more: LinkOptions = {}): LinkOptions => ({ machine, isFreestanding: true, ...more });
  const sources = freestandingSources();
  // Where the size of the feature's code decides nothing.
  const smallSources = freestandingSources(40);
  const twoFeatureObjects = ["feature_code", "entry", "other", "embedder", "main"];
  // As Bun is compiled: a function that only returns has a frame, and so unwind records.
  const framesInLeaves = ["-fasynchronous-unwind-tables", "-fno-omit-frame-pointer", "-mno-omit-leaf-frame-pointer"];

  // clang takes longer over feature_code.c of `sources` than over all else of a case: a machine compiles it once.
  let featureCodeObject: Promise<Buffer> | undefined;
  const compileFeatureCode = async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    await plainLink(String(dir), optionsWith());
    return readFileSync(join(String(dir), "feature_code.obj"));
  };
  // For a case that links it unchanged: there clang only checks its syntax, and the object is a copy.
  const withCompiledFeatureCode = async (more: Omit<LinkOptions, "afterCompile"> = {}): Promise<LinkOptions> => {
    const object = await (featureCodeObject ??= compileFeatureCode());
    return optionsWith({
      ...more,
      // -c is unused then, which clang is not to warn about.
      compileFlags: { ...more.compileFlags, feature_code: ["-fsyntax-only", "-Qunused-arguments"] },
      afterCompile: folder => writeFileSync(join(folder, "feature_code.obj"), object),
    });
  };
  // The link prints its one failure and nothing else.
  const expectOnlyFailure = (folder: string, linkResult: ProcessResult, failure: string) => {
    expect(withoutSizes(linkResult.stderr)).toBe(`trim: ${failure}\n`);
    expectLinkFailure(folder, output, linkResult, []);
  };

  testLink("removes a feature and cuts its pages out of the PE file", async () => {
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

  testLink("links twice where every object of bitcode is a member of an archive", async () => {
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

  testLink("writes the four review files, the table and the state", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    const { executable, table } = await linked(folder, await withCompiledFeatureCode());
    expect(reviewFiles(folder, output)).toEqual([
      "entry-points.txt",
      "groups.txt",
      "needs.txt",
      "requires.txt",
      "retained-by.txt",
    ]);
    expect(withoutSizes(entryPointsText(folder, output))).toBe(
      `${Extra} Abort # entered (entry.obj, # bytes) <- main (main.obj, # bytes)\n`,
    );
    expect(table.sets).toEqual([[indexOf(Extra)]]);
    expect(table.edges).toEqual([]);
    const tableAt = sectionInFile(executable, ".buntrim")!.offset;
    expect(readFileSync(executable).toString("latin1", tableAt, tableAt + trimTableMagic.length)).toBe(trimTableMagic);
    expect(sectionInFile(executable, ".bunfeat")!.size).toBeGreaterThanOrEqual(stateBytes);
  });

  testLink("records a reference where one feature calls the other's entry point directly", async () => {
    using dir = tempDir("trim-coff-freestanding", {
      ...sources,
      "entry.c": entryCalling("entry_of_other"),
      "other.c": otherSource,
      "main.c": mainGuardingBoth,
    });
    const folder = String(dir);
    const { table, featuresOf } = await linked(folder, await withCompiledFeatureCode({ objects: twoFeatureObjects }));
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "Reference", isFollowed: true },
    ]);
    expect(withoutSizes(readFileSync(join(folder, `${output}.trim`, "requires.txt"), "utf8"))).toBe(
      `${Extra} requires ${Other}: 1 references\n` +
        `    entry_of_other (other.obj, # bytes) <- entered (entry.obj, # bytes)\n`,
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
    const options = await withCompiledFeatureCode({ objects: twoFeatureObjects });
    const { table } = await linked(folder, { ...options, removed: [Other] });
    expect(table.edges).toEqual([
      { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: true },
    ]);
    expect(readFileSync(join(folder, `${output}.trim`, "requires.txt"), "utf8")).toBe(
      `${Extra} enters ${Other}: aborting guard\n`,
    );
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
      const options = await withCompiledFeatureCode({ objects: twoFeatureObjects, builtins });
      const { table, featuresOf } = await linked(String(dir), options);
      expect(table.edges).toEqual([
        { from: indexOf(Extra), to: indexOf(Other), strength: "AbortingGuard", isFollowed: false },
      ]);
      expect(["entered", "entry_of_other"].map(featuresOf)).toEqual([[Extra], [Other]]);
    });

    testLink("fails when the built-in does not declare the second use", async () => {
      using dir = tempDir("trim-coff-freestanding", files);
      const folder = String(dir);
      const builtins = [builtinUsing(spelledBuiltin, "toy.extra", Extra)];
      const options = await withCompiledFeatureCode({ objects: twoFeatureObjects, builtins });
      expectOnlyFailure(
        folder,
        await wrapped(folder, options),
        `UndeclaredUse: toy.extra (entered (entry.obj, # bytes)) reaches a guard of ${Other}, ` +
          `and its table entry has no "uses ${Other}": a program that calls it would lose ${Other} under --trim\n` +
          `      -> entry_of_other (other.obj, # bytes)`,
      );
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
      const options = await withCompiledFeatureCode({ objects: guardObjects, compileFlags: { main: framesInLeaves } });
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
    const options = await withCompiledFeatureCode({ objects: twoFeatureObjects, compileFlags });
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
      const options = await withCompiledFeatureCode({
        objects: twoFeatureObjects,
        compileFlags: { other: framesInLeaves },
      });
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
    const { addressOf, featuresOf } = await linked(String(dir), await withCompiledFeatureCode({ objects }));
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
      const options = await withCompiledFeatureCode({ objects, builtins, minimums: { [Extra]: 10_000 } });
      const { featuresOf } = await linked(folder, options);
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
        await withCompiledFeatureCode({
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
    const options = await withCompiledFeatureCode({ objects, builtins });
    const { featuresOf } = await linked(folder, { ...options, removed: ["TlsSockets"] });
    const names = ["end@?$HttpResponse@$00@uWS", "feature_code", "end@?$HttpResponse@$0A@@uWS"];
    expect(names.map(featuresOf)).toEqual([["TlsSockets"], ["TlsSockets"], undefined]);
    expect(entryPointsText(folder, output)).toMatch(
      /^TlsSockets Abort \d+ uWS::HttpResponse<1>::end\(int\) \(sockets\.obj, /,
    );
  });

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
    expectOnlyFailure(
      folder,
      await wrapped(folder, await withCompiledFeatureCode({ objects })),
      `EntryPointReferencedByRetainedCode: calls_directly (main.obj, # bytes) refers to ` +
        `entered (entry.obj, # bytes), an entry point of ${Extra}, and is not one of its guards\n` +
        `  calls_directly (main.obj, # bytes)\n` +
        `      <- main (main.obj, # bytes)`,
    );
  });

  testLink("fails on a feature below its minimum size", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    const options = await withCompiledFeatureCode({ minimums: { [Extra]: 10_000_000 } });
    expectLinkFailure(folder, output, await wrapped(folder, options), [
      "trim: FeatureBelowMinimum: ",
      ` MB can be removed with ${Extra}, below its minimum of 10.00 MB: retained code refers to the rest\n`,
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
    expectLinkFailure(folder, output, linkResult, [
      `trim: FeatureBelowMinimum: 0.00 MB can be removed with ${Extra}, below its minimum of 0.00 MB: ` +
        `retained code refers to the rest\n`,
    ]);
    expect(linkResult.stderr).toMatch(
      /\n  its entry point (entered|retained_equal) \(\w+\.obj, \d+ bytes\) is folded with other code, so it stays: (entered|retained_equal)\n/,
    );
  });

  testLink("fails when nothing can ever mark a guarded feature as used", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    expectOnlyFailure(
      folder,
      await wrapped(folder, await withCompiledFeatureCode({ builtins: [] })),
      `GuardWithoutUser: main (main.obj, # bytes) enters entered (entry.obj, # bytes), an entry point of ${Extra}, ` +
        `and no table entry uses ${Extra} and no feature's code enters it: --trim would always remove it`,
    );
  });
});
