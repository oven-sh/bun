import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

const project = {
  "package.json": `{}`,
  "tsconfig.json": `{}`,
  "src/shared.cjs": `
    exports.load = () => require("bun:sqlite");`,
  "listed.test.js": `import { test } from "bun:test";
    import * as jsc from "bun:jsc";
    const names = ["bun:jsc", "bun:sqlite", "bun:test", "node:fs", "undici", "ws"];
    const listed = () => Object.keys(require.cache).filter(key => names.includes(key)).join() || "none";
    test("require() lists a built-in module", () => {
      const { load } = require("./src/shared.cjs");
      console.log("SEEN at first:", typeof jsc.heapSize, listed(), "bun:sqlite" in require.cache);
      require("ws");
      const sqlite = load();
      require("node:fs");
      console.log("SEEN required:", listed(), "bun:sqlite" in require.cache, "bun:jsc" in require.cache);
      process.getBuiltinModule("undici");
      console.log("SEEN getBuiltinModule:", listed());
      delete require.cache["bun:sqlite"];
      console.log("SEEN deleted:", listed(), "bun:sqlite" in require.cache);
      console.log("SEEN again:", load() === sqlite, listed());
      const entry = require.cache["bun:sqlite"];
      console.log("SEEN entry:", entry.id, entry.loaded, entry.exports === sqlite, entry.children.length);
      entry.exports = { fake: "stored" };
      console.log("SEEN stored:", load().fake, require("bun:sqlite").fake);
    });`,
  "next.test.js": `import { test } from "bun:test";
    test("the next file starts without them", () => {
      console.log("SEEN next:", "bun:sqlite" in require.cache, "ws" in require.cache);
      console.log("SEEN next:", typeof require("bun:sqlite").Database, "bun:sqlite" in require.cache);
    });`,
};

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
}

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof runTests>>;
beforeAll(async () => {
  dir = tempDir("aot-require-lists-a-built-in-module", project);
  plain = await runTests(String(dir), "");
});
afterAll(() => dir?.[Symbol.dispose]());

test("require() lists a built-in module in require.cache under plain Bun", () => {
  expect(plain.seen).toContain("SEEN required: ws,bun:sqlite true false");
  expect(plain.seen).toContain("SEEN stored: stored stored");
});

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("require() lists a built-in module in require.cache in a test run, %s", async (_, words) => {
  expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
});
