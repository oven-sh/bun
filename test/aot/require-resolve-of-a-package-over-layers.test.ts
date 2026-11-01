import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A package names one file for require() and another for an import. Over layers a test file leaves the name of a package to the loader, which took the file
// for an import: `require.resolve("dep")` named the wrong one, so `require.cache[require.resolve("dep")]` was empty and the `delete` took the wrong file out.
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }
`,
  "tsconfig.json": `{}
`,
  "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js", "module": "index.mjs", "exports": { ".": [{ "import": "./index.mjs", "require": "./index.js", "default": "./index.js" }, "./index.js"], "./package.json": "./package.json" } }
`,
  "node_modules/dep/index.js": `globalThis.loadsOfDep = (globalThis.loadsOfDep ?? 0) + 1;
module.exports = { parse(text) { return text.length; }, load: globalThis.loadsOfDep };
`,
  "node_modules/dep/index.mjs": `export function parse(text) {
  return -text.length;
}
`,
  "src/other.js": `import { parse } from "dep";
export const byImport = text => parse(text);
`,
  "src/uses.js": `// The package is asked for when the function is called.
export function full(text) {
  const dep = require("dep");
  return dep.parse(text) + ":" + dep.load;
}
export function seenFromHere() {
  return require.cache[require.resolve("dep")] !== undefined;
}
`,
  "a.test.js": `import { expect, test } from "bun:test";
import { byImport } from "./src/other.js";
import { full, seenFromHere } from "./src/uses.js";

function loaded() {
  return require.cache[require.resolve("dep")] !== undefined;
}
const say = what => console.log("SEEN " + what + " | here " + loaded() + " | there " + seenFromHere() + " | listed " + Object.keys(require.cache).some(key => key.includes("dep")) + " | in " + (require.resolve("dep") in require.cache));

test("a package that another file loads is in require.cache", () => {
  console.log("SEEN resolved " + require.resolve("dep").split("/").pop() + " | by import.meta " + import.meta.resolve("dep").split("/").pop() + " | by import " + byImport("ab"));
  say("at first");
  console.log("SEEN full " + full("abc"));
  say("behind a load elsewhere");
  delete require.cache[require.resolve("dep")];
  say("behind the delete");
  console.log("SEEN full " + full("abcd"));
  say("behind a second load elsewhere");
  delete require.cache[require.resolve("dep")];
  console.log("SEEN mine " + require("dep").load);
  say("behind a load here");
  console.log("SEEN full " + full("abcde"));
  expect(1).toBe(1);
});
`,
  "b.test.js": `import { expect, test } from "bun:test";
test("another file, so that the run has pieces", () => expect(1).toBe(1));
`,
};

async function seenIn(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

test("require.resolve() of a package goes by the file that the package names for require()", async () => {
  using dir = tempDir("aot-require-resolve-over-layers", files);
  const plain = await seenIn(String(dir), undefined);
  expect(plain).toEqual({
    seen: [
      "SEEN resolved index.js | by import.meta index.mjs | by import -2",
      "SEEN at first | here false | there false | listed true | in false",
      "SEEN full 3:1",
      "SEEN behind a load elsewhere | here true | there true | listed true | in true",
      "SEEN behind the delete | here false | there false | listed true | in false",
      "SEEN full 4:2",
      "SEEN behind a second load elsewhere | here true | there true | listed true | in true",
      "SEEN mine 3",
      "SEEN behind a load here | here true | there true | listed true | in true",
      "SEEN full 5:3",
    ],
    exitCode: 0,
  });
  expect(await seenIn(String(dir), "TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:1,TestRunPartFiles:1", "--aot")).toEqual(plain);
  expect(await seenIn(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
}, 180_000);
