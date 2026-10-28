// `--aot-validate` asks every proof of the compiler again at run time. The checks it puts into the code stand in the way of some optimizations, and a few are switched off for it: a fault in one of those
// does not show in a validating build. Seven programs are built both ways and the statistics of the two reports are added up.
//
//   leftOut    counts in an ordinary build and counts nothing in a validating one
//   underHalf  counts under half as much
//
// Both lists may only get shorter. A name that is not listed and turns up is a new blind spot of validation: make the optimization work beside the checks. A listed name that counts again is taken out of its list.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(600_000);

const programs = [
  "typed-objects/small-functions-each-read-one-option-of-a-record-of-settings.ts",
  "async-and-generators/values-held-by-suspended-async.ts",
  "library-modules/more-of-crypto.js",
  "arrays/arrays-filled-in-loops-that-call-back.ts",
  "host-classes/server-request-getters.ts",
  "impostors/arrays/the-last-element-is-of-a-kind-not-seen-by-loops-that-add-and-multiply.js",
  "data-from-outside/sql-typed-rows.ts",
];

const leftOut = [
  "AggregateParametersPromoted",
  "ArrayChainsFused",
  "BytesFolded",
  "CallsThatSkipAnsweredEntryChecks",
  "ClosuresInFrames",
  "ClosuresLent",
  "EnvironmentsInFrames",
  "FunctionsFolded",
  "FunctionsWithFrameOnSomePaths",
  "FunctionsWithoutFrame",
  "FuseArrayChainsChanges",
  "InnerEntryBytesEmitted",
  "JumpOnlyFunctionsRemoved",
  "JumpsToNextFunctionRemoved",
  "MaxFrameEnvironmentFieldsHits",
  "MaxParameterWrapperValuesHits",
  "MaxSelectedHeadOperationsHits",
  "MaxSourcesOfLoopTestHits",
  "ObjectsInFrames",
  "PromoteAggregateParametersChanges",
  "RestartInGenericVersionChanges",
  "RestartsInGenericVersion",
  "ShorterEntrancesCreated",
  "SkipAnsweredEntryChecksChanges",
  "TestNarrowerTypesFirstChanges",
  "TestsOnWaysBackNotMade",
  "URLsLeftUnbuilt",
  "WaysBackNotMadeForSizeOfCopy",
];

const underHalf = [
  "AwaitedCallsResolved",
  "ClosuresNeverCreated",
  "EncodedVariableTestGroups",
  "InlineDecisionInlineHead",
  "LoopBoundsClamped",
  "LoopsVersioned",
  "MaxClonedValuesPerExcursionHits",
  "MaxClonedValuesPerUnswitchedLoopHits",
  "MaxInlineHeadBytesHits",
  "MaxSelectedHeadBlocksHits",
  "MaxThreadedPathCostHits",
  "RangeChecksRemoved",
  "RegExpsDeferredInVariables",
  "ResolveAwaitedCallsChanges",
  "ResultsProvenBehindEntryChecks",
  "SelectedHeadsFound",
  "SelectedHeadsInlined",
  "SlotStoreRunGroups",
  "ThrowNewErrorGroups",
  "UnreadVariableStoresRemoved",
];

// TODO: both lists are out of date: ArrayChainsFused and FuseArrayChainsChanges count again, and other names are left out.
test.todo("a validating build leaves out no more optimizations than are listed", async () => {
  // The counts of the back end go by the processor, and some stand close to a half.
  if (process.platform !== "linux" || process.arch !== "x64") return;
  using dir = tempDir("aot-what-validation-leaves-out", {});
  const directory = String(dir);
  const sums = [new Map<string, number>(), new Map<string, number>()];
  await Promise.all(
    programs.flatMap((program, index) =>
      [[], ["--aot-validate"]].map(async (flags, way) => {
        // Where it lies, the program finds the types of the repository.
        const entry = join(import.meta.dir, "programs", program);
        const report = join(directory, `p${index}-${way}.json`);
        const built = await run(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...flags,
            "--aot-report=" + report,
            entry,
            "--outfile",
            join(directory, `x${index}-${way}${isWindows ? ".exe" : ""}`),
          ],
          dirname(entry),
          bunEnv,
        );
        expect({ program, flags, exitCode: built.exitCode }).toEqual({ program, flags, exitCode: 0 });
        const { statistics } = (await Bun.file(report).json()) as { statistics: Record<string, number> };
        for (const [name, count] of Object.entries(statistics)) sums[way].set(name, (sums[way].get(name) ?? 0) + count);
      }),
    ),
  );
  const [ordinary, validating] = sums;
  const names = [...ordinary.keys()].filter(name => !name.endsWith("Nanoseconds") && ordinary.get(name)! > 0).sort();
  const nothing = names.filter(name => !validating.get(name));
  const little = names.filter(name => validating.get(name)! > 0 && validating.get(name)! * 2 < ordinary.get(name)!);
  expect({
    newlyLeftOut: nothing.filter(name => !leftOut.includes(name)),
    newlyUnderHalf: little.filter(name => !leftOut.includes(name) && !underHalf.includes(name)),
    listedAndCountsAgain: leftOut.filter(name => validating.get(name)! > 0),
  }).toEqual({ newlyLeftOut: [], newlyUnderHalf: [], listedAndCountsAgain: [] });
});
