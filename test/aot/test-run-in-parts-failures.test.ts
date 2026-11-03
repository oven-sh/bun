// How a run in parts reads: ./test-run-in-parts.test.ts.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "./harness/commands";
import { registry } from "./harness/registry";
import { run } from "./harness/run";
import { envOf, files, passing, runTests, twoFiles } from "./harness/test-run-in-parts";
import { test } from "./supported";

// `sabotage=StoredValuesAreNeverRead` loses values on purpose, and the compiler stops at the read in `leftOf` with an internal error that names the file.
// The word loses them in every file, so the other files read nothing that was stored.
const readsNothingStored = (name: string) => `import { test, expect } from "bun:test";
test("${name}", () => {
  expect(1 + 2).toBe(3);
});
`;
const stopsTheCompiler = {
  ...files,
  ...Object.fromEntries(["a", "b", "d", "e", "f", "g"].map(name => [`${name}.test.ts`, readsNothingStored(name)])),
  "stops.ts": `type Pair = { left: number; right: string };
function leftOf(pair: Pair): number {
  const left = pair.left;
  return left + 1;
}
export const two: number = leftOf({ left: 1, right: "two" });
`,
  "c.test.ts": `import { two } from "./stops";\nconsole.log(two);\n${readsNothingStored("c")}`,
};
const hasTheWord = !unsupported && registry().sabotages?.includes("StoredValuesAreNeverRead");

// The word stops the compiler in Bun's own code too, all of which the program that parts share holds. So this is asked of one program.
test.skipIf(!hasTheWord)(
  "an internal error of the compiler fails the test files that import the file it names",
  async () => {
    using dir = tempDir("aot-test-run-internal-error", stopsTheCompiler);
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      envOf("sabotage=StoredValuesAreNeverRead"),
    );
    expect(stderr).toMatch(
      /internal compiler error \(AnalyzeFlow\): OperationWithoutValue: .* in function 'leftOf' at .*stops\.ts:3:/,
    );
    expect(stderr).toContain("bun test --aot does not run this file");
    expect(stderr).not.toContain("could not be compiled");
    for (const name of ["a", "b", "d", "e", "f", "g"]) expect(stderr).toContain(`(pass) ${name}`);
    expect(stderr).not.toContain("(pass) c");
    expect(exitCode).toBe(1);
  },
  120_000,
);

// Such a file is left to the loader of the run, which throws where it is imported, as under plain `bun test`.
test("a file that is no program, which the parts share, fails the test files that import it, and no other", async () => {
  using dir = tempDir("aot-test-run-in-parts-shared-error", {
    ...files,
    "stops.ts": `let same = 1;\nlet same = 2;\nexport const two: number = same;\n`,
    "between.ts": `export { two } from "./stops";\n`,
    "c.test.ts": `import { two } from "./between";\nconsole.log(two);\n${passing("c")}`,
    "g.test.ts": passing("g"),
  });
  const plain = await runTests(String(dir), undefined, "--parallel=2");
  expect(plain.results).toContain("pass g");
  expect(plain.results).not.toContain("pass c");
  expect(await runTests(String(dir), twoFiles, "--aot", "--parallel=2")).toEqual(plain);
}, 120_000);

test("where nothing that the test files import is a program, each test file fails by itself", async () => {
  using dir = tempDir("aot-test-run-in-parts-empty-layer", {
    ...files,
    "lib.ts": `let same = 1;\nlet same = 2;\nexport const value: number = same;\n`,
    "g.test.ts": `import { test } from "bun:test";\ntest("g", () => {});\n`,
  });
  const plain = await runTests(String(dir), undefined);
  expect(plain.results).toEqual(["pass g"]);
  expect(await runTests(String(dir), twoFiles, "--aot")).toEqual(plain);
}, 120_000);

// Windows has no signal to die by.
test.skipIf(isWindows)(
  "a worker that crashes costs the file that it ran, and the run goes on",
  async () => {
    using dir = tempDir("aot-test-run-in-parts-crash", {
      ...files,
      "c.test.ts": `${passing("c")}test("c crashes", () => {\n  process.kill(process.pid, "SIGABRT");\n  Bun.sleepSync(5000);\n});\n`,
      "g.test.ts": passing("g"),
    });
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      envOf(twoFiles),
    );
    expect(stderr).toMatch(/c\.test\.ts.*\(worker crashed: SIGABRT\)/);
    expect(stderr).not.toContain("Aborting");
    // d is in the part of c.
    for (const name of ["a", "b", "d", "e", "f", "g"]) expect(stderr).toContain(`(pass) ${name}`);
    expect(exitCode).toBe(1);
  },
  120_000,
);

// The word makes the compiler fail an assertion where it compiles a function of this name.
test.skipIf(!(!unsupported && registry().sabotages?.includes("FunctionPassFailsAssertion")))(
  "a test file that brings the compiler down fails alone",
  async () => {
    using dir = tempDir("aot-test-run-in-parts-compiler-crash", {
      ...files,
      "c.test.ts": `function stopsTheCompiler(value: number): number {\n  return value + 1;\n}\nconsole.log(stopsTheCompiler(1));\n${passing("c")}`,
      "g.test.ts": passing("g"),
    });
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      { ...envOf(`${twoFiles},sabotage=FunctionPassFailsAssertion`), BUN_ENABLE_CRASH_REPORTING: "0" },
    );
    expect(stderr).toMatch(/2 test files together could not be compiled: .*\. Each is compiled by itself/);
    expect(stderr).toMatch(/c\.test\.ts.*\(could not be compiled: /);
    // d is in the part of c.
    for (const name of ["a", "b", "d", "e", "f", "g"]) expect(stderr).toContain(`(pass) ${name}`);
    expect(stderr).not.toContain("(pass) c");
    expect(exitCode).toBe(1);
  },
  120_000,
);

// The word makes the compiler fail an assertion in every build, so in that of the lowest layer.
test.skipIf(!(!unsupported && registry().sabotages?.includes("ProgramPassFailsAssertion")))(
  "where what the test files import cannot be built, that is said once",
  async () => {
    using dir = tempDir("aot-test-run-in-parts-layer-crash", files);
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      { ...envOf(`${twoFiles},sabotage=ProgramPassFailsAssertion`), BUN_ENABLE_CRASH_REPORTING: "0" },
    );
    expect(stderr.split("\n").filter(line => line.includes("could not be compiled"))).toEqual([
      expect.stringMatching(
        /^error: what the test files import could not be compiled: .*, in the build of the packages\. None of the 7 test files ran$/,
      ),
    ]);
    expect(stderr).not.toContain("(pass)");
    expect(exitCode).toBe(1);
  },
  120_000,
);

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

test("a test file with a syntax error, alone in its part, is reported as in a run of one program", async () => {
  // No preload: the part's build has the one file to begin with.
  const { "preload.ts": _, "g.test.ts": __, ...rest } = files;
  using dir = tempDir("aot-test-run-in-parts-syntax-error", {
    ...Object.fromEntries(
      Object.entries(rest).map(([name, text]) => [name, text.replace(" + (globalThis as any).fromPreload", " + 2")]),
    ),
    "g.test.ts": `import { test, expect } from "bun:test";\ntest("g", () => {\n  expect(1).toBe(1;\n});\n`,
  });
  async function report(words?: string) {
    const junit = ["--reporter=junit", "--reporter-outfile=out.xml"];
    const { stderr, exitCode } = await run([bunExe(), "test", "--aot", ...junit], String(dir), envOf(words));
    // Not the line that names the file above what a worker wrote: the words and the end of the file come by two pipes.
    const lines = stderr.split("\n").filter(line => /g\.test\.ts:\d|^error|^ *\d+ (pass|fail|error)/.test(line));
    const cases = [...readFileSync(join(String(dir), "out.xml"), "utf8").matchAll(/<testcase name="([^"]*)"/g)];
    return { lines: lines.sort(), cases: cases.map(match => match[1]).sort(), exitCode };
  }
  const one = await report();
  expect(one.lines).toContainEqual(expect.stringContaining("TS1005"));
  expect(one.cases).not.toContain("(worker crashed)");
  expect(await report("TestRunLayers:2,TestRunPartFiles:1")).toEqual(one);
  expect(await report(twoFiles)).toEqual(one);
}, 120_000);
