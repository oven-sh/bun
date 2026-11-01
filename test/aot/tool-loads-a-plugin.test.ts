// webpack loads `ts-loader` by its name, and so do babel, eslint and rollup load what a test names for them. No executable holds a package that
// only the tests reach, so what it loads from disk hides nothing. A package of the product finds compiled files only.
// Who counts as which is decided by the import graph: src/aot/compile/files_of_tests_tests.rs has the cases. Here: that the run time follows,
// and that a layer of packages, which doesn't see who imports it, is told.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "tool-loads-a-plugin", "type": "module" }`,
  "node_modules/tool/package.json": `{ "name": "tool", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/tool/index.js": `"use strict";\nmodule.exports = require("./lib/transform.js");\n`,
  "node_modules/tool/lib/transform.js": `"use strict";
const Module = require("node:module");
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
// Whether the build takes such a call for a load or not, one program and layers answer alike.
exports.otherRoads = [
  (text, options) => module.require(find(options.plugins[0]))(text),
  (text, options) => Module.createRequire(__filename)(find(options.plugins[0]))(text),
  (text, options) => Module._load(find(options.plugins[0]), module)(text),
];
`,
  "node_modules/plugin/package.json": `{ "name": "plugin", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/plugin/index.js": `"use strict";\nmodule.exports = text => text.toUpperCase();\n`,
  "src/own-plugin.cjs": `module.exports = text => text + "!";\n`,
  "src/product.ts": `export const name: string = "product";\n`,
  "tests/tool.test.ts": `import { expect, test } from "bun:test";
import { otherRoads, transform, transformAsync } from "tool";
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
  for (const road of otherRoads) answers.push(await said(() => road("a", { plugins: ["plugin"] })));
  console.log("SAID " + JSON.stringify(answers));
  expect(1).toBe(1);
});
`,
};
const importsTool = `import { transform } from "tool";\nexport const name: string = typeof transform === "function" ? "product" : "";\n`;

const loads = ["product", "A", "A", "a!"];
const refused = ["product", "refused", "refused", "refused"];
/** The last word: the case runs in layers in front of every merge too. The first failed there on the build in front of the cure; the third is about what a layer is told. */
const projects: [string, Record<string, string>, string[], boolean][] = [
  ["a package that only the tests import loads them", files, loads, true],
  ["a package that the product imports too is refused", { ...files, "src/product.ts": importsTool }, refused, false],
  [
    // Its folder makes `src/product.ts` a file of the tests. A second list tells the layer of packages what such files import.
    "a package that the product imports is refused where the test lies beside the product",
    {
      ...files,
      "src/product.ts": importsTool,
      "src/tool.test.ts": files["tests/tool.test.ts"].replace("../src/product", "./product"),
      "tests/tool.test.ts": `import { test } from "bun:test";\ntest("nothing", () => {});\n`,
    },
    refused,
    true,
  ],
  [
    // `src/main.ts` imports the tool and no test loads `src/main.ts`. Every layer reads package.json for itself.
    "a package under dependencies is refused",
    {
      ...files,
      "package.json": `{ "name": "tool-loads-a-plugin", "type": "module", "dependencies": { "tool": "1.0.0" } }`,
    },
    refused,
    false,
  ],
];

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
  // The workers of a parallel run hand on what a test prints with the file's own lines.
  const said = (stdout + "\n" + stderr).split("\n").find(line => line.startsWith("SAID "));
  return { said: said ? JSON.parse(said.slice(5)) : stderr, exitCode };
}

const ways = [["--aot"], ["--aot", "--parallel=2", "--aot-memory-limit=1KB"]];
// A run in layers takes some 30 seconds of a processor, and CI's machines have four: the cases run one behind the other.
for (const [what, project, expected, inLayersToo] of projects) {
  test(what, async () => {
    const [oneProgram, ...others] = await Promise.all(waysFor(ways, inLayersToo).map(flags => saidBy(project, flags)));
    expect({ said: oneProgram.said.slice(0, 4), exitCode: oneProgram.exitCode }).toEqual({
      said: expected,
      exitCode: 0,
    });
    for (const other of others) expect(other).toEqual(oneProgram);
  });
}

test("plain `bun test` loads them wherever the call is written", async () => {
  const { said, exitCode } = await saidBy(projects[1][1], []);
  expect({ said: said.slice(0, 4), exitCode }).toEqual({ said: loads, exitCode: 0 });
});
