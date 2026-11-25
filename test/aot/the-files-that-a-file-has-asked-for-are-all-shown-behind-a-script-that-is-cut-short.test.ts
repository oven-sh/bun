// `module.children` is filled when it is read. A script that reads it under a timeout may be cut in the middle of that: what was not yet shown is shown at the next read.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const parents = 300;
const files: Record<string, string> = {};
for (let i = 0; i < parents; i++) {
  for (const letter of "xyz") files[`${letter}${i}.cjs`] = `exports.number = ${i};\n`;
  files[`a${i}.cjs`] =
    `require("./x${i}.cjs");\nrequire("./y${i}.cjs");\nrequire("./z${i}.cjs");\nmodule.exports = module;\n`;
}
files["steps.cjs"] =
  `module.exports = [${Array.from({ length: parents }, (_, i) => `() => require("./a${i}.cjs")`).join(", ")}];\n`;
// The script spins for half of its time first, so that the end of it falls among the reads.
files["main.mjs"] = `import vm from "node:vm";
import steps from "./steps.cjs";
const list = steps.map(step => step());
globalThis.list = list;
const text = "const until = performance.now() + 0.5; while (performance.now() < until); for (const each of list) each.children.length;";
try {
  new vm.Script(text).runInThisContext({ timeout: 1 });
} catch (error) {
  if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
}
console.log(list.filter(each => each.children.length !== 3).length);
process.exit(0);
`;

test("every file that a file has asked for is among its children behind a script that was cut short", async () => {
  using dir = tempDir("children-behind-a-cut", files);
  const app = join(String(dir), isWindows ? "app.exe" : "app");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", app],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  for (let turn = 0; turn < 16; turn++) {
    const { stdout, exitCode } = await run([app], String(dir), bunEnv);
    expect({ stdout, exitCode }).toEqual({ stdout: "0\n", exitCode: 0 });
  }
}, 120_000);
