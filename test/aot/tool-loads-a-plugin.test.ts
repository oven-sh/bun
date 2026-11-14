// webpack loads `ts-loader` by its name, and so do babel, eslint and rollup load what a test names for them. No executable holds a package that
// only the tests reach, so what it loads from disk hides nothing. A package of the product finds compiled files only.
// Who counts as which is decided by the import graph: src/aot/compile/files_of_tests_tests.rs has the cases. Here: that the run time follows.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "tool-loads-a-plugin", "type": "module" }`,
  "node_modules/tool/package.json": `{ "name": "tool", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/tool/index.js": `"use strict";\nmodule.exports = require("./lib/transform.js");\n`,
  "node_modules/tool/lib/transform.js": `"use strict";
const find = name => require.resolve(name, { paths: [process.cwd()] });
exports.transform = function (text, options) {
  let result = text;
  for (const name of options.plugins) result = require(find(name))(result);
  return result;
};
exports.transformAsync = async function (text, options) {
  let result = text;
  for (const name of options.plugins) result = (await import(name)).default(result);
  return result;
};
`,
  "node_modules/plugin/package.json": `{ "name": "plugin", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/plugin/index.js": `"use strict";\nmodule.exports = text => text.toUpperCase();\n`,
  "src/own-plugin.cjs": `module.exports = text => text + "!";\n`,
  "src/product.ts": `export const name: string = "product";\n`,
  "tests/tool.test.ts": `import { expect, test } from "bun:test";
import { transform, transformAsync } from "tool";
import { name } from "../src/product";
const said = async (run: () => unknown) => {
  try { return await run(); } catch (error: any) { return String(error.message).startsWith("Cannot load") ? "refused" : String(error); }
};
test("what the tool answers", async () => {
  const answers = [
    name,
    await said(() => transform("a", { plugins: ["plugin"] })),
    await said(() => transformAsync("a", { plugins: ["plugin"] })),
    await said(() => transform("a", { plugins: ["./src/own-plugin.cjs"] })),
  ];
  console.log("SAID " + JSON.stringify(answers));
  expect(1).toBe(1);
});
`,
};
const loads = ["product", "A", "A", "a!"];

async function saidBy(project: Record<string, string>, flags: string[]) {
  using dir = tempDir("tool-loads-a-plugin", project);
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  const said = stdout.split("\n").find(line => line.startsWith("SAID "));
  return { said: said ? JSON.parse(said.slice(5)) : stderr, exitCode };
}

test.each([
  ["plain `bun test`", []],
  ["a compiled run, for a package that only the tests import", ["--aot"]],
])("%s loads them", async (_, flags) => {
  const { said, exitCode } = await saidBy(files, flags);
  expect({ said, exitCode }).toEqual({ said: loads, exitCode: 0 });
});
