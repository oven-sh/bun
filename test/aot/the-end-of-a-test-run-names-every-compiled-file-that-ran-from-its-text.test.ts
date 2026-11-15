import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const lib = `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.n = globalThis.runs;\n`;
const head = `const { test } = require("bun:test");\nconst { writeFileSync } = require("node:fs");\n`;
const runs = {
  "a file that is taken out of require.cache and required again": {
    test: `${head}test("a", () => {
  require("./lib.cjs");
  delete require.cache[require.resolve("./lib.cjs")];
  console.log("SAID", require("./lib.cjs").n);
});`,
    said: "SAID 2",
    named: ["lib.cjs"],
  },
  "a file that is written over in front of its first load": {
    test: `${head}test("a", () => {
  writeFileSync(__dirname + "/lib.cjs", "exports.n = 7;");
  console.log("SAID", require("./lib.cjs").n);
});`,
    said: "SAID 7",
    named: ["lib.cjs"],
  },
  "a file that does not parse, which the build never compiled": {
    test: `${head}test("a", () => {
  let name = "none";
  try {
    require("./bad.cjs");
  } catch (error) {
    name = error.name;
  }
  console.log("SAID", name);
});`,
    said: "SAID BuildMessage",
    named: [],
  },
  "a file that loads once": {
    test: `${head}test("a", () => {
  console.log("SAID", require("./lib.cjs").n);
});`,
    said: "SAID 1",
    named: [],
  },
};

test.each(Object.entries(runs))("%s", async (_, { test, said, named }) => {
  using directory = tempDir("files-that-ran-from-their-text", {
    "package.json": `{ "name": "made-up" }`,
    "lib.cjs": lib,
    "bad.cjs": "!!!",
    "a.test.cjs": test,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), bunEnv);
  const lines = (stdout + "\n" + stderr).split("\n");
  expect(lines.filter(line => line.startsWith("SAID "))).toEqual([said]);
  expect(lines.filter(line => line.endsWith(", while a.test.cjs ran")).map(line => line.trim().split(":")[0])).toEqual(
    named,
  );
  expect(lines.some(line => line.includes("ran from source"))).toBe(named.length > 0);
});
