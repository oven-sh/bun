import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The build reads code that a test holds as text, because the test may write it to a file and load that. A text that is no code can read like code: in this
// configuration of git, `editor = vi [user]` hands on a member of the test runner's `vi`, so a spy could be anywhere, and every export of every module whose
// namespace object is passed around was read from a variable. What the file is called says nothing: `bun test` runs a file named `config` as code. But code
// runs only where something runs it: a text counts where its test file reaches a load under a path that nobody reads, a Worker, or whatever evaluates text.
// Which texts count is asked of the look through the test files itself: a_text_that_reads_like_code_counts_where_its_test_file_can_run_it() in src/aot/load/look_tests.rs.
// Here: the build goes by that answer.

const config = "const config = `[core]\n\teditor = vi \\\n[user]\n\tworktree = ${process.env.NOBODY_KNOWS}\n`;";
const where = "process.env.WHERE_NOTHING_IS";
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
    builds: opened.length,
    opened: opened.reduce((sum, found) => sum + Number(found![1]), 0),
  };
}

test("a text that reads like code and that nothing can run opens no export", async () => {
  using dir = tempDir("aot-texts-nothing-can-run", { ...files, "test/a.test.ts": testFile("", "", config) });
  const [plain, compiled] = await Promise.all([textsOf(String(dir), []), textsOf(String(dir), ["--aot"])]);
  expect(plain).toEqual({ seen: ["TEXT real 1 "], exitCode: 0, builds: 0, opened: 0 });
  expect(compiled.builds).toBeGreaterThan(0);
  expect({ ...compiled, builds: 0 }).toEqual(plain);
}, 240_000);
