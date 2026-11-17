// How a test run reads: ./test-run-in-parts.test.ts.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { files, passing, runTests } from "./harness/test-run-in-parts";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// Such a file is left to the loader of the run, which throws where it is imported, as under plain `bun test`.
test("a file that is no program fails the test files that import it, and no other", async () => {
  using dir = tempDir("aot-test-run-in-parts-bad-import", {
    ...files,
    "stops.ts": `let same = 1;\nlet same = 2;\nexport const two: number = same;\n`,
    "between.ts": `export { two } from "./stops";\n`,
    "c.test.ts": `import { two } from "./between";\nconsole.log(two);\n${passing("c")}`,
    "g.test.ts": passing("g"),
  });
  const plain = await runTests(String(dir), "--parallel=2");
  expect(plain.results).toContain("pass g");
  expect(plain.results).not.toContain("pass c");
  expect(await runTests(String(dir), "--aot", "--parallel=2")).toEqual(plain);
}, 120_000);

test("where nothing that the test files import is a program, each test file fails by itself", async () => {
  using dir = tempDir("aot-test-run-in-parts-no-good-import", {
    ...files,
    "lib.ts": `let same = 1;\nlet same = 2;\nexport const value: number = same;\n`,
    "g.test.ts": `import { test } from "bun:test";\ntest("g", () => {});\n`,
  });
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass g"]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 120_000);

test("a test file that is no program fails alone", async () => {
  using dir = tempDir("aot-test-run-in-parts-bad", {
    ...files,
    "g.test.ts": `let same = 1;\nlet same = 2;\n${passing("g")}`,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "--preload", "./preload.ts", "--aot"], String(dir));
  expect(stderr).toMatch(/^ *6 pass$/m);
  expect(stderr).toMatch(/^ *2 fail$/m);
  expect(stderr).toContain("g.test.ts");
  expect(exitCode).toBe(1);
}, 120_000);

test("a test file with a syntax error is reported by that error, not as a worker that crashed", async () => {
  using dir = tempDir("aot-test-run-in-parts-syntax-error", {
    ...files,
    "g.test.ts": `import { test, expect } from "bun:test";\ntest("g", () => {\n  expect(1).toBe(1;\n});\n`,
  });
  const junit = ["--reporter=junit", "--reporter-outfile=out.xml"];
  const reportOfRun = async (...flags: string[]) => {
    const { stderr } = await run([bunExe(), "test", "--preload", "./preload.ts", ...flags, ...junit], String(dir));
    return /^error: .*\n +at .*g\.test\.ts:\d+:\d+$/m.exec(stderr)?.[0];
  };
  // Such a file too is left to the loader of the run, which reports the error in the words of plain `bun test`.
  const plain = await reportOfRun();
  expect(plain).toContain('Expected ")" but found ";"');
  expect(await reportOfRun("--aot")).toBe(plain);
  const cases = [...readFileSync(join(String(dir), "out.xml"), "utf8").matchAll(/<testcase name="([^"]*)"/g)];
  expect(cases.map(match => match[1])).not.toContain("(worker crashed)");
}, 120_000);
