import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// The runner chooses the fixtures of a test by the properties that its callback destructures, which it reads out of the text of the callback.
// That a callback gets its fixtures: ./fixed-runs/closed/fixtures-for-a-callback-with-jsx.txt. Here are the runs whose tests fail, held to their words.
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

  // Vitest reads the parameters from what toString() returns, which a wrapper sets to the text of the function it wraps.
  const wrapped = `
    import { test } from "bun:test";
    const wrap = (inner: (...args: any[]) => unknown) =>
      Object.defineProperty((...args: unknown[]) => inner(...args), "toString", { value: () => inner.toString() });
    const local = test.extend<{ state: number }>({ state: 5 });
    local.beforeEach(wrap(({ state }) => console.log("SAID beforeEach", state)));
    local("a wrapper", wrap(({ state }) => {
      console.log("SAID test", state); // --aot keeps this comment in the text: [native code]
    }));`;

  test.each(ways)("a callback with its own toString() is read from what that returns: %s", async (_, flags, words) => {
    expect(await runTests({ "wrapped.test.ts": wrapped }, flags, words)).toEqual({
      said: ["SAID beforeEach 5", "SAID test 5"],
      results: ["(pass) a wrapper"],
      errors: [],
      exitCode: 0,
    });
  });

  test("without the text of functions a wrapper with its own toString() fails and says why", async () => {
    expect(
      await runTests({ "wrapped.test.ts": wrapped }, ["--aot", "--no-compile-function-source"], "TestRunLayers:0"),
    ).toEqual({
      said: [],
      results: ["(fail) a wrapper"],
      // Of beforeEach, which runs first.
      errors: [
        "error: fixtures are chosen by the properties that a callback destructures, and this build holds no function source to read them from (--no-compile-function-source)",
      ],
      exitCode: 1,
    });
  });

  test("without the text of functions a toString() is refused only if it returns native code", async () => {
    const file = `
      import { test } from "bun:test";
      const local = test.extend({ state: 5 });
      // A wrapper from new Function, as one from a package, is not in the files of the tests.
      const wrap = new Function("inner", "return Object.defineProperty((...args) => inner(...args), 'toString', { value: () => inner.toString() })");
      local("the text of a function", wrap(({ state }) => console.log("SAID not reached", state)));
      const written = Object.defineProperty((...args) => console.log("SAID", args[0].state), "toString", { value: () => "{ Spy }\\n({ state }) => {}" });
      local("a text that the wrapper wrote", written);`;
    expect(
      await runTests({ "texts.test.js": file }, ["--aot", "--no-compile-function-source"], "TestRunLayers:0"),
    ).toEqual({
      said: ["SAID 5"],
      results: ["(fail) the text of a function", "(pass) a text that the wrapper wrote"],
      errors: [
        "error: test(): fixtures are chosen by the properties that a callback destructures, and this build holds no function source to read them from (--no-compile-function-source)",
      ],
      exitCode: 1,
    });
  });

  test("without the text of functions a test with fixtures fails and says why", async () => {
    const file = `
      import { test } from "bun:test";
      test("no fixtures", () => console.log("SAID", String(() => 1)));
      const local = test.extend({ state: 5 });
      local("a fixture", ({ state }) => console.log("SAID not reached", state));`;
    expect(
      await runTests({ "hidden.test.js": file }, ["--aot", "--no-compile-function-source"], "TestRunLayers:0"),
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
