import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const texts = {
  "an empty file": "",
  "a file that only prints": `console.log("SAID", 1);\n`,
  "a file that does not parse": "!!!\n",
};

test.each(Object.entries(texts))("a run whose files call no code of the library: %s", async (_, text) => {
  using directory = tempDir("runs-without-tests", { "package.json": `{ "name": "p" }`, "a.test.js": text });
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" };
  const runs = [[], ["--aot"]].map(flags => run([bunExe(), "test", ...flags], String(directory), env));
  const [plain, compiled] = (await Promise.all(runs)).map(({ stdout, stderr, exitCode }) => ({
    said: stdout.split("\n").filter(line => line.startsWith("SAID ")),
    errors: stderr.split("\n").filter(line => line.startsWith("error: ")),
    counts: stderr.split("\n").filter(line => /^ \d+ (pass|fail|error)/.test(line)),
    exitCode,
  }));
  expect(compiled).toEqual(plain);
  expect(plain.counts).toContain(" 0 pass");
});
