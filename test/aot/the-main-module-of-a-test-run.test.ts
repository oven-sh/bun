import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { runsWholeGrids } from "./harness/ways";
// One by one: a case takes two minutes where Bun has a sanitizer, and beside others it would come near its limit.
import { beforeAll, testOneByOne as test } from "./supported";

const nameOf = `const nameOf = m => (m && m.filename ? require("node:path").basename(m.filename) : String(m));`;
const commonJSTestFile = `${nameOf}
  const { test } = require("bun:test");
  const asks = require("./helpers/asks.cjs");
  const here = nameOf(module);
  const ask = () => [require.main === module, nameOf(require.main), asks.mainObject() === module, ...asks.ask(), ...globalThis.askPreload()].join();
  console.log(here, "at load", ask(), "helper at its load", asks.atLoad);
  test("a CommonJS test file", async () => {
    console.log(here, "in a test", ask(), nameOf(require("node:module").createRequire(__filename).main));
    console.log(here, "an ES module asks", ...(await import("./helpers/asks.mjs")).ask());
    console.log(here, "a file from disk asks", ...require(require("node:path").join(__dirname, "helpers", ["from", "disk"].join("-") + ".cjs")).ask());
    console.log(here, "what the main module exports", require.main.exports.mark, asks.markOfMain());
  });
  exports.mark = "exported by " + here;`;
const files = {
  "package.json": `{ "name": "suite" }`,
  "preload.cjs": `${nameOf}
    console.log("preload.cjs at load", nameOf(require.main), require.main === module);
    globalThis.askPreload = () => [nameOf(require.main), require.main === module];`,
  "helpers/asks.cjs": `${nameOf}
    exports.ask = () => [nameOf(require.main), require.main === module, nameOf(process.mainModule)];
    exports.mainObject = () => require.main;
    exports.markOfMain = () => require.main.exports.mark;
    exports.atLoad = nameOf(require.main);`,
  "helpers/asks.mjs": `const nameOf = m => (m && m.filename ? m.filename.split(/[\\\\/]/).at(-1) : String(m));
    export const ask = () => [nameOf(import.meta.require.main), import.meta.main];`,
  "helpers/from-disk.cjs": `${nameOf}
    exports.ask = () => [nameOf(require.main), require.main === module];`,
  "a.test.cjs": commonJSTestFile,
  "b.test.cjs": commonJSTestFile,
  "evicted.test.cjs": `const { test } = require("bun:test");
    const asks = require("./helpers/asks.cjs");
    test("a test file that takes itself out of the cache", () => {
      console.log("evicted.test.cjs before", typeof require.main, asks.ask()[0]);
      delete require.cache[__filename];
      console.log("evicted.test.cjs after", typeof require.main, asks.ask()[0]);
    });`,
  "c.test.mjs": `import { test } from "bun:test";
    import asks from "./helpers/asks.cjs";
    console.log("c.test.mjs at load", import.meta.main, typeof import.meta.require.main, ...asks.ask(), ...globalThis.askPreload());
    test("a test file that is an ES module", () => {
      console.log("c.test.mjs in a test", import.meta.main, typeof import.meta.require.main, ...asks.ask(), ...globalThis.askPreload());
    });`,
};

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const command = [bunExe(), "test", "--preload", "./preload.cjs", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")), results, exitCode };
}

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof runTests>>;
beforeAll(async () => {
  dir = tempDir("aot-main-module-of-a-test-run", files);
  plain = await runTests(String(dir), {});
});
afterAll(() => dir?.[Symbol.dispose]());

test("require.main is the test file that runs: plain Bun", () => {
  expect(plain.results).toEqual([
    "pass a CommonJS test file",
    "pass a CommonJS test file",
    "pass a test file that is an ES module",
    "pass a test file that takes itself out of the cache",
  ]);
  expect(plain.stdout).toContain("preload.cjs at load undefined false");
  expect(plain.stdout).toContain(
    "b.test.cjs in a test true,b.test.cjs,true,b.test.cjs,false,b.test.cjs,b.test.cjs,false b.test.cjs",
  );
  expect(plain.stdout).toContain(
    "b.test.cjs what the main module exports exported by b.test.cjs exported by b.test.cjs",
  );
  expect(plain.stdout).toContain("c.test.mjs in a test true undefined undefined false undefined undefined false");
  expect(plain.stdout).toContain("evicted.test.cjs before object evicted.test.cjs");
  expect(plain.stdout).toContain("evicted.test.cjs after undefined undefined");
});

const forms: [string, Record<string, string>][] = [
  ["compiled", {}],
  ["test files from disk", { BUN_AOT_TEST_FILES_FROM_DISK: "1" }],
  [
    "test files from disk that name what they use",
    { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" },
  ],
];
// From disk a run costs twice what it costs compiled, so in front of a merge there is one such run.
test.each(forms.slice(0, runsWholeGrids ? 3 : 2))("require.main is the test file that runs: %s", async (_, env) => {
  expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
});

// `require.main` is what the cache holds under the path in `Bun.main`, and `import.meta.main` compares with it, at every read.
test.each([
  { way: "as one program", words: "TestRunLayers:0" },
  { way: "over two layers", words: "TestRunLayers:2,TestRunPartFiles:1" },
])("a test that stores into Bun.main is followed: $way", async ({ words }) => {
  using dir = tempDir("aot-main-module-of-a-test-run", {
    "package.json": `{ "type": "module" }`,
    "preload.cjs": ``,
    "helper.cjs": `exports.me = module;\nexports.isMain = () => require.main === module;\nexports.main = () => require.main;`,
    "a.test.js": `import { expect, test } from "bun:test";
      import helper from "./helper.cjs";
      const name = m => (m && m.filename ? m.filename.split(/[\\\\/]/).at(-1) : String(m));
      test("stores", () => {
        const before = Bun.main;
        console.log("at first", name(helper.main()), helper.isMain(), import.meta.main);
        Reflect.set(Bun, "main", "/nowhere/entry.js");
        console.log("nowhere", Bun.main, name(helper.main()), helper.isMain(), import.meta.main);
        Bun.main = helper.me.filename;
        console.log("helper", name(helper.main()), helper.main() === helper.me, helper.isMain(), import.meta.main);
        Bun.main = before;
        console.log("back", name(helper.main()), helper.isMain(), import.meta.main);
        expect(Bun.main).toBe(before);
      });`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain).toEqual({
    stdout: [
      "at first undefined false true",
      "nowhere /nowhere/entry.js undefined false false",
      "helper helper.cjs true true false",
      "back undefined false true",
    ],
    results: ["pass stores"],
    exitCode: 0,
  });
  expect(await runTests(String(dir), { BUN_DEBUG_TEST_AOT_WORDS: words }, "--aot")).toEqual(plain);
});
