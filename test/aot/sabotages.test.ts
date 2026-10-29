// Do the tests have teeth? A test that was never seen to fail proves nothing.
//
// `--aot-sabotage=<name>` (hidden) breaks one thing in a build on purpose: an emitter leaves out a barrier, a pass leaves out one of the
// conditions under which it may change the code. An ordinary build holds
// none of it. `bun compile --aot-list=registry` lists the names. Most are shown by a pair of engine tests, ./engine-tests/pipeline/sabotages/<name>.ir beside <name>-left-alone.ir.
// For each other name the table below has the programs that must notice, tried in turn, and this test passes only if
// A RUN OF ONE OF THEM DIFFERS FROM PLAIN BUN OR DIES. A sabotage that nothing sees fails here, and so does a name that the table lacks: each says which program is still to be written.
// A run that notices has its control: the same program in the same environment without the sabotage, as plain Bun.
//
//   bun test test/aot/sabotages                          all
//   AOT_SABOTAGE=<text> bun test test/aot/sabotages      the names that contain the text
import { afterAll, expect } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join, resolve } from "path";
import {
  built,
  slot,
  spawned,
  told,
  unsupported,
  withoutCoreDump,
  withoutCrashReport,
  withoutDebugInformation,
} from "./harness/commands";
import { registry } from "./harness/registry";
import { describe, test } from "./supported";

/** What the programs in TypeScript out of ./fuzz/generators/births-and-uses are checked under. */
const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
  },
});

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

// What a pass takes for granted shows in what a program answers, whenever the collector runs.
const asTheyAre: Environment[] = [{}];
const conditionOfAPass = (...programs: string[]): Row => ({ folder: "pass-conditions", flags: [], programs });
/** Programs out of ./fuzz/generators/births-and-uses/<family>.ts by name: `typed/<name>` is the one in TypeScript. */
const ofFamily = (family: string, ...programs: string[]): Row => ({
  folder: family,
  flags: [],
  programs,
  isGenerated: true,
});

/** The programs under ./parallel that must notice each sabotage. */
const noticedBy: Record<string, Row | Row[]> = {
  StoresNeedNoBarrier: {
    folder: "gc",
    flags: [],
    programs: ["young-cells-stored-old-arrays-survive.ts", "references-optional-fields-survive.ts"],
  },
  // The call clamps the bounds again, so the answers stay right: only the check of a validating build sees it.
  PartsOfViewsEndOneLater: {
    folder: "host-classes",
    flags: ["--aot-validate"],
    programs: ["text-is-encoded-into-the-rest-of-a-view.ts"],
  },
  WritesMayRunTwice: ofFamily(
    "work-done-ahead-of-a-test-that-fails",
    "typed/countsUp-looksAtAnotherObjectFirst-withAnAccessorForTheSecondField-inAClosure",
    "typed/saysSomething-isAMethod-withoutAField-inAClosure",
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
  StepsInCyclesAreFirstSteps: [
    conditionOfAPass("generator-is-stepped-in-loop-and-kept.ts"),
    ofFamily(
      "generators-between-their-making-and-their-first-step",
      "typed/handsOnToAnother-aLoop-nextInALoopAndKept-inAClosure",
      "untyped/handsOnToAnother-anotherIsMadeAndStepped-nextInALoopAndKept-copiedIntoALoop",
    ),
  ],
  RemovedLoopsHaveEffects: ofFamily(
    "loops-that-leave-nothing-behind",
    "untyped/heldByAClosure-aVariableOfTheModule-asksAProxy-inAClosure",
    "untyped/heldByAClosure-theLengthOfAList-joinsTexts-inAClosure",
    "typed/up-aCall-readsAGetter-loop",
  ),
  ProofsOutlastWritesToEverything: {
    ...conditionOfAPass("closures-see-variables-of-turn-made.ts"),
    flags: ["--aot-heat=everything-is-hot"],
  },
  ErasedValuesHaveEffects: conditionOfAPass("lists-of-constants-answer-what-hold-now.ts"),
  TaggedMakersAreOnlyConstructed: ofFamily(
    "one-class-makes-the-members-of-a-union",
    "typed/plainFunction-constEnumMembers-calledForOneOfItsOwn-writesItAsText-once",
  ),
  TaggedMakersAnswerWithTheirOwnObject: conditionOfAPass("function-makes-members-union-called.ts"),
  UnfinishedObjectsPassForFinished: ofFamily(
    "objects-filled-field-by-field",
    "untyped/fieldsAreOnlyDeclared-aLaterFieldIsStoredAndDeleted-addsThemUp-once",
    "typed/otherCodeGivesTheSecondField-aStoredFieldIsDeletedThroughAProxy-readsEveryField-twoLoopsStartedBetween",
  ),
  BirthsEndWithoutALook: ofFamily(
    "objects-filled-field-by-field",
    "typed/initialValues-aStoredFieldIsDeleted-asksForNames-handlerInALoop",
    "untyped/initialValues-aStoredFieldIsDeleted-addsUpWhatWasSeen-loop",
  ),
  HoistedReadsAreStoredInTheirLoops: ofFamily(
    "variables-of-enclosing-code-in-loops",
    "typed/functionAbove-object-reads-aWriterOnOneTurn-testedBehind-inAClosure",
    "untyped/functionAbove-object-reads-aWriterOnOneTurn-testedBehind-inAClosure",
  ),
  DelayedStoresAreLeftOut: ofFamily(
    "variables-of-enclosing-code-in-loops",
    "typed/sameFunction-object-storesOnBothSides-aWriterOnOneTurn-testedBehind-inAClosure",
    "untyped/sameFunction-object-storesOnBothSides-aWriterOnOneTurn-testedBehind-inAClosure",
  ),
  TailCallsSwapTheirLastArguments: ofFamily(
    "functions-whose-last-act-is-to-call-themselves",
    "typed/declared-behindATest-turnsTwoAround-aClosureThatCounts-loop",
    "typed/declared-inAChoice-turnsTwoAround-aClosureThatCounts-cleanup",
  ),
  FusedGeneratorsAreSeenByOthers: ofFamily(
    "generators-walked-where-they-are-made",
    "typed/twoLoops-byHandAndEnds-runsOut-moduleLoop",
    "typed/returnsAValue-byHand-runsOut-handlerInALoop",
  ),
  FramesAlwaysFit: conditionOfAPass("mark-taken-away-ahead-call-every-depth.mjs"),
  SignsOfComparedLanesDoNotMatter: {
    folder: "arrays",
    flags: [],
    programs: ["least-and-greatest-element-are-found.ts"],
  },
  SumsOfNumbersAreWhole: { folder: "arrays", flags: [], programs: ["elements-are-added-up.ts"] },
  LanesHoldWhateverIsComputed: { folder: "arrays", flags: [], programs: ["elements-are-kept-between-two-limits.ts"] },
  CallbacksOfOneChainShareNoMemory: conditionOfAPass("two-callbacks-of-chain-store-to-variable.js"),
  WhatRunsAgainLeavesNoTrace: conditionOfAPass("count-goes-up-reads-list-short-gap.js"),
  // The answer shows it, and a validating build names the type that was taken for proven.
  ChangedClosuresFailEveryTest: ["", "--aot-validate"].map(flag => ({
    folder: "calls",
    flags: flag ? [flag] : [],
    programs: ["captured-variable-holds-closure-number.mjs"],
  })),
};
/** What one kind of processor alone can show: for the others the phase that is broken finds nothing to do. */
const shownOnOneArchitectureAlone: Record<string, NodeJS.Architecture> = {};
/** What no program can show, and the test of the engine that shows it (./engine-tests.test.ts runs those). */
const noticedByTheEngineTestsAlone: Record<string, string> = {
  // Between the read of a word and two tests of its bits nothing that a program is compiled to writes that word.
  WordsReadAgainOutlastWrites: "merged-tests-of-bits-tell-the-log-of-the-word-read-again",
  // A variable that a loop reads again at the end of each turn, out of memory that the turn stores to under another address: what a program is compiled to reads such a variable by more than a load.
  VariablesReadAgainInLoopsOutlastWrites: "variable-read-again-in-loop-is-held-against-what-stands-for-it",
  // The bound of a loop is read twice ahead of the loop with a store between: where a list is made shorter its storage is read anew, so the two reads have other addresses.
  BoundsReadTwiceOutlastWrites: "bound-read-twice-is-held-against-what-stands-for-it",
  // Two neighboring words are read into two registers at once (arm64). In what a program is compiled to, a test or a mark for the collector stands between two reads with a store between them.
  PairedLoadsOutlastWrites: "loads-are-not-paired-across-store-that-may-lie-over-them",
  StoredValuesAreNeverRead: "an-operation-whose-operands-hold-values-and-that-holds-none-stops-the-build",
  WhatIsGivenTakesThePlaceOfWhatComes: "what-a-node-loses-where-it-is-given-more-is-reported",
  FieldsNeverChange: "a-field-said-never-to-change-is-reported",
  RangesEndOneEarly: "a-flag-past-the-range-that-was-told-is-reported",
  CallsThatThrowHaveNoSite: "a-call-said-to-throw-nothing-throws",
  NoCallCollects: "a-call-said-to-collect-nothing-collects",
  ConversionsOfStorageEndNoProofs: "plan-array-capacities-a-conversion-that-ends-a-proof-is-refused",
  StridedIndexesStayInRange: "a-strided-index-said-to-stay-in-range-is-reported",
  VectorTurnsMeetNoOtherAccess: "a-load-moved-across-the-store-of-another-view-is-reported",
};
/** The names that a test under ./engine-tests/pipeline/sabotages is built with. */
const pairs = join(import.meta.dir, "engine-tests", "pipeline", "sabotages");
const shownByAPairOfEngineTests = new Set(
  readdirSync(pairs).flatMap(file => / sabotage=(\w+)$/m.exec(readFileSync(join(pairs, file), "utf8"))?.[1] ?? []),
);
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
  const root = join(import.meta.dir, "parallel");
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
    // A Bun with assertions also validates the code of the back end after each of its phases, which comes first.
    if (build.exitCode && build.stderr.includes("AIR VALIDATION FAILURE"))
      return { environment: environments[0], how: "the validator of the back end stops the build" };
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
      `./fuzz/generators/births-and-uses/${family}`,
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
      listed!.filter(
        name =>
          !noticedBy[name] &&
          !noticedByTheEngineTestsAlone[name] &&
          !stopTheBuild.includes(name) &&
          !shownByAPairOfEngineTests.has(name),
      ),
    ).toEqual([]);
    expect(
      [
        ...Object.keys(noticedBy),
        ...Object.keys(noticedByTheEngineTestsAlone),
        ...stopTheBuild,
        ...shownByAPairOfEngineTests,
      ].filter(name => !listed!.includes(name)),
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

  test.concurrent.each(
    (listed ?? []).filter(
      name =>
        noticedBy[name] &&
        name.includes(wanted) &&
        (shownOnOneArchitectureAlone[name] ?? process.arch) === process.arch,
    ),
  )(
    "%s",
    async name => {
      const seen: string[] = [];
      for (const { folder: topic, flags: flagsOfRow, programs, isGenerated } of [noticedBy[name]].flat()) {
        for (const program of programs) {
          if (seen.length) break;
          await slot(async () => {
            const { path, flags } = isGenerated
              ? written(topic, program)
              : { path: `${topic}/${program}`, flags: flagsOfRow };
            const noticed = await departure(
              path,
              [...flags, `--aot-sabotage=${name}`],
              isGenerated ? asTheyAre : underCollections,
            );
            if (!noticed) return void console.error(`SABOTAGE ${name}: NOT NOTICED BY ${topic}/${program}`);
            expect({ path, control: await departure(path, flags, [noticed.environment]) }).toEqual({ path });
            seen.push(`${path} ${JSON.stringify(noticed.environment)}: ${noticed.how}`);
          });
        }
      }
      console.error(`SABOTAGE ${name}: ${seen.join(" | ") || "nobody noticed"}`);
      expect({ name, isNoticed: seen.length > 0 }).toEqual({ name, isNoticed: true });
    },
    1_800_000,
  );
});
