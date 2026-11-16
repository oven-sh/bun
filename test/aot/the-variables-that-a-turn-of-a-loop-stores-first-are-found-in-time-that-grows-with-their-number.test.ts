// A variable of the file that every turn of a loop stores ahead of its reads does not come round. Whether the store stands first was asked by walking the turn anew for each such variable:
// four times the work with each doubling: 2.6 G instructions at 3,200 variables, 6.3 G at 6,400, 19 G at 12,800, where 1.7 G, 2.9 G and 5.3 G are enough. At 102,400 the build does not end within a minute; 38 G are enough.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

test("a loop whose turn stores a hundred thousand variables of its file first is built", async () => {
  const names = Array.from({ length: 102_400 }, (_, index) => `held${index}`);
  using dir = tempDir("variables-that-a-turn-stores-first", {
    "main.cjs": `${names.map(name => `var ${name};`).join("\n")}
let total = 0;
let turn = 0;
do {
${names.map((name, index) => `  ${name} = turn + ${index % 7};\n  total = (total + ${name}) | 0;`).join("\n")}
  turn++;
} while (turn < Number("3"));
console.log("SAID", total);
function peek() {
  return ${names.map(name => `(typeof ${name}).length`).join(" + ")};
}
console.log("SAID", peek());
`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "out/program"], cwd);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
    stdout: "SAID 1228782\nSAID 614400\n",
    stderr: "",
    exitCode: 0,
  });
});
