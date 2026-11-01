import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// The runner chooses the fixtures of a test by the properties that its callback destructures, which it reads out of the text of the callback.
const forms = (module: string) => `
  import { test } from "${module}";
  type Fixtures = { state: number; made: string; lazy: string };
  const log: string[] = [];
  const local = test.extend<Fixtures>({
    state: 5,
    made: async ({ state }, use) => { log.push("set up made"); await use("made of " + state); log.push("tear down made"); },
    lazy: async ({}, use) => { log.push("set up lazy"); await use("lazy"); },
  });
  const said = (...values: unknown[]) => console.log("SAID", ...values);
  class Holder {
    #own = "own";
    method({ state }: Fixtures) { said("a method", state); }
    async later({ made }: Fixtures) { await 0; said("an async method", made); }
    arrow() { return ({ state }: Fixtures) => said("an arrow that reads a private name", state, this.#own); }
  }
  const holder = new Holder();
  const literal = { method({ state }: Fixtures) { said("a method of a literal", state); }, ["computed" + 1]({ state }: Fixtures) { said("a computed name", state); } };
  local("a value", ({ state }) => said(state));
  local("made by a function", ({ made }) => said(made));
  local("renamed, with a default", ({ state: s, made: m = "none" }) => said(s, m));
  local("a function expression", function ({ state }) { said(state); });
  local("a named async function", async function named({ state }) { await 0; said(state); });
  local("an async arrow", async ({ state }) => { await 0; said(state); });
  local("a typed parameter", ({ state }: { state: number }): void => said(state));
  local("a type by name, and a cast in the body", ({ state }: Fixtures) => said((state as number)!.toFixed(1)));
  local("a comment before the parameter", (/* ( */ { state } /* ) */) => said(state));
  local("a quoted key and a number", ({ "state": quoted, 0: none }: any) => said(quoted, none));
  local("a method", holder.method);
  local("an async method", holder.later);
  local("an arrow in a method", holder.arrow());
  local("a method of a literal", literal.method);
  local("a computed name", (literal as any).computed1);
  local("nothing asked", () => said(log.join()));
  const more = local.extend<{ extra: string }>({ extra: ({ made }, use) => use(made + " and more") });
  more("extended again", ({ extra, state }) => said(extra, state));
  local.each([[1], [2]])("each %i", n => said("each", n));
  local.for([[1, 2]])("for %i %i", ([a, b], { state }) => said("for", a, b, state));
  test("the log", () => said(log.join()));`;

const jsx = `
  import { test } from "bun:test";
  const local = test.extend<{ state: number }>({ state: 5 });
  const h = (tag: string, props: object | null, ...children: unknown[]) => tag + JSON.stringify(props) + children.join();
  local("an element in the body", ({ state }) => console.log("SAID", <p title="t">{state}</p>));`;

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
  ["over two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
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

describe.concurrent.each(["bun:test", "vitest"])("from %s", module => {
  const expected = [
    "SAID 5",
    "SAID made of 5",
    "SAID 5 made of 5",
    "SAID 5",
    "SAID 5",
    "SAID 5",
    "SAID 5",
    "SAID 5.0",
    "SAID 5",
    "SAID 5 undefined",
    "SAID a method 5",
    "SAID an async method made of 5",
    "SAID an arrow that reads a private name 5 own",
    "SAID a method of a literal 5",
    "SAID a computed name 5",
    "SAID set up made,tear down made,set up made,tear down made,set up made,tear down made",
    "SAID made of 5 and more 5",
    "SAID each 1",
    "SAID each 2",
    "SAID for 1 2 5",
    "SAID set up made,tear down made,set up made,tear down made,set up made,tear down made,set up made,tear down made",
  ];
  test.each(ways)("every form of callback gets its fixtures: %s", async (_, flags, words) => {
    const { said, results, exitCode } = await runTests({ "forms.test.ts": forms(module) }, flags, words);
    expect(said).toEqual(expected);
    expect({ failed: results.filter(line => !line.startsWith("(pass)")), exitCode }).toEqual({
      failed: [],
      exitCode: 0,
    });
  });
});

describe.concurrent("test.extend()", () => {
  test.each(ways)("a body with JSX: %s", async (_, flags, words) => {
    const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "h" } });
    const { said, exitCode } = await runTests({ "jsx.test.tsx": jsx, "tsconfig.json": tsconfig }, flags, words);
    expect({ said, exitCode }).toEqual({ said: ['SAID p{"title":"t"}5'], exitCode: 0 });
  });

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
