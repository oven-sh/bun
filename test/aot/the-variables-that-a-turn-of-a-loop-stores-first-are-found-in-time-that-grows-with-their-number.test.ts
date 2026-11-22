// A variable of the file that every turn of a loop stores ahead of its reads does not come round. Whether the store stands first was asked by walking the turn anew for each such variable:
// four times the work with each doubling: 2.6 G instructions at 3,200 variables, 6.3 G at 6,400, 19 G at 12,800, where 1.7 G, 2.9 G and 5.3 G are enough. At 102,400 the build does not end within a minute; 38 G are enough.
// `last` is one variable more, which every turn reads ahead of its store: it does come round, and the build lays a read of it in front of the loop. The build counts such reads, and
// `--explain=statistics` prints the count. A count of one says that the question was asked of this loop, and that the store was found to stand first for each of the other variables.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

// What `--explain=statistics` writes to stderr: a line for each counter, and behind them a line for each stage with the names of its counters.
const lineOfTheStatistics = /^(?:[A-Z][A-Za-z0-9]* \d+|stage [A-Z][A-Za-z]*:(?: [A-Z][A-Za-z0-9]*)*)$/;

test("a loop whose turn stores a hundred thousand variables of its file first is built", async () => {
  const names = Array.from({ length: 102_400 }, (_, index) => `held${index}`);
  using dir = tempDir("variables-that-a-turn-stores-first", {
    "main.cjs": `${names.map(name => `var ${name};`).join("\n")}
var last;
let total = 0;
let turn = 0;
do {
${names.map((name, index) => `  ${name} = turn + ${index % 7};\n  total = (total + ${name}) | 0;`).join("\n")}
  total = (total + (last | 0)) | 0;
  last = turn;
  turn++;
} while (turn < Number("3"));
console.log("SAID", total);
function peek() {
  return ${[...names, "last"].map(name => `(typeof ${name}).length`).join(" + ")};
}
console.log("SAID", peek());
`,
  });
  const cwd = String(dir);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--explain=statistics", "main.cjs", "--outfile", "out/program"],
    cwd,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line !== "" && !lineOfTheStatistics.test(line)),
    readsLaidInFrontOfTheLoop: Number(/^LoopStoredVariableReadsHoisted (\d+)$/m.exec(built.stderr)?.[1]),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], readsLaidInFrontOfTheLoop: 1, exitCode: 0 });
  // The written numbers of a turn are 307,194 together, and each turn adds its own number 102,400 times: 3 * 307,194 + (0 + 1 + 2) * 102,400. The third turn reads 1 from `last`.
  // "number" has six letters, for each of the 102,401 variables.
  expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
    stdout: "SAID 1228783\nSAID 614406\n",
    stderr: "",
    exitCode: 0,
  });
});
