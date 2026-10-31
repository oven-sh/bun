// A chain of casts ends in the value that it starts from. A cast on the way may name a fact: what it says of the value holds from the place of
// that fact on, and in front of it the word may be anything. So the value at the end is for questions about the object: which one it is, what made it.
// sameObjectThroughCasts() answers with a type of its own, RootThroughCasts, which compares and can be looked up and which no operation takes.
// Whoever makes an operation on the value, or asks where it is at hand, asks sameObjectBehindFacts(), which stops at a cast that names a fact.
// Goes by the text of the engine's sources.
//
// THE NUMBERS BELOW ARE ONLY EVER LOWERED, AND NO LINE IS ADDED.
import { expect, test } from "bun:test";
import { filesOfCompiler, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/the-value-under-a-chain-of-casts-is-only-asked-about.test.ts");

// Each takes the plain value out of a RootThroughCasts: a key of a table, or a question that takes a ValueID.
const takenOut: Record<string, number> = {
  "analysis/AOTValueIdentity.cpp": 2,
  "analysis/AOTValueIdentity.h": 1,
  "analysis/AOTWholeLiterals.cpp": 1,
  "builtins/AOTBuiltinPristine.cpp": 1,
  "builtins/AOTRegExpBuiltinEmitter.cpp": 1,
  "builtins/AOTSimplifyBuiltinCallsLiterals.cpp": 2,
  "codegen/AOTCodeSizeMap.cpp": 2,
  "ir/AOTIRFunction.h": 1,
  "ir/AOTVerifierAccesses.cpp": 1,
  "ir/AOTVerifierCalls.cpp": 1,
  "ir/AOTVerifierOperations.cpp": 1,
  "passes/AOTAddGenericVersion.cpp": 2,
  "passes/AOTArrayCapacities.cpp": 1,
  "passes/AOTArrays.cpp": 2,
  "passes/AOTCreatedPropertyKeys.cpp": 1,
  "passes/AOTEliminateRedundantReads.cpp": 3,
  "passes/AOTEnvironments.cpp": 1,
  "passes/AOTExpandOwnKeys.cpp": 3,
  "passes/AOTExpectFieldsByNames.cpp": 3,
  "passes/AOTFrameAllocation.cpp": 1,
  "passes/AOTFrameAllocationPlanner.cpp": 1,
  "passes/AOTFreshResults.cpp": 3,
  "passes/AOTInlining.cpp": 7,
  "passes/AOTInsertObjectCoercibleChecks.cpp": 3,
  "passes/AOTJSONVerification.cpp": 1,
  "passes/AOTResolveCalls.cpp": 2,
  "passes/AOTSimplifyCasts.cpp": 3,
  "passes/AOTSinkAllocationsCandidates.cpp": 1,
  "passes/AOTSinkAllocationsRewriting.cpp": 2,
  "passes/AOTStringPasses.cpp": 1,
  "passes/AOTVirtualObjectParameters.cpp": 1,
  "select/AOTCallRules.cpp": 1,
  "select/AOTObjectCreationRules.cpp": 1,
  "select/AOTStringOrderRules.cpp": 2,
  "valueflow/AOTFlowConstructionOrders.cpp": 4,
  "valueflow/AOTValueFlowResultsClasses.cpp": 1,
  "valueflow/AOTValueFlowUnobservedDefinitions.cpp": 1,
};

// Each goes down a chain of casts by hand.
const walksByHand: Record<string, number> = {
  "analysis/AOTBlockFrequencies.cpp": 1,
  "analysis/AOTValueIdentity.cpp": 1,
  "builtins/AOTSimplifyBuiltinCalls.cpp": 1,
  "builtins/AOTSimplifyBuiltinCallsURLs.cpp": 1,
  "codegen/AOTCompileFunctions.cpp": 1,
  "image/AOTRegExpRequests.cpp": 1,
  "ir/AOTVerifierProofs.cpp": 1,
  "passes/AOTCoroutines.cpp": 1,
  "passes/AOTDeferredClosuresAndConstantCollections.cpp": 1,
  "passes/AOTEnvironments.cpp": 1,
  "passes/AOTExpandOwnKeys.cpp": 1,
  "passes/AOTRingPasses.cpp": 1,
  "valueflow/AOTFlowApplyBody.cpp": 1,
  "valueflow/AOTValueFlowUnobservedDefinitions.cpp": 1,
};

function grown(found: Map<string, number>, known: Record<string, number>, what: string): string[] {
  return [...found]
    .filter(([file, count]) => count > (known[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} ${what}, and ${known[file] ?? 0} are known`);
}

test.skipIf(!sources)("nothing new takes the plain value out of the end of a chain of casts", () => {
  const found = new Map<string, number>();
  for (const { name, text } of filesOfCompiler()) {
    const count = text.match(/\.valueInFrontOfFacts\(\)/g)?.length;
    if (count) found.set(name, count);
  }
  expect(grown(found, takenOut, "places that take the value in front of facts")).toEqual([]);
});

test.skipIf(!sources)("nothing new goes down a chain of casts by hand", () => {
  const walk =
    /\b(?:isCast|isCastWithoutTest|isCastOrConversion)\((?:\w+(?:\.|->))*at\((\w+)\)\.opcode\)|\bOpcode::AssumeType \|\| isCastThatProvesNothing\(|isCastThatProvesNothing\([^\n]*\) \|\| [^\n]*== (?:Typed::)?Opcode::AssumeType\)/;
  const found = new Map<string, number>();
  for (const { name, text } of filesOfCompiler()) {
    const count = text.split("\n").filter(line => /\b(?:while|for) \(/.test(line) && walk.test(line)).length;
    if (count) found.set(name, count);
  }
  expect(found.size).toBeGreaterThan(0);
  expect(grown(found, walksByHand, "walks down a chain of casts")).toEqual([]);
});
