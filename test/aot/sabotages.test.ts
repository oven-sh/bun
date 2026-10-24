// Do the tests have teeth? A test that was never seen to fail proves nothing: the programs about objects in the cells of other objects were all green for hours
// while a freed cell was read, and a whole folder was green because none of its programs got the thing that it was written to attack.
//
// `--aot-sabotage=<name>` (hidden) breaks one thing in a build on purpose: an emitter leaves out a barrier, the collector's visit leaves out a field. An ordinary build holds
// none of it. `bun compile --aot-list=registry` lists the names. For each name the table below has the programs that must notice, and this test passes only if
// AT LEAST ONE RUN OF THEM DIFFERS FROM PLAIN BUN OR DIES. A sabotage that nothing sees fails here, and so does a name that the table lacks: each says which program is still to be written.
// A run that notices has its control: the same program in the same environment without the sabotage, as plain Bun.
//
//   bun test test/aot/sabotages                          all
//   AOT_SABOTAGE=<text> bun test test/aot/sabotages      the names that contain the text
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { registry } from "./harness/registry";
import {
  built,
  slot,
  spawned,
  told,
  unsupported,
  withoutCoreDump,
  withoutCrashReport,
  withoutDebugInformation,
} from "./run-programs";
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
  NoCallCollects: {
    folder: "collector",
    flags: ["--aot-validate"],
    programs: ["young-cells-stored-into-old-arrays-survive.ts", "references-in-optional-fields-survive-collections.ts"],
  },
};
/** What no program can show, and the test of the engine that shows it (./engine-tests.test.ts runs those). */
const noticedByTheEngineTestsAlone: Record<string, string> = {
  // It needs a 32-bit reference in half a word of the stack as the only holder.
  NarrowReferenceOnStackNamesNoInnerCell: "inner-objects/sabotaged/narrow-reference-on-stack-names-no-inner-cell",
  // A program notices it only through a word that an earlier frame left on the stack, and which words are left hangs on how Bun was linked.
  InnerCellLetGoKeepsItsHeader: "inner-objects/sabotaged/inner-cell-let-go-keeps-its-header",
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

  /** The first of the environments in which the program, built with the flags, does something else than plain Bun does. */
  async function departure(program: string, flags: string[], environments: Environment[]) {
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
    try {
      for (const environment of environments) {
        const ran = await spawned(withoutCoreDump([executable]), dirname(path), {
          ...bunEnv,
          ...withoutCrashReport,
          ...environment,
        });
        // The runner's own clock has ended it: that says nothing, neither in a control nor under a sabotage.
        if (ran.signal === "SIGKILL") continue;
        if (!ran.signal && Bun.deepEquals(told(ran), told(plain))) continue;
        return { environment, how: ran.signal ?? "another answer" };
      }
    } finally {
      rmSync(executable, { force: true });
    }
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
            slot(async () => {
              const path = `${topic}/${program}`;
              const noticed = await departure(path, [...flags, `--aot-sabotage=${name}`], underCollections);
              if (!noticed) return [];
              expect({ path, control: await departure(path, flags, [noticed.environment]) }).toEqual({ path });
              return [`${path} ${JSON.stringify(noticed.environment)}: ${noticed.how}`];
            }),
          ),
        )
      ).flat();
      console.error(`SABOTAGE ${name}: ${seen.join(" | ") || "nobody noticed"}`);
      expect({ name, isNoticed: seen.length > 0 }).toEqual({ name, isNoticed: true });
    },
    1_800_000,
  );
});
