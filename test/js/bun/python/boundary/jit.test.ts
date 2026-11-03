// What the operators, calls and property accesses of JavaScript give for values of Python's does not depend on which tier of the engine
// runs them, nor on what the code has seen before.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

// These builds take seconds to start Python, and to compile.
if (isDebug || isASAN) setDefaultTimeout(120_000);

// For each function of fixtures/tiers-fixture.ts, what it gives for each pair of values of Python's.
const expected: Record<string, unknown[]> = {
  eq: [true, false, false, false, true],
  eqItself: [false, true, false],
  notEq: [false, true],
  strictEq: [false],
  add: ["V3", "V3", "V3", "(1, 2)"],
  addObjects: ["V3", "(1, 2)"],
  sub: ["V1", "V2"],
  mul: ["V6", "(1, 1)", "(1, 1)"],
  negate: ["V-3"],
  less: [true, false, true],
  lessObjects: [true, false],
  increment: ["V2"],
  addAssign: ["V3"],
  typeOf: ["object", "function", "function", "object"],
  instanceOf: [true, true, false, false],
  property: [7, 8, null],
  index: [6, "one", null],
  length: [3, 1],
  call: ["1", "V3", "12", "2", "2.5"],
  callKeywords: [201, 31],
  construct: ["V3", "12", "(1,)"],
  spread: [3, 4, 1],
  forOf: [6, 6],
  has: [true, false, true, true],
  template: ["V1-(1,)"],
  truth: [1, 1, 1],
  keys: ["k", "a,b"],
  destructure: [9, 3],
  destructureArray: [7],
  json: ["[1,2]", '{"a":[1]}', "[2]"],
  extend: ["function,Derived,derived+6", "function,Derived,derived+undefined", "function,Derived,derived+8"],
  floatInList: ["object,3,true,false"],
  bigInt: ["1180591620717411303425"],
};

const eager = {
  BUN_JSC_useConcurrentJIT: "0",
  BUN_JSC_thresholdForJITAfterWarmUp: "10",
  BUN_JSC_thresholdForOptimizeAfterWarmUp: "20",
  BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "40",
};

test.concurrent.each([
  ["the interpreter", { BUN_JSC_useJIT: "0" }, "0/1"],
  ["the baseline JIT", { ...eager, BUN_JSC_useDFGJIT: "0" }, "0/1"],
  ["the DFG", { ...eager, BUN_JSC_useFTLJIT: "0" }, "0/1"],
  ["the FTL, first half", eager, "0/2"],
  ["the FTL, second half", eager, "1/2"],
])("%s", async (_, options, part) => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fixtures", "tiers-fixture.ts")],
    env: { ...bunEnv, ...options, ROUNDS: "100", PART: part },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const [index, parts] = part.split("/").map(Number);
  // Each comes three times: at first, and twice more when the function has become hot again.
  const lines = Object.entries(expected)
    .filter((_, i) => i % parts === index)
    .map(([name, result]) => `${name} ${JSON.stringify([...result, ...result, ...result])}`);
  expect(stdout.trim().split("\n")).toEqual(lines);
  expect(exitCode).toBe(0);
});
