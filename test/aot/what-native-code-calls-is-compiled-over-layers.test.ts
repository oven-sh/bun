import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

async function ran(touches: string, flags: string[], words = "") {
  using dir = tempDir("aot-what-native-code-calls", {
    "package.json": `{ "name": "p" }`,
    "a.test.js": `const { test } = require("bun:test");
test("first", () => {
  const got = ${touches};
  console.log("SEEN", typeof got);
});
`,
    "b.test.js": `const { test } = require("bun:test");
test("second", () => {
  console.log("SEEN");
});
`,
  });
  const cwd = String(dir);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], cwd, {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: words,
    [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
  });
  return {
    seen: (stdout + stderr).split("\n").filter(line => line.startsWith("SEEN")),
    exitCode,
    functionsInterpreted: readdirSync(cwd)
      .filter(name => name.startsWith("counts-"))
      .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
      .filter(line => line.endsWith("\tcounter:InterpretedFunctionCode"))
      .reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  };
}

test.each([
  `require.cache`,
  `delete require.cache["bun:sqlite"]`,
  `require("node:module")._cache`,
  `console.Console`,
  `Bun.peek(Promise.resolve(1))`,
  `Bun.$`,
])("%s", async touches => {
  const { seen } = await ran(touches, []);
  expect(seen).toHaveLength(2);
  const compiled = { seen, exitCode: 0, functionsInterpreted: 0 };
  expect(await ran(touches, ["--aot"], "TestRunLayers:2")).toEqual(compiled);
  expect(await ran(touches, ["--aot"], "TestRunLayers:0")).toEqual(compiled);
});
