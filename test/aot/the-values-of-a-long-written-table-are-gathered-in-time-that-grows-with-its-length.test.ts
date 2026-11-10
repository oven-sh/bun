// The name of a module that is read out of a written table under a key nobody knows may be any of the table's values. The build looked through all the values it had gathered
// for each one more, through all the texts it had made for each one more, and through all the entries of the table for each entry, to drop an earlier one of the same key:
// four times the work with each doubling: 17 G instructions at 8,000 keys, 42 G at 16,000. At sixty-four thousand the build does not end within minutes.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(60_000);

test("a table of sixty-four thousand names read under a key that nobody knows is built", async () => {
  const indexes = Array.from({ length: 64_000 }, (_, index) => index);
  using dir = tempDir("values-of-a-long-written-table", {
    "main.cjs": `const table = {
${indexes.map(index => `  k${index}: "./o${index}.cjs",`).join("\n")}
};
let found = "none";
if (process.argv.length > 99) found = require(table[process.argv[99]]).name;
console.log("SAID", Object.keys(table).length, found);
`,
  });
  const cwd = String(dir);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "program"], cwd);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([join(cwd, "program")], cwd)).toEqual({ stdout: "SAID 64000 none\n", stderr: "", exitCode: 0 });
});
