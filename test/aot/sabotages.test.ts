// Do the tests have teeth? A test that was never seen to fail proves nothing.
//
// `--aot-sabotage=<name>` (hidden) breaks one thing in a build on purpose: an emitter leaves out a barrier, a pass leaves out one of the
// conditions under which it may change the code. An ordinary build holds
// none of it. `bun compile --aot-list=registry` lists the names. Most are shown by a pair of engine tests, ./engine-tests/pipeline/sabotages/<name>.ir beside <name>-left-alone.ir,
// or by a small program that runs in the shell of the engine: ./engine/programs-that-notice-a-sabotage.ts.
// For each other name the table below has the programs that must notice, tried in turn, and this test passes only if
// A RUN OF ONE OF THEM DIFFERS FROM PLAIN BUN OR DIES. A sabotage that nothing sees fails here, and so does a name that the table lacks: each says which program is still to be written.
// A run that notices has its control: the same program in the same environment without the sabotage, as plain Bun.
//
//   bun test test/aot/sabotages                          all
//   AOT_SABOTAGE=<text> bun test test/aot/sabotages      the names that contain the text
import { expect } from "bun:test";
import { afterAll } from "./harness/declare";
import { readdirSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join, resolve } from "path";
import { noticedInTheShell } from "./engine/programs-that-notice-a-sabotage";
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

function movesOfTheRegisterAllocator(check: string): Row {
  return {
    folder: "objects",
    flags: [check],
    programs: ["spread-replaces-accessors.ts", "key-order-field-limit.js"],
  };
}

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
  ChangedClosuresFailEveryTest: {
    folder: "calls",
    flags: [],
    programs: ["closure-given-member-called-in-two-loops.mjs"],
  },
  // What the stack holds where the call reads it goes by what ran before: a crash, or another answer. The check says it at build time, every time.
  LiveRangesSplitTwiceHaveNoColdUses: {
    folder: "mistyped-values",
    flags: ["--aot-check=spill-slots"],
    programs: ["function-typed-boolean-read-from-record-by-inherited-name.ts", "function-typed-boolean-through-any.ts"],
  },
  // The register allocator leaves out one kind of the moves between registers and spill slots. Whoever reads the slot misses a store, whoever reads the register a load.
  // The large functions are those of Bun's own library, which these programs bring.
  StoresBehindClustersAreNotNeeded: movesOfTheRegisterAllocator("--aot-check=spill-slots"),
  StoresAheadOfCallsAreNotNeeded: movesOfTheRegisterAllocator("--aot-check=spill-slots"),
  StoresBehindSpilledDefinitionsAreNotNeeded: movesOfTheRegisterAllocator("--aot-check=spill-slots"),
  LoadsAheadOfClustersAreNotNeeded: movesOfTheRegisterAllocator("--aot-check=allocated-registers"),
  LoadsBehindCallsAreNotNeeded: movesOfTheRegisterAllocator("--aot-check=allocated-registers"),
};
/** What one kind of processor alone can show: for the others the phase that is broken finds nothing to do. */
const shownOnOneArchitectureAlone: Record<string, NodeJS.Architecture> = {
  // How many registers outlive a call goes by the processor. With six registers allowed every processor shows it: the engine's test
  // check-of-spill-slots-sees-operand-left-behind-by-second-split.
  LiveRangesSplitTwiceHaveNoColdUses: "x64",
};
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
    const printed = build.stdout.length + build.stderr.length;
    expect({ program, flags, printed, isUnderAMegabyte: printed < 2 ** 20 }).toEqual({
      program,
      flags,
      printed,
      isUnderAMegabyte: true,
    });
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

  test("every sabotage has programs that must notice it", () => {
    expect(
      listed!.filter(
        name =>
          !noticedBy[name] &&
          !noticedInTheShell[name] &&
          !noticedByTheEngineTestsAlone[name] &&
          !stopTheBuild.includes(name) &&
          !shownByAPairOfEngineTests.has(name),
      ),
    ).toEqual([]);
    expect(
      [
        ...Object.keys(noticedBy),
        ...Object.keys(noticedInTheShell),
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
      for (const { folder: topic, flags, programs } of [noticedBy[name]].flat()) {
        for (const program of programs) {
          if (seen.length) break;
          await slot(async () => {
            const path = `${topic}/${program}`;
            const noticed = await departure(path, [...flags, `--aot-sabotage=${name}`], underCollections);
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
