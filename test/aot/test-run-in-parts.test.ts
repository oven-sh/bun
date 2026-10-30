import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const passing = (name: string, seen = "lib") => `import { test, expect } from "bun:test";
import { value } from "./lib";
test("${name}", () => {
  expect(value + (globalThis as any).fromPreload).toBe(3);
  console.log("${name} ran with ${seen}");
});
`;
const files: Record<string, string> = {
  "lib.ts": `export const value: number = 1;`,
  "preload.ts": `(globalThis as any).fromPreload = 2;`,
  "a.test.ts": passing("a"),
  "b.test.ts": passing("b"),
  "c.test.ts": passing("c"),
  "d.test.ts": passing("d") + `test.skip("d skipped", () => {});\n`,
  "e.test.ts": passing("e") + `test("e fails", () => { expect(1).toBe(2); });\n`,
  "f.test.ts": passing("f"),
  "g.test.ts": `import { nothing } from "./no-such-file";\nconsole.log(nothing);\n${passing("g")}`,
};

const twoFiles = "TestRunPartFiles:2";
const envOf = (words?: string) => (words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv);

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", ...flags],
    directory,
    envOf(words),
  );
  const results = [...stderr.matchAll(/^\((pass|fail|skip)\) (.*?)(?: \[.*\])?$/gm)].map(
    match => `${match[1]} ${match[2]}`,
  );
  const count = (word: string) => stderr.match(new RegExp(`^ *(\\d+) ${word}$`, "m"))?.[1];
  return {
    stdout: stdout
      .split("\n")
      .filter(line => line.includes(" ran with ") || line.startsWith("error"))
      .sort(),
    results: results.sort(),
    ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
    pass: count("pass"),
    skip: count("skip"),
    fail: count("fail"),
    exitCode,
  };
}

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

test("a run whose source is past the limit is split, down to one file a part", async () => {
  using dir = tempDir("aot-test-run-in-parts-source", files);
  const plain = await runTests(String(dir), undefined);
  expect(await runTests(String(dir), "TestRunPartSourceBytes:1", "--aot")).toEqual(plain);
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

test("a part that cannot build fails only the file that cannot", async () => {
  using dir = tempDir("aot-test-run-in-parts-bad", {
    ...files,
    "g.test.ts": `let same = 1;\nlet same = 2;\n${passing("g")}`,
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", "--aot"],
    String(dir),
    envOf(twoFiles),
  );
  expect(stderr).toMatch(/^ *6 pass$/m);
  expect(stderr).toMatch(/^ *2 fail$/m);
  expect(stderr).toContain("g.test.ts");
  expect(exitCode).toBe(1);
}, 120_000);
