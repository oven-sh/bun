// Do the tests have teeth? A test that was never seen to fail proves nothing.
//
// `--aot-sabotage=<name>` (hidden) breaks one thing in a build on purpose: an emitter leaves out a barrier, a pass leaves out one of the
// conditions under which it may change the code. An ordinary build holds
// none of it. `bun compile --aot-list=registry` lists the names. For each name the table below has the programs that must notice, and this test passes only if
// AT LEAST ONE RUN OF THEM DIFFERS FROM PLAIN BUN OR DIES. A sabotage that nothing sees fails here, and so does a name that the table lacks: each says which program is still to be written.
// A run that notices has its control: the same program in the same environment without the sabotage, as plain Bun.
//
//   bun test test/aot/sabotages                          all
//   AOT_SABOTAGE=<text> bun test test/aot/sabotages      the names that contain the text
import { afterAll, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join, resolve } from "path";
import { tsconfig } from "./generated/births-and-uses/run";
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

type Row = { folder: string; flags: string[]; programs: string[]; isGenerated?: boolean };

// ./what-the-back-end-is-told-is-checked-at-run-time.test.ts holds each of these to the line that names what was told.
const toldTheBackEnd = (check: string, ...programs: string[]): Row => ({
  folder: "claims-to-the-back-end",
  flags: [check],
  programs,
});

// What a pass takes for granted shows in what a program answers, whenever the collector runs.
const asTheyAre: Environment[] = [{}];
const conditionOfAPass = (...programs: string[]): Row => ({ folder: "conditions-of-passes", flags: [], programs });
/** Programs out of ./generated/births-and-uses/<family>.ts by name: `typed/<name>` is the one in TypeScript. */
const ofFamily = (family: string, ...programs: string[]): Row => ({
  folder: family,
  flags: [],
  programs,
  isGenerated: true,
});

/** The programs under ./programs that must notice each sabotage. */
const noticedBy: Record<string, Row | Row[]> = {
  NoCallCollects: {
    folder: "collector",
    flags: ["--aot-validate"],
    programs: ["young-cells-stored-into-old-arrays-survive.ts", "references-in-optional-fields-survive-collections.ts"],
  },
  StoresNeedNoBarrier: {
    folder: "collector",
    flags: [],
    programs: ["young-cells-stored-into-old-arrays-survive.ts", "references-in-optional-fields-survive-collections.ts"],
  },
  NoCallWrites: toldTheBackEnd(
    "--aot-check=MovedLoads",
    "a-field-is-read-on-both-sides-of-a-call-that-stores-into-it.ts",
  ),
  FieldsNeverChange: toldTheBackEnd(
    "--aot-check=ClaimsToBackEnd",
    "a-field-is-read-and-stored-on-every-turn-of-a-loop.ts",
  ),
  ClosureInFrameKeepsNoCaptures: {
    ...toldTheBackEnd("--aot-check=ClaimsToBackEnd", "a-closure-that-is-only-lent-reads-what-it-captured.ts"),
    flags: ["--aot-check=ClaimsToBackEnd", "--aot-disable-in=4000000000:1"],
  },
  RangesEndOneEarly: toldTheBackEnd("--aot-check=ClaimsToBackEnd", "flags-and-small-counters-come-out-of-fields.ts"),
  WritesMayRunTwice: ofFamily(
    "work-done-ahead-of-a-test-that-fails",
    "typed/countsUp-looksAtAnotherObjectFirst-withAnAccessorForTheSecondField-inAClosure",
    "typed/saysSomething-isAMethod-withoutAField-inAClosure",
  ),
  SharedPatternsReachCalls: ofFamily(
    "pattern-literals-met-again",
    "typed/withIndices-isHandedToAFunction-nothingMoreIsAsked-inTheHandler-types-erased",
  ),
  SharedPatternsAreSticky: ofFamily(
    "pattern-literals-met-again",
    "typed/sticky-replace-nothingMoreIsAsked-constructor",
    "untyped/sticky-replace-nothingMoreIsAsked-copiedIntoALoop",
  ),
  SharedPatternsAdvance: ofFamily(
    "pattern-literals-met-again",
    "typed/global-isHeldByAClosure-nothingMoreIsAsked-moduleLoop",
    "typed/global-test-nothingMoreIsAsked-callsItself-types-erased",
  ),
  SharedPatternsAreUsedInUnknownWays: ofFamily(
    "pattern-literals-met-again",
    "typed/plain-startsWhereAnObjectSays-nothingMoreIsAsked-inAClosureThatOutlivesItsMaker",
    "untyped/plain-startsWhereAnObjectSays-nothingMoreIsAsked-inAClosureThatOutlivesItsMaker",
  ),
  FirstStepsStandUnderHandlers: ofFamily(
    "generators-between-their-making-and-their-first-step",
    "typed/throwsBeforeItYields-anotherIsMadeAndStepped-underAHandler-cleanup",
    "untyped/throwsBeforeItYields-anotherIsMadeAndStepped-underAHandler-cleanup",
  ),
  GeneratorsAreReadBeforeTheirFirstStep: ofFamily(
    "generators-between-their-making-and-their-first-step",
    "typed/isAMethod-anErrorIsThrownIntoIt-nextTwice-heldByAClosure",
    "untyped/handsOnToAnother-nothing-endedFirst-loopThatStartsAnew",
  ),
  StepsInCyclesAreFirstSteps: [
    conditionOfAPass("a-generator-is-stepped-in-a-loop-and-kept.ts", "a-generator-is-stepped-in-a-loop-and-kept.js"),
    ofFamily(
      "generators-between-their-making-and-their-first-step",
      "typed/handsOnToAnother-aLoop-nextInALoopAndKept-inAClosure",
      "untyped/handsOnToAnother-anotherIsMadeAndStepped-nextInALoopAndKept-copiedIntoALoop",
    ),
  ],
  GeneratorHeadsHaveEffects: [
    conditionOfAPass(
      "a-generator-takes-its-argument-apart-when-it-is-made.js",
      "defaults-of-a-generators-parameters-are-evaluated-when-it-is-made.js",
    ),
    ofFamily(
      "generators-between-their-making-and-their-first-step",
      "typed/hasADefaultThatSays-anotherIsMadeAndStepped-nextTwice-inAClosure",
      "typed/takesAnObjectApart-aThrow-nextWithAValue-often",
    ),
  ],
  RemovedLoopsMayNotEnd: conditionOfAPass("a-loop-that-never-ends-still-runs.mjs"),
  RemovedLoopsHaveEffects: ofFamily(
    "loops-that-leave-nothing-behind",
    "untyped/heldByAClosure-aVariableOfTheModule-asksAProxy-inAClosure",
    "untyped/heldByAClosure-four-asksAList-aroundAnAwait",
  ),
  PromotedEnvironmentsAreMadeOften: ofFamily(
    "variables-that-closures-hold",
    "typed/heldByAGenerator-onOneWay-isKept-moduleLoop",
    "untyped/heldByAGenerator-onOneWay-isKept-moduleLoop",
  ),
  FlooredQuotientsHaveAnyDivisor: ofFamily("whole-numbers-divided", "typed/aroundZero-minusOne-floor-once"),
  RoundedQuotientsHaveAnySign: ofFamily(
    "whole-numbers-divided",
    "typed/aroundZero-minusOne-round-moduleLoop",
    "typed/aLength-minusOne-trunc-loopWithContinue",
  ),
  SkippedBlocksHaveEffects: ofFamily(
    "ways-that-part-and-meet",
    "untyped/undefinedOrNumber-asksAnObject-counts-testedBehindAWrite-inAClosure",
  ),
  RemovedFieldsHaveUnknownReaders: ofFamily(
    "fields-that-nothing-reads-by-name",
    "typed/filledLater-noMore-ownNames-handler",
    "typed/child-inALoop-asAPrototype-handlerInALoop",
  ),
  ProofsOutlastWritesToEverything: {
    ...conditionOfAPass("closures-see-the-variables-of-the-turn-they-were-made-in.ts"),
    flags: ["--aot-heat=everything-is-hot"],
  },
  ErasedValuesHaveEffects: conditionOfAPass("lists-of-constants-answer-what-they-hold-now.ts"),
  ProofsOutlastWritesToTheirSubject: ofFamily(
    "fields-that-nothing-reads-by-name",
    "typed/holdsAClosure-noMore-spread-loop",
    "typed/child-again-spread-often",
  ),
  WalkedLiteralsAreAsTheyWereMade: ofFamily(
    "the-keys-of-an-object-are-walked",
    "typed/literal-keys-addsAKey-method",
    "typed/literal-keysByIndex-deletesALaterKey-loop",
  ),
  WalkedKeysStandInTheFirstOrder: ofFamily(
    "the-keys-of-an-object-are-walked",
    "typed/oneOfTwoShapes-keysByIndex-deletesThisKey-once",
    "untyped/oneOfTwoShapes-everyKey-loop",
  ),
  WrittenRecordsHaveTheirKeysInOneOrder: ofFamily(
    "records-written-as-text",
    "typed/large-plainly-aFieldWasDeleted-once",
    "typed/emptyList-andReadBack-aFieldWasAdded-loop",
  ),
  WrittenRecordsStayAsTheyWere: conditionOfAPass(
    "a-member-changes-the-record-that-holds-it-while-the-record-is-written.ts",
  ),
  TaggedMakersAreOnlyConstructed: ofFamily(
    "one-class-makes-the-members-of-a-union",
    "typed/plainFunction-constEnumMembers-calledForOneOfItsOwn-writesItAsText-once",
  ),
  TaggedMakersAnswerWithTheirOwnObject: conditionOfAPass(
    "a-function-that-makes-the-members-of-a-union-is-also-called-and-answers-with-another-object.ts",
  ),
  FusedConversionsRunCode: conditionOfAPass("an-object-is-made-a-text-before-what-it-says-changes.js"),
  UnfinishedObjectsPassForFinished: ofFamily(
    "objects-filled-field-by-field",
    "untyped/fieldsAreOnlyDeclared-aLaterFieldIsStoredAndDeleted-addsThemUp-once",
    "typed/otherCodeGivesTheSecondField-aStoredFieldIsDeletedThroughAProxy-readsEveryField-twoLoopsStartedBetween",
  ),
  BirthsEndWithoutALook: ofFamily(
    "objects-filled-field-by-field",
    "typed/initialValues-aStoredFieldIsDeleted-asksForNames-handlerInALoop",
    "untyped/initialValues-aStoredFieldIsDeleted-asksForNames-handlerInALoop",
  ),
  HoistedReadsAreStoredInTheirLoops: ofFamily(
    "variables-of-enclosing-code-in-loops",
    "typed/functionAbove-object-reads-aWriterOnOneTurn-testedBehind-inAClosure",
    "untyped/functionAbove-object-reads-aWriterOnOneTurn-testedBehind-inAClosure",
  ),
  CarriedVariablesAreWrittenByOthers: ofFamily(
    "variables-of-enclosing-code-in-loops",
    "typed/moduleLet-object-storesOnBothSides-aWriterUnderAProxy-overAList-loop",
    "untyped/moduleVar-text-readsThenStores-aWriterUnderANative-overAList-method",
  ),
  DelayedStoresAreLeftOut: ofFamily(
    "variables-of-enclosing-code-in-loops",
    "typed/sameFunction-object-storesOnBothSides-aWriterOnOneTurn-testedBehind-inAClosure",
    "untyped/sameFunction-object-storesOnBothSides-aWriterOnOneTurn-testedBehind-inAClosure",
  ),
  DelayedStoresPassWhatMayThrow: ofFamily(
    "variables-of-enclosing-code-in-loops",
    "untyped/twoFunctionsAbove-text-storesOnSomeTurns-aBuiltInThatThrowsOutOfTheFunction-overAList-awaitUnderAHandler",
    "untyped/twoFunctionsAbove-text-storesOnSomeTurns-aBuiltInThatThrowsOutOfTheFunction-overAList-handler",
  ),
  TailCallsSwapTheirLastArguments: ofFamily(
    "functions-whose-last-act-is-to-call-themselves",
    "typed/declared-behindATest-turnsTwoAround-aClosureThatCounts-loop",
    "typed/declared-inAChoice-turnsTwoAround-aClosureThatCounts-cleanup",
  ),
  RememberedReadsOutlastStoresThroughOtherNames: ofFamily(
    "one-thing-under-two-names",
    "typed/fieldOfALiteral-counts-chosenByATest-storeStoreRead-loop",
    "typed/hiddenField-bumps-twoParameters-readStoreRead-loopsWithLabels",
  ),
  RememberedReadsOutlastWrites: ofFamily(
    "one-thing-under-two-names",
    "typed/fieldOfAnInstance-stores-outOfAField-readInALoop-inAClosure",
    "typed/hiddenField-sets-thisAndAParameter-storeOnSomeTurns-whileLoop",
  ),
  FusedGeneratorsAreSeenByOthers: ofFamily(
    "generators-walked-where-they-are-made",
    "typed/twoLoops-byHandAndEnds-runsOut-moduleLoop",
    "typed/returnsAValue-forOfThroughAVariable-runsOut-yieldUnderACleanup",
  ),
  ParsedMembersComeOnce: ofFamily(
    "texts-read-as-records",
    "typed/anything-fits-theMemberTwice-parsedByAHelper-copiesIt-loop",
    "typed/record-fits-theFirstTwice-parsedAsPartOfAList-listsTheKeys-loop",
  ),
  GrowingTextsAreHeldInOneState: ofFamily(
    "texts-put-together-piece-by-piece",
    "typed/element-fraction-growsWhileWhatItWasIsStillHeld-aFunction-constructor",
    "untyped/element-character-growsWhileWhatItWasIsStillHeld-aKey-loopWithBreak",
  ),
};
/** What no program can show, and the test of the engine that shows it (./engine-tests.test.ts runs those). */
const noticedByTheEngineTestsAlone: Record<string, string> = {};
/** What stops the build itself, which then says where it stood: ./a-build-that-stops-says-where.test.ts holds each to its line. */
const stopTheBuild = [
  "FunctionPassFailsAssertion",
  "FunctionPassReadsBadAddress",
  "FunctionPassRunsOutOfStack",
  "FunctionPassNeverEnds",
  "ProgramPassFailsAssertion",
  "FlowAnalysisFailsAssertion",
  "CodeGenerationFailsAssertion",
  "ImageBuildingFailsAssertion",
  "LoweringPanics",
];

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
    const path = resolve(root, program);
    const executable = join(folder, `program-${executables++}${isWindows ? ".exe" : ""}`);
    const plain = await spawned([bunExe(), "run", path], dirname(path), bunEnv);
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, path, "--outfile", executable],
      dirname(path),
      bunEnv,
    );
    // The compiler looks its own work over at the end, and what it then refuses to hand on has been noticed too.
    if (build.exitCode && build.stderr.includes("internal compiler error"))
      return { environment: environments[0], how: "the build stops" };
    built(build);
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

  /** Writes the program of the family, and says where it lies and with which flags of its own it is built. */
  function written(family: string, program: string) {
    const [kind, name] = program.split("/");
    const {
      programs,
    }: { programs(isTyped: boolean): { name: string; file: string; text: string; flags?: string[] }[] } = require(
      `./generated/births-and-uses/${family}`,
    );
    const found = programs(kind === "typed").find(candidate => candidate.name === name);
    expect({ family, program, isInTheFamily: !!found }).toEqual({ family, program, isInTheFamily: true });
    const home = join(folder, family, kind, name);
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, found!.file), found!.text);
    writeFileSync(join(home, "tsconfig.json"), tsconfig);
    return { path: join(home, found!.file), flags: found!.flags ?? [] };
  }

  test("every sabotage has programs that must notice it", () => {
    expect(
      listed!.filter(name => !noticedBy[name] && !noticedByTheEngineTestsAlone[name] && !stopTheBuild.includes(name)),
    ).toEqual([]);
    expect(
      [...Object.keys(noticedBy), ...Object.keys(noticedByTheEngineTestsAlone), ...stopTheBuild].filter(
        name => !listed!.includes(name),
      ),
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

  test.concurrent.each((listed ?? []).filter(name => noticedBy[name] && name.includes(wanted)))(
    "%s",
    async name => {
      const seen = (
        await Promise.all(
          [noticedBy[name]].flat().flatMap(({ folder: topic, flags: flagsOfRow, programs, isGenerated }) =>
            programs.map(program =>
              slot(async () => {
                const { path, flags } = isGenerated
                  ? written(topic, program)
                  : { path: `${topic}/${program}`, flags: flagsOfRow };
                const noticed = await departure(
                  path,
                  [...flags, `--aot-sabotage=${name}`],
                  isGenerated ? asTheyAre : underCollections,
                );
                if (!noticed) return [];
                expect({ path, control: await departure(path, flags, [noticed.environment]) }).toEqual({ path });
                return [`${path} ${JSON.stringify(noticed.environment)}: ${noticed.how}`];
              }),
            ),
          ),
        )
      ).flat();
      console.error(`SABOTAGE ${name}: ${seen.join(" | ") || "nobody noticed"}`);
      expect({ name, isNoticed: seen.length > 0 }).toEqual({ name, isNoticed: true });
    },
    1_800_000,
  );
});
