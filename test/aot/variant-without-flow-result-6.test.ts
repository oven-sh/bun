// One result of the flow analysis is switched off at a time. Each result is a true statement about the program, so any subset may be applied: what relied on the missing one takes the tested path, and the answers must be the same. A difference names a result that another one silently depends on.
import { test } from "bun:test";
import { flowResultKinds } from "./flow-result-kinds";
import { variant } from "./run-programs";

const file = 6;
const notYet: Record<string, string> = { ReachedFunctions: "every build, that of console.log(1) too, stops with an internal compiler error (NumberAndEncode: ProgramTableCheckFailed)" };
flowResultKinds.forEach((kind, index) => {
  if (index % 8 !== file - 1) return;
  if (kind in notYet) return void test.todo(`compile/aot/variant/without-flow-result/${kind} (${notYet[kind]})`);
  variant(`without-flow-result/${kind}`, [`--aot-disable=flow:${kind}`], {}, file, 8);
});
