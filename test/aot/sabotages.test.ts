// Do the tests have teeth? A test that was never seen to fail proves nothing: the programs about objects in the cells of other objects were all green for hours
// while a freed cell was read, and a whole folder was green because none of its programs got the thing that it was written to attack.
//
// `--aot-sabotage=<name>` (hidden) breaks one thing in a build on purpose: an emitter leaves out a barrier, the collector's visit leaves out a field. An ordinary build holds
// none of it. `bun compile --aot-list=registry` lists the names. For each name the table below has the programs that must notice, and this test passes only if
// AT LEAST ONE RUN OF THEM DIFFERS FROM PLAIN BUN OR DIES. A sabotage that nothing sees fails here, and so does a name that the table lacks: each says which program is still to be written.
// The row `none` is the control: the same programs in the same environments without a sabotage, all as plain Bun.
//
//   bun test test/aot/sabotages                          all
//   AOT_SABOTAGE=<text> bun test test/aot/sabotages      the names that contain the text
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isArm64, isGlibc, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { registry } from "./harness/registry";
import { built, slot, spawned, told, unsupported, withoutCoreDump, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

type Environment = Record<string, string>;
const overwriting = { BUN_JSC_scribbleFreeCells: "1", BUN_JSC_useZombieMode: "1" };
// A collection at EVERY allocation that leaves the fast path does not find what needs a stale word on the stack: for that the word has to outlast collections.
// At every first, second and third some of the programs take minutes.
const underCollections: Environment[] = [
  {},
  ...[5, 7, 11].map(every => ({ BUN_JSC_slowPathAllocsBetweenGCs: String(every), ...overwriting })),
  // It costs a plain run and forces nothing.
  { BUN_JSC_scribbleFreeCells: "1" },
  { BUN_JSC_verifyGC: "1" },
  { BUN_JSC_collectContinuously: "1", BUN_JSC_scribbleFreeCells: "1" },
];

type Row = { folder: string; flags: string[]; programs: string[] };
const innerObjects = (...programs: string[]): Row => ({ folder: "inner-objects", flags: [], programs });
// No room is made in a small program unless the form is taken wherever it is legal.
const rooms = (...programs: string[]): Row => ({
  folder: "flattened-objects",
  flags: ["--aot-testing=FlattenUntilHeldWhereverLegal"],
  programs,
});

// A program notices an inner cell that kept its header only through a word that an earlier frame left on the stack. Which words are left hangs on the
// frames of Bun and of the system's libraries and on the registers the architecture saves: the programs below have shown it in every run of a Bun linked with LTO
// for glibc on x64, as CI links it, and nowhere else: not in a Bun for the same machine without LTO either.
const leavesStaleWordsOnTheStack = isGlibc && !isArm64;

/** The programs under ./programs that must notice each sabotage. */
const noticedBy: Record<string, Row> = {
  StackNamesNoInnerCell: innerObjects("the-inner-object-is-held-by-a-local-variable-alone.ts"),
  InnerObjectIsVisitedWithoutItsFields: innerObjects(
    "the-field-is-pointed-at-another-object.ts",
    "an-old-outer-object-gets-young-things.ts",
  ),
  InnerArrayIsVisitedWithoutItsElements: innerObjects("an-array-is-born-in-the-cell-of-its-object.ts"),
  InnerCellVisitedInPlaceStaysWhite: innerObjects(
    "young-objects-are-stored-through-an-alias-into-an-old-cell.ts",
    "an-array-is-born-in-the-cell-of-its-object.ts",
  ),
  InnerCellIsMarkedWithoutItsOuterCell: innerObjects(
    "only-the-inner-object-is-still-held.ts",
    "an-object-with-a-room-lies-in-the-cell-of-a-third.ts",
  ),
  // Not at a collection at every allocation that leaves the fast path: at every fifth.
  ...(leavesStaleWordsOnTheStack && {
    InnerCellLetGoKeepsItsHeader: innerObjects(
      "three-levels-are-held-let-go-and-filled-again.ts",
      "an-object-with-a-room-lies-in-the-cell-of-a-third.ts",
    ),
  }),
  RoomIsNotInReferenceList: rooms(
    "outer-objects-that-nothing-is-laid-into.ts",
    "an-old-outer-object-gets-young-objects.ts",
  ),
  RoomsLeftEmptyAreNotZeroed: rooms("outer-objects-that-nothing-is-laid-into.ts"),
  NoBarrierBehindFreshStoreIntoRoom: rooms(
    "an-old-outer-object-gets-young-objects.ts",
    "an-outer-object-is-born-around-an-object-that-exists.ts",
  ),
  NoBarrierForStoreThroughBorrowedObject: rooms(
    "an-old-outer-object-gets-young-objects.ts",
    "an-old-outer-object-gets-young-things.ts",
  ),
  StoreLeavesRoomAsItIs: rooms(
    "what-an-inner-object-in-its-room-held-is-let-go.ts",
    "what-the-inner-object-held-is-let-go.ts",
  ),
  FlattenedObjectIsMadeWithoutBarrier: rooms(
    "an-old-outer-object-gets-young-objects.ts",
    "snapshots-and-censuses-over-pairs.ts",
  ),
  MakingLeavesRoomAsItIs: rooms(
    "what-the-inner-object-held-is-let-go.ts",
    "what-an-inner-object-in-its-room-held-is-let-go.ts",
  ),
};
/** What no program can show, and the test of the engine that shows it (./engine-tests.test.ts runs those). */
const noticedByTheEngineTestsAlone: Record<string, string> = {
  // It needs a 32-bit reference in half a word of the stack as the only holder.
  NarrowReferenceOnStackNamesNoInnerCell: "inner-objects/sabotaged/narrow-reference-on-stack-names-no-inner-cell",
  ...(!leavesStaleWordsOnTheStack && {
    InnerCellLetGoKeepsItsHeader: "inner-objects/sabotaged/inner-cell-let-go-keeps-its-header",
  }),
};

const listed = unsupported ? undefined : registry().sabotages;
if (!unsupported && !listed)
  console.error(
    "SKIPPED: test/aot/sabotages.test.ts: this Bun lists no sabotages in `bun compile --aot-list=registry`",
  );
const wanted = process.env.AOT_SABOTAGE ?? "";

describe.skipIf(!listed)("compile/aot/sabotages", () => {
  const folder = String(tempDir("aot-sabotages", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const carrier = listed ? withoutDebugInformation() : [];
  const root = join(import.meta.dir, "programs");
  let executables = 0;

  /** The environments in which the program, built with the flags, does something else than plain Bun does. */
  async function departures(program: string, flags: string[], stopsAtTheFirst: boolean): Promise<string[]> {
    const path = join(root, program);
    const executable = join(folder, `program-${executables++}${isWindows ? ".exe" : ""}`);
    const plain = await spawned([bunExe(), "run", path], dirname(path), bunEnv);
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, path, "--outfile", executable],
        dirname(path),
        bunEnv,
      ),
    );
    const departing: string[] = [];
    try {
      for (const environment of underCollections) {
        const ran = await spawned(withoutCoreDump([executable]), dirname(path), { ...bunEnv, ...environment });
        // The runner's own clock has ended it: that says nothing, neither in a control nor under a sabotage.
        if (ran.signal === "SIGKILL") continue;
        if (!ran.signal && Bun.deepEquals(told(ran), told(plain))) continue;
        departing.push(`${program} ${JSON.stringify(environment)}: ${ran.signal ?? "another answer"}`);
        if (stopsAtTheFirst) break;
      }
    } finally {
      rmSync(executable, { force: true });
    }
    return departing;
  }

  test("every sabotage has programs that must notice it", () => {
    expect(listed!.filter(name => !noticedBy[name] && !noticedByTheEngineTestsAlone[name])).toEqual([]);
    expect(
      [...Object.keys(noticedBy), ...Object.keys(noticedByTheEngineTestsAlone)].filter(name => !listed!.includes(name)),
    ).toEqual([]);
  });

  test("a name that is not listed stops the build", async () => {
    const path = join(root, "inner-objects", "only-the-inner-object-is-still-held.ts");
    const build = await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-sabotage=NoSuchSabotage",
        path,
        "--outfile",
        join(folder, "never"),
      ],
      dirname(path),
      bunEnv,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.stringContaining("NoSuchSabotage"),
      exitCode: 1,
    });
  });

  const controls = [
    ...new Set(
      Object.values(noticedBy).flatMap(row =>
        row.programs.map(program => JSON.stringify([`${row.folder}/${program}`, row.flags])),
      ),
    ),
  ].map(text => JSON.parse(text) as [string, string[]]);
  test.concurrent.each(controls.filter(() => "none".includes(wanted)))(
    "none: %s %j",
    (program, flags) => slot(async () => expect(await departures(program, flags, false)).toEqual([])),
    900_000,
  );

  // TODO: the build of its one program lays no inner object into a room any more, so there is no room to leave as it is.
  const noticedByNobodyToday = ["RoomsLeftEmptyAreNotZeroed"];
  for (const name of noticedByNobodyToday) test.todo(name);

  test.concurrent.each(
    (listed ?? []).filter(name => noticedBy[name] && name.includes(wanted) && !noticedByNobodyToday.includes(name)),
  )(
    "%s",
    async name => {
      const { folder: topic, flags, programs } = noticedBy[name];
      const seen = (
        await Promise.all(
          programs.map(program =>
            slot(() => departures(`${topic}/${program}`, [...flags, `--aot-sabotage=${name}`], true)),
          ),
        )
      ).flat();
      console.error(`SABOTAGE ${name}: ${seen.join(" | ") || "nobody noticed"}`);
      expect({ name, isNoticed: seen.length > 0 }).toEqual({ name, isNoticed: true });
    },
    1_800_000,
  );
});
