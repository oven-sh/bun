// What a failure costs: ./test-run-in-parts-failures.test.ts. What code sees: ./test-run-in-parts-what-code-sees.test.ts.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { files, runTests } from "./harness/test-run-in-parts";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

test("a compiled test run reads as a plain one, and its junit report has every test, at its line in the test file", async () => {
  using dir = tempDir("aot-test-run-in-parts", {
    ...files,
    "register.ts": `import { test } from "bun:test";\n\nexport function register(name: string) {\n  test(name, () => {});\n}\n`,
    "h.test.ts": `import { register } from "./register";\nregister("h");\n`,
  });
  const plain = await runTests(String(dir));
  expect(plain.pass).toBe("7");
  expect(await runTests(String(dir), "--aot", "--reporter=junit", "--reporter-outfile=out.xml")).toEqual(plain);
  const report = readFileSync(join(String(dir), "out.xml"), "utf8");
  for (const name of ["a", "b", "c", "d", "e", "f", "e fails", "d skipped"]) {
    expect(report).toContain(`name="${name}"`);
  }
  // `passing()` calls test() on its third line. Another module calls it for "h", from the second line of h.test.ts.
  const line = (name: string) => report.match(new RegExp(`<testcase name="${name}"[^>]* line="(\\d+)"`))?.[1];
  expect({ a: line("a"), h: line("h") }).toEqual({ a: "3", h: "2" });
}, 120_000);

test("a JavaScript test file runs beside a tsconfig.json that does not allow JavaScript", async () => {
  using dir = tempDir("aot-test-run-in-parts-javascript", {
    "tsconfig.json": "{}",
    "a.test.js": `import { test } from "bun:test";\ntest("a", () => {});\n`,
    "b.test.js": `import { test } from "bun:test";\ntest("b", () => {});\n`,
    "c.test.ts": `import { test } from "bun:test";\ntest("c", () => {});\n`,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir));
  for (const name of ["a", "b", "c"]) expect(stderr).toContain(`(pass) ${name}`);
  expect(exitCode).toBe(0);
}, 120_000);
