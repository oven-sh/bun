import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sectionInFile } from "../../../scripts/build/trim/coff-graph.ts";
import { peImage } from "../../../scripts/build/trim/linked-image.ts";
import {
  freestandingSkipReasons,
  freestandingSources,
  linked,
  output,
  pointerRelocationType,
  recordRelocationTypes,
  stateBytes,
  wrapped,
  type LinkOptions,
  type Machine,
} from "./link-coff-support.ts";
import {
  builtinUsing,
  entryCalling,
  entryGuarding,
  entryPointsText,
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
} from "./toy-program.ts";

setDefaultTimeout(60_000);

const machines: Machine[] = ["x64", "arm64"];
for (const machine of machines) {
  const reason = freestandingSkipReasons[machine];
  if (reason !== undefined)
    skipNotice("link-coff-freestanding.test.ts", `${reason}: the cases for ${machine} do not run`);
}

describe.concurrent.each(machines)("a trimmable link with lld-link and no library, for %s", machine => {
  const testLink = test.skipIf(freestandingSkipReasons[machine] !== undefined);
  const optionsWith = (more: LinkOptions = {}): LinkOptions => ({ machine, isFreestanding: true, ...more });
  const sources = freestandingSources();
  const twoFeatureObjects = ["feature_code", "entry", "other", "embedder", "main"];

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

  testLink("writes the four review files, the table and the state", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    const { executable, table } = await linked(folder, optionsWith());
    expect(reviewFiles(folder, output)).toEqual(["entry-points.txt", "groups.txt", "requires.txt", "retained-by.txt"]);
    const entryPoints = entryPointsText(folder, output).trimEnd().split("\n");
    expect(entryPoints).toHaveLength(1);
    expect(entryPoints[0]).toStartWith(`${Extra} Abort `);
    expect(table.sets).toEqual([[indexOf(Extra)]]);
    expect(table.edges).toEqual([]);
    expect(sectionInFile(executable, ".buntrim")).toBeDefined();
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

  testLink("fails on a feature below its minimum size", async () => {
    using dir = tempDir("trim-coff-freestanding", sources);
    const folder = String(dir);
    expectLinkFailure(folder, output, await wrapped(folder, optionsWith({ minimums: { [Extra]: 10_000_000 } })), [
      "FeatureBelowMinimum",
      Extra,
    ]);
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
