import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The build reads code that a test holds as text, because the test may write it to a file and load that. A text that is no code can read like code: in this
// configuration of git, `editor = vi [user]` hands on a member of the test runner's `vi`, so a spy could be anywhere, and every export of every module whose
// namespace object is passed around was read from a variable. What the file is called says nothing: `bun test` runs a file named `config` as code. But code
// runs only where something runs it: a text counts where its test file reaches a load under a path that nobody reads, a Worker, or whatever evaluates text.

const config = "const config = `[core]\n\teditor = vi \\\n[user]\n\tworktree = ${process.env.NOBODY_KNOWS}\n`;";
// Without a substitution the build knows all of it, and so the whole URL that it is put into.
const constant = config.replace("\tworktree = ${process.env.NOBODY_KNOWS}\n", "");
// A hint for the reader. No way of reading it parses, whatever stands for the substitution, and the parser goes on behind its errors.
const unparsed =
  "const config = `In ${process.env.NOBODY_KNOWS} write using spy = spyOn(...) and the spy is put back.`;";
const where = "process.env.WHERE_NOTHING_IS";
type Way = { imports?: string; runs: string; opened: number; text?: string; isOfProduct?: boolean };
// `vi` goes somewhere in the text, so whoever runs it may spy on any export that is handed on and mock any module: the exports of both files of the project are open.
const ways: Record<string, Way> = {
  "nothing can run it": { runs: "", opened: 0 },
  // It loads no code from disk, as in the executable: "Cannot load .. it wasn't compiled with the program".
  "the code under test loads by a path that nobody reads": {
    imports: `import { loadPlugin } from "../src/plugins";`,
    runs: `await loadPlugin(${where});`,
    opened: 0,
  },
  // A text of the code under test is no code of the tests, whatever the test file beside it can run.
  "the code under test holds it, and the test file loads by a path that nobody reads": {
    imports: `import { config } from "../src/texts";`,
    runs: `await import(${where});`,
    opened: 0,
    isOfProduct: true,
  },
  // What a tree that the parser has mended leaves open is the mending's.
  "it does not parse, and the test file loads by a path that nobody reads": {
    runs: `await import(${where});`,
    opened: 0,
    text: unparsed,
  },
  "the test file loads by a path that nobody reads": { runs: `await import(${where});`, opened: 4 },
  "the test file requires by a path that nobody reads": { runs: `require(${where});`, opened: 4 },
  // The export of the helper is one more.
  "a helper of the test file loads": {
    imports: `import { load } from "./loader";`,
    runs: `await load(${where});`,
    opened: 6,
  },
  // Whatever gets the text itself may run it, whether the build knows it for something that does or not.
  "it goes into a URL that holds its own code": {
    runs: `await import("data:text/javascript," + encodeURIComponent(config));`,
    opened: 4,
  },
  "all of it is known, and it goes into such a URL": {
    runs: `await import("data:text/javascript," + encodeURIComponent(config));`,
    opened: 4,
    text: constant,
  },
  "a module object compiles it": {
    imports: `import Module from "node:module";`,
    runs: `new Module("/virtual.cjs")._compile(config, "/virtual.cjs");`,
    opened: 4,
  },
  "it goes to a function that nobody knows": { runs: `(globalThis as any).run(config);`, opened: 8 },
  "the test file evaluates text": { runs: `(0, eval)(${where});`, opened: 4 },
  "the test file makes a function of text": { runs: `new Function(${where})();`, opened: 4 },
  "the test file starts a Worker": { runs: `new Worker(${where});`, opened: 4 },
};

const files = {
  "package.json": `{ "name": "texts-nothing-can-run", "type": "module" }`,
  "src/lib.ts": `export function answer(): string { return "real"; }\nexport function other(): number { return 1; }\n`,
  "src/texts.ts": `export ${config}\n`,
  "src/plugins.ts": `export const loadPlugin = (path: string) => import(path);\n`,
  "test/loader.ts": `export const load = (path: string) => import(path);\n`,
};

const testFile = (imports: string, runs: string, text: string) => `
import { test } from "bun:test";
import * as lib from "../src/lib";
${imports}
const held = { lib };
${text}
test("the text is written nowhere", async () => {
  console.log("TEXT " + held.lib.answer() + " " + held.lib.other() + " " + config.length);
  if (${where}) { ${runs} }
});
`;

async function textsOf(dir: string, flags: string[], words = "TestRunLayers:0") {
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./test/a.test.ts"], dir, env);
  const lines = (stdout + "\n" + stderr).split("\n");
  // Bun's own library is a build of its own, of hundreds of files, and opens what it opens with the text or without.
  const builds = lines.map(line => line.match(/variables that tests may replace (\d+) in (\d+) files/)).filter(Boolean);
  const opened = builds.filter(found => Number(found![2]) < 100);
  return {
    seen: lines.filter(line => line.startsWith("TEXT ")).map(line => line.replace(/\d+$/, "")),
    exitCode,
    opened: opened.reduce((sum, found) => sum + Number(found![1]), 0),
  };
}

test.each(Object.entries(ways))(
  "a text that reads like code: %s",
  async (_, { imports, runs, opened, text, isOfProduct }) => {
    const source = testFile(imports ?? "", runs, isOfProduct ? "" : (text ?? config));
    using dir = tempDir("aot-texts-nothing-can-run", { ...files, "test/a.test.ts": source });
    const [plain, compiled, overLayers] = await Promise.all([
      textsOf(String(dir), []),
      textsOf(String(dir), ["--aot"]),
      textsOf(String(dir), ["--aot"], "TestRunLayers:2"),
    ]);
    expect(plain).toEqual({ seen: ["TEXT real 1 "], exitCode: 0, opened: 0 });
    expect(compiled).toEqual({ ...plain, opened });
    // A layer does not see the test files, so it opens more than one program does where a text counts, and as little where none does.
    expect({ ...overLayers, opened: overLayers.opened > 0 }).toEqual({ ...plain, opened: opened > 0 });
  },
  240_000,
);
