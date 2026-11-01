import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Over layers, several test files in one process. The third test file failed to load: `TypeError: The module "pair/b" is not loaded`.
// 1. "pair/b" runs inside the layer of the packages, below "pair/a": the loader never hears of it.
// 2. A require() comes to a module whose fetch is still under way, so the loader fetches it at once. For that fetch every image of the realm asks the host, and each goes back to what it was.
//    They all went back to what any one of them was: the layer of the packages went on asking the host for good.
// 3. What an image hands the loader while it asks the host is let go again once it has run. "pair/b" had run, so the require() of an ES module in the middle of the third file's load let it go,
//    and the file's link did not find it.
const files: Record<string, string> = {
  "package.json": `{ "name": "record-retired-mid-load", "type": "module" }`,
  "tsconfig.json": "{}",
  "node_modules/pair/package.json": `{ "name": "pair", "type": "module", "exports": { "./a": "./a.mjs", "./b": "./b.mjs" } }`,
  "node_modules/pair/a.mjs": `import { base } from "pair/b"; export const a = base() + 1;`,
  "node_modules/pair/b.mjs": `export function base() { return 1; }`,
  "node_modules/leaf/package.json": `{ "name": "leaf", "type": "module", "main": "./index.js" }`,
  "node_modules/leaf/index.js": `export const leaf = 9;`,
  "node_modules/tool/package.json": `{ "name": "tool", "main": "./index.js" }`,
  "node_modules/tool/index.js": `const { leaf } = require("leaf"); module.exports = { tool: () => leaf };`,
  "src/state.ts": `import { a } from "pair/a"; export const state = a;`,

  "tests/helpers/root.ts": `import "./imports.cjs"; import { a } from "./a.ts"; export const root = a;`,
  // While the text of an import() is on its way, so is the text of whatever is asked for meanwhile.
  "tests/helpers/imports.cjs": `globalThis.imported = import("./imported.ts"); module.exports = 0;`,
  "tests/helpers/imported.ts": `export const imported = 1;`,
  "tests/helpers/a.ts": `import x from "./requires.cjs"; import { shared } from "./shared.ts"; export const a = shared + x;`,
  "tests/helpers/requires.cjs": `const { x } = require("./x.ts"); module.exports = x;`,
  "tests/helpers/x.ts": `import { shared } from "./shared.ts"; export const x = shared + 1;`,
  "tests/helpers/shared.ts": `export const shared = 5;`,
  "tests/helpers/tool.ts": `import tool from "tool"; export const nine = () => tool.tool();`,

  "tests/a.test.ts": `import { expect, test } from "bun:test";
import { state } from "../src/state";
test("runs pair/b below pair/a", () => { expect(state).toBe(2); });
`,
  "tests/b.test.ts": `import { expect, test } from "bun:test";
import { root } from "./helpers/root";
test("requires what is being fetched", async () => {
  expect(root).toBe(11);
  expect((await (globalThis as any).imported).imported).toBe(1);
});
`,
  "tests/c.test.ts": `import { expect, spyOn, test } from "bun:test";
import * as pair from "pair/b";
import { nine } from "./helpers/tool";
test("imports pair/b", () => {
  const spy = spyOn(pair, "base").mockImplementation(() => 7);
  expect(pair.base()).toBe(7);
  spy.mockRestore();
  expect(pair.base() + nine()).toBe(10);
});
`,
};

test("a module that ran inside a layer below is found by a test file that imports it", async () => {
  using dir = tempDir("aot-record-retired-mid-load", files);
  const directory = String(dir);
  const summary = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    // In this order, however the folder lists them.
    const inOrder = ["./tests/a.test.ts", "./tests/b.test.ts", "./tests/c.test.ts"];
    const ran = await run([bunExe(), "test", ...flags, "--no-isolate", ...inOrder], directory, env);
    return ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail|error)s?$|is not loaded/.test(line));
  };
  const plain = await summary([], "");
  expect(plain).toEqual([" 3 pass", " 0 fail"]);
  expect(await summary(["--aot"], "TestRunLayers:2")).toEqual(plain);
  expect(await summary(["--aot"], "TestRunLayers:3")).toEqual(plain);
}, 240_000);
