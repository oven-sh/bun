import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "./harness/commands";
import { registry } from "./harness/registry";
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

test("with --timings the part that takes longest is built first, and its slowest file starts first", async () => {
  using dir = tempDir("aot-test-run-in-parts-timings", {
    ...files,
    // No time for c: a file nobody has timed may be slow, so it goes in front of d.
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
  // The parts stay cut by path: a b | c d | e f | g.
  const order = [...stderr.matchAll(/^([a-g])\.test\.ts:$/gm)].map(match => match[1]);
  expect(order.filter(name => name !== "g")).toEqual(["f", "e", "c", "d", "b", "a"]);
  const plain = await runTests(String(dir), undefined, "--parallel=3");
  expect(await runTests(String(dir), twoFiles, "--aot", "--parallel=3", "--timings=timings.json")).toEqual(plain);
}, 120_000);

// `sabotage=StoredValuesAreNeverRead` loses values on purpose, and the compiler stops at the read in `leftOf` with an internal error that names the file.
const stopsTheCompiler = {
  ...files,
  "stops.ts": `type Pair = { left: number; right: string };
function leftOf(pair: Pair): number {
  const left = pair.left;
  return left + 1;
}
export const two: number = leftOf({ left: 1, right: "two" });
`,
  "c.test.ts": `import { two } from "./stops";\nconsole.log(two);\n${passing("c")}`,
  "g.test.ts": passing("g"),
};
const hasTheWord = !unsupported && registry().sabotages?.includes("StoredValuesAreNeverRead");

test.skipIf(!hasTheWord).each([
  ["one program", "sabotage=StoredValuesAreNeverRead"],
  ["parts", `sabotage=StoredValuesAreNeverRead,TestRunPartFiles:4`],
])(
  "an internal error of the compiler fails the test files that import the file it names, in %s",
  async (_, words) => {
    using dir = tempDir("aot-test-run-internal-error", stopsTheCompiler);
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      envOf(words),
    );
    expect(stderr).toMatch(
      /internal compiler error \(AnalyzeFlow\): OperationWithoutValue: .* in function 'leftOf' at .*stops\.ts:3:/,
    );
    expect(stderr).toContain("bun test --aot does not run this file");
    // The part is not cut in halves to look for the file: the error has named it.
    expect(stderr).not.toContain("could not be compiled");
    for (const name of ["a", "b", "d", "e", "f", "g"]) expect(stderr).toContain(`(pass) ${name}`);
    expect(stderr).not.toContain("(pass) c");
    expect(exitCode).toBe(1);
  },
  120_000,
);

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
