import { spawnSync } from "bun";
import { beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

let testEnv: NodeJS.Dict<string>;

beforeAll(() => {
  testEnv = { ...bunEnv };
  delete testEnv.AGENT;
});

test("CLAUDECODE=1 shows quiet test output (only failures)", async () => {
  await using dir = tempDir("claudecode-test-quiet", {
    "test2.test.js": `
      import { test, expect } from "bun:test";

      test("passing test", () => {
        expect(1).toBe(1);
      });

      test("failing test", () => {
        expect(1).toBe(2);
      });

      test.skip("skipped test", () => {
        expect(1).toBe(1);
      });

      test.todo("todo test");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test2.test.js"],
    env: { ...testEnv, CLAUDECODE: "1" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

  const output = stderr + stdout;
  const normalized = normalizeBunSnapshot(output, dir);

  expect(normalized).toMatchSnapshot();
});

test("CLAUDECODE=1 vs CLAUDECODE=0 comparison", async () => {
  await using dir = tempDir("claudecode-test-compare", {
    "test3.test.js": `
      import { test, expect } from "bun:test";

      test("passing test", () => {
        expect(1).toBe(1);
      });

      test("another passing test", () => {
        expect(2).toBe(2);
      });

      test.skip("skipped test", () => {
        expect(1).toBe(1);
      });

      test.todo("todo test");
    `,
  });

  // Run with CLAUDECODE=0 (normal output)
  const result1 = spawnSync({
    cmd: [bunExe(), "test", "test3.test.js"],
    env: { ...testEnv, CLAUDECODE: "0" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Run with CLAUDECODE=1 (quiet output)
  const result2 = spawnSync({
    cmd: [bunExe(), "test", "test3.test.js"],
    env: { ...testEnv, CLAUDECODE: "1" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const normalOutput = result1.stderr.toString() + result1.stdout.toString();
  const quietOutput = result2.stderr.toString() + result2.stdout.toString();

  // Normal output should contain pass/skip/todo indicators
  expect(normalOutput).toContain("(pass)"); // pass indicator
  expect(normalOutput).toContain("(skip)"); // skip indicator
  expect(normalOutput).toContain("(todo)"); // todo indicator

  // Quiet output should NOT contain pass/skip/todo indicators (only failures)
  expect(quietOutput).not.toContain("(pass)"); // pass indicator
  expect(quietOutput).not.toContain("(skip)"); // skip indicator
  expect(quietOutput).not.toContain("(todo)"); // todo indicator

  // Both should contain the summary at the end
  expect(normalOutput).toContain("2 pass");
  expect(normalOutput).toContain("1 skip");
  expect(normalOutput).toContain("1 todo");

  expect(quietOutput).toContain("2 pass");
  expect(quietOutput).toContain("1 skip");
  expect(quietOutput).toContain("1 todo");

  expect(normalizeBunSnapshot(normalOutput, dir)).toMatchSnapshot("normal");
  expect(normalizeBunSnapshot(quietOutput, dir)).toMatchSnapshot("quiet");
});

test("CLAUDECODE flag handles no test files found", () => {
  using dir = tempDir("empty-project", {
    "package.json": `{
      "name": "empty-project",
      "version": "1.0.0"
    }`,
    "src/index.js": `console.log("hello world");`,
  });

  // Run with CLAUDECODE=0 (normal output) - no test files
  const result1 = spawnSync({
    cmd: [bunExe(), "test"],
    env: { ...testEnv, CLAUDECODE: "0" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  // Run with CLAUDECODE=1 (quiet output) - no test files
  const result2 = spawnSync({
    cmd: [bunExe(), "test"],
    env: { ...testEnv, CLAUDECODE: "1" },
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const normalOutput = result1.stderr.toString() + result1.stdout.toString();
  const quietOutput = result2.stderr.toString() + result2.stdout.toString();

  expect(normalizeBunSnapshot(normalOutput, dir)).toMatchSnapshot("no-tests-normal");
  expect(normalizeBunSnapshot(quietOutput, dir)).toMatchSnapshot("no-tests-quiet");
});

// When `bun test` finds no test file, it says how a test file is named. The two
// tests below hold what it says against the file names the scanner takes.
const passingTest = `import { test } from "bun:test"; test("x", () => {});`;

async function runBunTest(cwd: string, args: string[], CLAUDECODE: "0" | "1") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...testEnv, CLAUDECODE },
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("the note for no test files found names suffixes that make a file a test file", async () => {
  using empty = tempDir("no-tests-note", { "MyApp.ts": passingTest });
  const note = `Test files end in ".test", "_test", ".spec" or "_spec" before the extension (ex: "MyApp.test.ts")`;

  // A filter that matches no file prints the note too, with and without CLAUDECODE=1.
  const filter = "a-filter-that-matches-no-file";
  const [noArguments, noMatch, noMatchQuiet] = await Promise.all([
    runBunTest(String(empty), [], "0"),
    runBunTest(String(empty), [filter], "0"),
    runBunTest(String(empty), [filter], "1"),
  ]);
  expect(noArguments.stderr).toContain(note);
  expect(noMatch.stderr).toContain("note: " + note);
  expect(noMatchQuiet.stderr).toContain("note: " + note);
  expect([noArguments.exitCode, noMatch.exitCode, noMatchQuiet.exitCode]).toEqual([1, 1, 1]);

  // Do what the note says: one file for each suffix that it names. Its example is one of them.
  const suffixes = Array.from(noArguments.stderr.matchAll(/"([._][a-z_]+)"/g), match => match[1]);
  expect(suffixes).toEqual([".test", "_test", ".spec", "_spec"]);
  const names = suffixes.map(suffix => `MyApp${suffix}.ts`);
  expect(names).toContain(noArguments.stderr.match(/\(ex: "(.+)"\)/)?.[1]);
  using named = tempDir("no-tests-note-named", Object.fromEntries(names.map(name => [name, passingTest])));
  const { stderr, exitCode } = await runBunTest(String(named), [], "0");
  expect(stderr).toContain("Ran 4 tests across 4 files.");
  expect(exitCode).toBe(0);
});

// The glob comes from the loaders that the scanner looks up, so a `[loader]`
// entry in bunfig.toml changes both. An extension is literal text in the glob.
const defaultExtensions = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"];
const customExtensions = ["foo", "foo[1]", "b{c},d", "e+(f)"];

test.concurrent.each([
  ["default loaders", "", defaultExtensions],
  [
    "[loader] entries in bunfig.toml",
    `[loader]\n".d.ts" = "ts"\n` + customExtensions.map(ext => `".${ext}" = "ts"\n`).join(""),
    [...defaultExtensions, ...customExtensions],
  ],
])(
  "CLAUDECODE=1 error for no test files found prints a glob that matches the file names the scanner takes (%s)",
  async (_, bunfig, extensions) => {
    const testFiles = [".test", "_test", ".spec", "_spec"]
      .flatMap(suffix => extensions.map(ext => `MyApp${suffix}.${ext}`))
      .concat("nested/dir/MyApp_test.ts")
      .sort();
    const otherFiles = [
      "MyApp.ts",
      "MyApp_test_.ts",
      "MyApp_spec_.ts",
      "MyApp.testunit.ts",
      "My.testApp.ts",
      "testMyApp.ts",
      "MyApp.test.json",
      "MyApp.test.d.ts",
      // What `foo[1]`, `b{c},d` and `e+(f)` select when the glob does not escape them.
      "MyApp.test.foo1",
      "MyApp.test.bc",
      "MyApp.test.d",
      "MyApp.test.ef",
    ];
    // Each file prints its own name when the scanner takes it.
    const printsName = (name: string) =>
      `import { test } from "bun:test"; test("x", () => { console.log("RAN ${name}"); });`;
    using mixed = tempDir("no-tests-glob-mixed", {
      "bunfig.toml": bunfig,
      ...Object.fromEntries([...testFiles, ...otherFiles].map(name => [name, printsName(name)])),
    });
    using empty = tempDir("no-tests-glob-empty", { "bunfig.toml": bunfig, "MyApp.ts": passingTest });

    const [scan, quiet] = await Promise.all([runBunTest(String(mixed), [], "0"), runBunTest(String(empty), [], "1")]);
    expect(Array.from(scan.stdout.matchAll(/^RAN (\S+)/gm), match => match[1]).sort()).toEqual(testFiles);
    expect(scan.exitCode).toBe(0);

    expect(quiet.stderr).toContain("0 test files matching");
    const glob = new Bun.Glob(quiet.stderr.match(/0 test files matching (\S+) in --cwd=/)?.[1] ?? "");
    expect([...testFiles, ...otherFiles].filter(name => glob.match(name))).toEqual(testFiles);
    expect(quiet.exitCode).toBe(1);
  },
);
