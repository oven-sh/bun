// bun test/aot/tools/goals-that-grew.ts <before> <after> [--over=<percent>]
//
// Two outputs of ../run-parallel.ts, of two builds of Bun on the same programs. A bound that says ` Todo:` is not met, and passes however far off it is: what was counted
// for it stands in the line of its file (`goalsNotMet`). This names every count that moved FURTHER from its bound, by how much, and ends with 1 if one did by more than
// --over percent (0 without it). `<=`: it rose. `>=`: it fell. `=`: it lies further off on either side.
// A goal that only one of the two has is named too, and fails nothing: a bound that was met and went out, a program that is new, a bound that was changed.
import { readFileSync } from "node:fs";

const words = process.argv.slice(2);
const [before, after] = words.filter(word => !word.startsWith("--"));
const over = Number(words.find(word => word.startsWith("--over="))?.slice("--over=".length) ?? 0);
if (!before || !after || Number.isNaN(over)) {
  console.error("usage: bun test/aot/tools/goals-that-grew.ts <before> <after> [--over=<percent>]");
  process.exit(2);
}

/** The two may have run in two folders: a program is named from `parallel/` on. */
const nameOf = (file: string) => file.replaceAll("\\", "/").replace(/^.*\/parallel\//, "");
function read(path: string) {
  const goals = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.startsWith('{"file":')) continue;
    const { file, goalsNotMet } = JSON.parse(line) as { file: string; goalsNotMet?: Record<string, number> };
    for (const [goal, counted] of Object.entries(goalsNotMet ?? {})) goals.set(`${nameOf(file)}: ${goal}`, counted);
  }
  return goals;
}
const [was, is] = [read(before), read(after)];
if (!was.size || !is.size) {
  console.error(`no goal that is not met stands in ${was.size ? after : before}: is it an output of run-parallel.ts?`);
  process.exit(2);
}

const farFromBound = (goal: string, counted: number) => {
  const [, relation, bound] = /(=|>=|<=) (\d+)$/.exec(goal)!;
  return relation === "<="
    ? counted - Number(bound)
    : relation === ">="
      ? Number(bound) - counted
      : Math.abs(counted - Number(bound));
};
const percent = (from: number, to: number) => (from ? ((to - from) / from) * 100 : Infinity);
let [further, furtherOver, nearer, same] = [0, 0, 0, 0];
for (const [goal, counted] of [...is].sort(([one], [other]) => (one < other ? -1 : 1))) {
  const earlier = was.get(goal);
  if (earlier === undefined) {
    console.log(`NEW ${goal}: ${counted}`);
    continue;
  }
  const moved = farFromBound(goal, counted) - farFromBound(goal, earlier);
  if (!moved) same++;
  else if (moved < 0) nearer++;
  else {
    further++;
    const by = Math.abs(percent(earlier, counted));
    if (by > over) furtherOver++;
    console.log(
      `${by > over ? "FURTHER" : "further"} ${goal}: ${earlier} > ${counted} (${counted > earlier ? "+" : ""}${counted - earlier}, ${by.toFixed(1)}%)`,
    );
  }
}
for (const [goal, counted] of was) if (!is.has(goal)) console.log(`GONE ${goal}: ${counted}`);
console.log(
  `${is.size} goals not met: ${further} further from their bounds, ${furtherOver} of them by more than ${over}% . ${nearer} nearer . ${same} as they were`,
);
process.exit(furtherOver ? 1 : 0);
