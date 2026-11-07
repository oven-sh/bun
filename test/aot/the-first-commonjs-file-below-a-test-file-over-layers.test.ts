import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun run` and `bun test` give the id "." and the parent null to the first CommonJS file that the loader of ES modules finds below the
// entry point: level by level, and in a level in the order of the text. `bun test --aot` in layers: the graph below a test file goes
// through several programs, the packages lowest. The search goes through all of them, and one file of the realm is found.
const says = `exports.say = () => [module.id === "." ? "." : "its path", module.parent === null ? "null" : typeof module.parent].join(" ");`;
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "node_modules/old/package.json": `{ "name": "old", "version": "1.0.0", "main": "./index.js" }`,
  "node_modules/old/index.js": says,
  "node_modules/new-over-old/package.json": `{ "name": "new-over-old", "version": "1.0.0", "main": "./index.js", "type": "module" }`,
  "node_modules/new-over-old/index.js": `import old from "old";\nexport const ofPackage = () => old.say();`,
  "node_modules/new/package.json": `{ "name": "new", "version": "1.0.0", "main": "./index.js", "type": "module" }`,
  "node_modules/new/index.js": `export const nothing = 0;`,
  "src/own.cjs": says,
  "src/over-own.ts": `import own from "./own.cjs";\nexport const ofProject = () => own.say();`,
  "src/plain.ts": `export const nothing = 0;`,
  // One CommonJS file stands in the graph of each test file: which of two the loader of plain Bun comes to first hangs on the clock.
  "beside.test.ts": `import { test } from "bun:test";
    import { nothing } from "./src/plain";
    import { nothing as too } from "new";
    import old from "old";
    test("a package beside ES modules of the project and of a package", async () => {
      console.log("beside: old", old.say(), "| own, imported later", (await import("./src/over-own")).ofProject(), nothing + too);
    });`,
  "below-a-package.test.ts": `import { test } from "bun:test";
    import { nothing } from "./src/plain";
    import { ofPackage } from "new-over-old";
    test("a package below a package", () => {
      console.log("below a package: old", ofPackage(), "| own, required later", require("./src/own.cjs").say(), nothing);
    });`,
  "below-the-project.test.ts": `import { test } from "bun:test";
    import { nothing } from "new";
    import { ofProject } from "./src/over-own";
    test("a file of the project below a file of the project", () => {
      console.log("below the project: own", ofProject(), "| old, required later", require("old").say(), nothing);
    });`,
  "required.test.ts": `import { test } from "bun:test";
    import { nothing } from "new";
    test("nothing below the test file, and a require()", async () => {
      console.log("required: old", require("old").say(), "| own, imported later", (await import("./src/over-own")).ofProject(), nothing);
    });`,
};
// A run of a few test files is one program.
for (let i = 0; i < 16; i++)
  files[`more-${i}.test.js`] = `import { test } from "bun:test";\ntest("one of many, ${i}", () => {});`;

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { stdout: printed.sort(), results: results.sort(), exitCode };
}

test("one file of the realm is the first, whichever program holds it", async () => {
  using dir = tempDir("aot-the-first-commonjs-file", files);
  const plain = await runTests(String(dir), "");
  expect(plain.results.length).toBe(20);
  expect(plain.stdout).toEqual([
    "below a package: old . null | own, required later its path object 0",
    "below the project: own . null | old, required later its path object 0",
    "beside: old . null | own, imported later its path undefined 0",
    "required: old its path object | own, imported later its path undefined 0",
  ]);
  expect(await runTests(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await runTests(String(dir), "TestRunLayers:2", "--aot")).toEqual(plain);
  expect(await runTests(String(dir), "TestRunLayers:3", "--aot")).toEqual(plain);
}, 240_000);
