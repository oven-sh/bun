// What a failure costs: ./test-run-in-parts-failures.test.ts. What code sees: ./test-run-in-parts-what-code-sees.test.ts.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { envOf, files, runTests, twoFiles } from "./harness/test-run-in-parts";
import { test } from "./supported";

test("a test run in parts reads as one run", async () => {
  using dir = tempDir("aot-test-run-in-parts", files);
  const plain = await runTests(String(dir), undefined);
  expect(plain.pass).toBe("6");
  expect(await runTests(String(dir), twoFiles, "--aot")).toEqual(plain);
}, 120_000);

test("under --parallel the parts run at once, with the same report", async () => {
  using dir = tempDir("aot-test-run-in-parts-parallel", files);
  const plain = await runTests(String(dir), undefined, "--parallel=3");
  expect(await runTests(String(dir), twoFiles, "--aot", "--parallel=3")).toEqual(plain);
}, 120_000);

test("with --timings the parts take about as long as one another, and each begins with its slowest file", async () => {
  using dir = tempDir("aot-test-run-in-parts-timings", {
    ...files,
    // No time for c: a file nobody has timed may be slow, so it is dealt first, and it counts as one of the slowest tenth, 5000 ms.
    "timings.json": JSON.stringify({
      version: 1,
      files: { "a.test.ts": 10, "b.test.ts": 20, "d.test.ts": 900, "e.test.ts": 30, "f.test.ts": 5000, "g.test.ts": 1 },
    }),
  });
  const { stderr } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=1", "--timings=timings.json"],
    String(dir),
    envOf(twoFiles),
  );
  // Each file goes to the part that has the least so far: c | f | d | e b a g. A worker runs a part to its end.
  // g imports a file that is not there, and whether its name is printed is not asked here.
  const order = [...stderr.matchAll(/^([a-f])\.test\.ts:$/gm)].map(match => match[1]).join("");
  expect(order).toContain("eba");
  expect(order).toHaveLength(6);
  const plain = await runTests(String(dir), undefined, "--parallel=3");
  expect(await runTests(String(dir), twoFiles, "--aot", "--parallel=3", "--timings=timings.json")).toEqual(plain);
}, 120_000);

test("a JavaScript test file runs beside a tsconfig.json that does not allow JavaScript", async () => {
  using dir = tempDir("aot-test-run-in-parts-javascript", {
    "tsconfig.json": "{}",
    "a.test.js": `import { test } from "bun:test";\ntest("a", () => {});\n`,
    "b.test.js": `import { test } from "bun:test";\ntest("b", () => {});\n`,
    "c.test.ts": `import { test } from "bun:test";\ntest("c", () => {});\n`,
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot"],
    String(dir),
    envOf("TestRunLayers:2,TestRunPartFiles:1"),
  );
  for (const name of ["a", "b", "c"]) expect(stderr).toContain(`(pass) ${name}`);
  expect(exitCode).toBe(0);
}, 120_000);

test("the junit report of a run in parts has every test", async () => {
  using dir = tempDir("aot-test-run-in-parts-junit", files);
  const junit = ["--reporter=junit", "--reporter-outfile=out.xml"];
  await runTests(String(dir), twoFiles, "--aot", ...junit);
  const report = readFileSync(join(String(dir), "out.xml"), "utf8");
  for (const name of ["a", "b", "c", "d", "e", "f", "e fails", "d skipped"]) {
    expect(report).toContain(`name="${name}"`);
  }
}, 120_000);
