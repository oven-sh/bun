import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// `process.exitCode = 3` in a test: where every test passes, `bun test` ends with 3. A run over layers has its test files in worker processes, though nobody asked for any: they run one
// after another, each starts from what the files before it have left, and the run ends as it does in one process. With --parallel a run ends with 0 whatever a test has stored, in plain Bun too.
const passes = (body: string) =>
  `import { expect, test } from "bun:test";\ntest("t", () => { ${body} expect(1).toBe(1); });\n`;
const projects: Record<string, Record<string, string>> = {
  "one file sets it": {
    "a.test.js": passes(""),
    "b.test.js": passes("process.exitCode = 3;"),
    "c.test.js": passes(""),
  },
  "two files set it": {
    "a.test.js": passes("process.exitCode = 3;"),
    "b.test.js": passes(""),
    "c.test.js": passes("process.exitCode = 5;"),
  },
  "a later file sets it back": {
    "a.test.js": passes("process.exitCode = 3;"),
    "b.test.js": passes("process.exitCode = 0;"),
  },
  "a test fails besides": {
    "a.test.js": passes("process.exitCode = 3;"),
    "b.test.js": `import { expect, test } from "bun:test";\ntest("t", () => { expect(1).toBe(2); });\n`,
  },
  "the body of a file sets it": { "a.test.js": "process.exitCode = 4;\n" + passes(""), "b.test.js": passes("") },
  "nothing sets it": { "a.test.js": passes(""), "b.test.js": passes("") },
};
const expected: Record<string, number[]> = {
  "one file sets it": [3, 0],
  "two files set it": [5, 0],
  "a later file sets it back": [0, 0],
  "a test fails besides": [1, 1],
  "the body of a file sets it": [4, 0],
  "nothing sets it": [0, 0],
};

for (const [name, files] of Object.entries(projects)) {
  test.concurrent(`the exit code of a test run: ${name}`, async () => {
    using dir = tempDir("exit-code-left-by-a-test", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "tsconfig.json": "{}",
      ...files,
    });
    const codes = async (env: Record<string, string | undefined>, ...flags: string[]) => {
      const found: number[] = [];
      for (const ways of [["--isolate"], ["--isolate", "--parallel=2"]])
        found.push((await run([bunExe(), "test", ...ways, ...flags], String(dir), env)).exitCode);
      return found;
    };
    expect(await codes(bunEnv)).toEqual(expected[name]);
    expect(await codes(bunEnv, "--aot")).toEqual(expected[name]);
    expect(await codes({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot")).toEqual(
      expected[name],
    );
  });
}
