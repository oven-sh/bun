// The programs of ./generate/what-is-moved-ahead-of-a-loop.ts, each shaped for one way in which the compiler does the work of a loop ahead of its turns. ./programs-in-every-run.txt lists them, so
// every run builds them as they are and with erased types. Here each is built six more times: with the checks of a validating build, with every function hot, with every function cold, with
// every pass verified, with the loads that were moved checked at run time, and with what the back end is told checked at run time. Which way a loop is compiled hangs on how hot it is, and a read that stands too early shows in those checks first.
// So do the programs in which a loop of the library runs ahead of a variable that holds a closure: every run builds them with the checks of a validating build.
import { programs as programsOfCallees } from "./generate/callees-replaced-behind-their-test";
import { programs as programsOfValues } from "./generate/values-that-are-there-only-behind-a-test";
import { callees, lists, values } from "./generate/what-is-moved-ahead-of-a-loop";
import { buildFlags } from "./harness/flags";
import { programsBuiltWith } from "./run-programs";

const named = (programs: { entry: string }[], name: RegExp) =>
  programs.map(program => program.entry.replace(/\.[jt]s$/, "")).filter(entry => name.test(entry));
const folders: [folder: string, files: Record<string, string>, belowAWalkOfTheLibrary: () => string[]][] = [
  ["values-that-are-there-only-behind-a-test", values, () => named(programsOfValues(), /^a-closure.*-by-an-iterator$/)],
  ["callees-replaced-behind-their-test", callees, () => named(programsOfCallees(), /-called-by-an-iterator$/)],
  ["lists-changed-behind-their-test", lists, () => []],
];
const ways: [label: string, flag: string][] = [
  ["validated", buildFlags.validate],
  ["every-function-hot", "--aot-heat=everything-is-hot"],
  ["every-function-cold", "--aot-heat=everything-is-cold"],
  ["verify-each-pass", buildFlags.verifyEachPass],
  ["moved-loads-checked-at-run-time", "--aot-check=MovedLoads"],
  ["decided-comparisons-checked-at-run-time", "--aot-check=DecidedComparisons"],
  ["claims-checked-at-run-time", "--aot-check=ClaimsToBackEnd"],
];

/** The names of the programs of a folder, without those that have a flag of their own. */
export const namesOf = (files: Record<string, string>) =>
  Object.keys(files)
    .filter(file => /\.[jt]s$/.test(file) && !(file.replace(/\.[jt]s$/, ".todo.txt") in files))
    .map(file => file.replace(/\.[jt]s$/, ""));

/** A folder a part. */
export function whatIsMovedAheadOfALoop(part: number, parts: number) {
  folders.forEach(([folder, files, belowAWalkOfTheLibrary], index) => {
    if (index % parts !== part - 1) return;
    for (const [label, flag] of ways)
      programsBuiltWith(folder, label, [flag], {}, 1, 1, [
        ...namesOf(files),
        ...(label === "validated" ? belowAWalkOfTheLibrary() : []),
      ]);
  });
}
