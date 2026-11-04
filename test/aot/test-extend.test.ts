import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// The runner chooses the fixtures of a test by the properties that its callback destructures, which it reads out of the text of the callback.
// That every form of callback gets its fixtures: ./fixed-runs/closed/fixtures-for-*.txt. Here are the runs whose tests fail, held to their words.
const refused = `
  import { test, beforeAll } from "bun:test";
  const local = test.extend<{ state: number }>({ state: 5 });
  local("the whole context", context => { console.log("SAID not reached", typeof context); });
  local("a rest property", ({ ...rest }) => { console.log("SAID not reached", typeof rest); });
  local("a list", ([first]: any) => { console.log("SAID not reached", first); });
  try {
    test.extend({ bad: (context: any, use: any) => use(1) });
  } catch (error: any) {
    console.log("SAID", error.message);
  }`;

const ways: [string, string[], string][] = [
  ["plain", [], ""],
  ["as one program", ["--aot"], "TestRunLayers:0"],
];

async function runTests(files: Record<string, string>, flags: string[], words: string) {
  using directory = tempDir("aot-test-extend", { "package.json": `{ "name": "fixtures" }`, ...files });
  const env = { ...bunEnv, NO_COLOR: "1", CI: "false", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(directory), env);
  const lines = (stdout + "\n" + stderr).split("\n");
  return {
    said: lines.filter(line => line.startsWith("SAID ")),
    results: lines
      .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    errors: lines.filter(line => line.startsWith("error: ")),
    exitCode,
  };
}

describe.concurrent("test.extend()", () => {
  test.each(ways)("a callback that does not destructure is refused: %s", async (_, flags, words) => {
    const why = "fixtures are chosen by the properties it destructures";
    expect(await runTests({ "refused.test.ts": refused }, flags, words)).toEqual({
      said: [
        'SAID test.extend(): the first parameter of fixture "bad" must be an object destructuring pattern, received "context"',
      ],
      results: ["(fail) the whole context", "(fail) a rest property", "(fail) a list"],
      errors: [
        `error: test() expects the first parameter of its callback to be an object destructuring pattern, received "context": ${why}`,
        `error: test() expects the first parameter of its callback not to have a rest property: ${why}`,
        `error: test() expects the first parameter of its callback to be an object destructuring pattern: ${why}`,
      ],
      exitCode: 1,
    });
  });

  // No test run is built so. Nothing else shows that a fixture is never left out without a word.
  test("without the text of functions a test with fixtures fails and says why", async () => {
    const file = `
      import { test } from "bun:test";
      test("no fixtures", () => console.log("SAID", String(() => 1)));
      const local = test.extend({ state: 5 });
      local("a fixture", ({ state }) => console.log("SAID not reached", state));`;
    expect(
      await runTests({ "hidden.test.js": file }, ["--aot"], "TestRunLayers:0,TestRunWithoutFunctionSource"),
    ).toEqual({
      said: ["SAID () => { [native code] }"],
      results: ["(pass) no fixtures", "(fail) a fixture"],
      errors: [
        "error: test(): fixtures are chosen by the properties that a callback destructures, and this build holds no function source to read them from (--no-compile-function-source)",
      ],
      exitCode: 1,
    });
  });
});
