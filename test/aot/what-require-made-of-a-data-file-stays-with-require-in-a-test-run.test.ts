import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The loader keeps what require() has parsed and what an import has parsed apart: two objects, and what is stored in one does not show in the other.
// In a test run every load is the loader's, a written one too. (An executable has one object where the bundler links both sites: test/aot/parallel/modules/
// what-require-made-of-a-data-file-stays-with-require has the loads of an executable that are the loader's.)
const show = `loaded.default.mode = "second";
  console.log(name, required === loaded.default, required.mode, loaded.default.mode, require(path) === required);`;
const testFile = (
  name: string,
  path: string,
  text: string,
) => `const name = ${JSON.stringify(name)}, path = ${JSON.stringify(path)};
${text}
test("runs", async () => {
  await shown;
});
`;
const files = {
  "package.json": `{}`,
  "written.json": `{ "mode": "first" }\n`,
  "below.json": `{ "mode": "first" }\n`,
  "statement.json": `{ "mode": "first" }\n`,
  "made.json": `{ "mode": "first" }\n`,
  "below.cjs": `exports.required = require("./below.json");\n`,
  "later.mjs": `import settings from "./statement.json";\nexport default settings;\n`,
  "a.test.cjs": testFile(
    "both written:",
    "./written.json",
    `const required = require("./written.json");
const shown = import("./written.json").then(loaded => {
  ${show}
});`,
  ),
  "b.test.cjs": testFile(
    "a file below requires:",
    "./below.json",
    `const { required } = require("./below.cjs");
const shown = import("./below.json").then(loaded => {
  ${show}
});`,
  ),
  "c.test.cjs": testFile(
    "a statement of a module that is loaded later:",
    "./statement.json",
    `const required = require("./statement.json");
const shown = import("./later.mjs").then(loaded => {
  ${show}
});`,
  ),
  "d.test.cjs": testFile(
    "under a name of the run:",
    "./made.json",
    `const required = require("./made.json");
const shown = import(__dirname + "/made" + String.fromCharCode(46 + Date.now() * 0) + "json").then(loaded => {
  ${show}
});`,
  ),
};
const printed = [
  "both written: false first second true",
  "a file below requires: false first second true",
  "a statement of a module that is loaded later: false first second true",
  "under a name of the run: false first second true",
];

async function runTests(folder: string, flags: string[]) {
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], folder, { ...bunEnv, NO_COLOR: "1" });
  return { printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), exitCode };
}

for (const flags of [[], ["--isolate"]])
  test.concurrent(
    `require() and import of one data file ${flags.join(" ")}`,
    async () => {
      using dir = tempDir("data-file-of-require-and-of-import", files);
      expect(await runTests(String(dir), flags)).toEqual({ printed, exitCode: 0 });
      expect(await runTests(String(dir), ["--aot", ...flags])).toEqual({ printed, exitCode: 0 });
    },
    240_000,
  );
