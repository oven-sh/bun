import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { slot } from "./harness/commands";
import { run } from "./harness/run";
import { test } from "./supported";

// `process.exitCode = 3` in a test: where every test passes, `bun test` ends with 3. A run over layers has its test files in worker processes, though nobody asked for any: they run one
// after another, each starts from what the files before it have left, and the run ends as it does in one process. With --parallel a run ends with 0 whatever a test has stored, in plain Bun too.
const passes = (body: string) =>
  `import { expect, test } from "bun:test";\ntest("t", () => { ${body} expect(1).toBe(1); });\n`;
const fails = `import { expect, test } from "bun:test";\ntest("t", () => { expect(1).toBe(2); });\n`;
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
    "b.test.js": fails,
  },
  "the body of a file sets it": { "a.test.js": "process.exitCode = 4;\n" + passes(""), "b.test.js": passes("") },
  "nothing sets it": { "a.test.js": passes(""), "b.test.js": passes("") },
};
// Without --parallel, and with it.
const expected: Record<string, number[]> = {
  "one file sets it": [3, 0],
  "two files set it": [5, 0],
  "a later file sets it back": [0, 0],
  "a test fails besides": [1, 1],
  "the body of a file sets it": [4, 0],
  "nothing sets it": [0, 0],
};
// The lowest layer of a run holds Bun's own code, compiled for that run: the same code for each of these projects, and nearly all of what such a run costs. With --parallel
// no test file is handed what another has stored: there the projects that end with 0 are also one run, each in a folder of its own, and over layers that run stands for all of them.
const together = Object.fromEntries(
  Object.entries(projects)
    .filter(([name]) => expected[name][1] === 0)
    .flatMap(([name, files]) =>
      Object.entries(files).map(([file, text]) => [`${name.replaceAll(" ", "-")}/${file}`, text]),
    ),
);

// The words bring layers to a run this small, and a program for each test file: a worker process runs one program above the layers.
const ways: [how: string, flags: string[], words?: string][] = [
  ["in plain Bun", []],
  ["as one program", ["--aot"]],
  ["over layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
];

// What a run prints about the file whose test fails, without the empty lines.
const failure = (file: string) => [
  "(fail) t",
  ...fails
    .trimEnd()
    .split("\n")
    .map((line, index) => `${index + 1} | ${line}`),
  "^",
  "error: expect(received).toBe(expected)",
  "Expected: 2",
  "Received: 1",
  `at <anonymous> (DIR/${file}:2:29)`,
];

/** Every line that `bun test --isolate <flags>` prints, under the test file that it is about, and the code that the run ends with. */
async function ran(files: Record<string, string>, flags: string[], words?: string) {
  using dir = tempDir("exit-code-left-by-a-test", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    ...files,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  // No more runs at once than the machine has processors, however many tests are under way.
  const { stdout, stderr, exitCode } = await slot(() =>
    run([bunExe(), "test", "--isolate", ...flags], String(dir), env),
  );
  const printed: Record<string, string[]> = {};
  let about = (printed["above the files"] = [] as string[]);
  for (const whole of stderr.replaceAll(String(dir), "DIR").replaceAll("\\", "/").split("\n")) {
    const line = whole.replace(/ \[[\d.]+m?s\]$/, "").trim();
    // With the words a run says how it is built. What stands around these two numbers differs from one build of Bun to another.
    const programs = line.match(/^AOT test run \| .*?\| (test files \d+ \| to a program \d+)/)?.[1];
    // With --parallel the result of a test and what the test printed reach the run by two pipes: here the result stands first, whichever came first.
    if (line.endsWith(".test.js:")) about = printed[line.slice(0, -1)] ??= [];
    else if (/^\d+ pass$/.test(line)) about = printed["in all"] = [line];
    else if (/^\((pass|fail)\) /.test(line)) about.unshift(line);
    else if (line) about.push(programs ?? line);
  }
  // The first line names the version, and the number of workers.
  return { stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test v")), printed, exitCode };
}

/** What such a run has to print and to end with. */
function wanted(files: Record<string, string>, exitCode: number, words?: string) {
  const names = Object.keys(files);
  const failed = names.filter(name => files[name] === fails);
  return {
    stdout: [],
    printed: {
      "above the files": words ? [`test files ${names.length} | to a program 1`] : [],
      ...Object.fromEntries(names.map(name => [name, failed.includes(name) ? failure(name) : ["(pass) t"]])),
      "in all": [
        `${names.length - failed.length} pass`,
        `${failed.length} fail`,
        `${names.length} expect() calls`,
        `Ran ${names.length} tests across ${names.length} files.`,
      ],
    },
    exitCode,
  };
}

// A debug build of Bun takes three minutes to build a lowest layer, and up to seven where five such runs are under way: more than a test gets there.
// No lane of CI tests a debug build, so there a run that hangs still fails its one test at the runner's limit.
const limitOverLayers = isDebug ? 900_000 : undefined;

function ends(exitCode: number, title: string, files: Record<string, string>, flags: string[], words?: string) {
  test.concurrent(
    `the exit code of a test run ${title}`,
    async () => {
      expect(await ran(files, flags, words)).toEqual(wanted(files, exitCode, words));
    },
    words ? limitOverLayers : undefined,
  );
}

// The runs over layers come last. A run waits for its slot with the limit of its test running, and a run over layers holds a slot for as long as
// a lowest layer takes to build: behind eight of them the short runs would wait their limits out.
for (const [how, flags, words] of ways) {
  const inParallel = [...flags, "--parallel=2"];
  for (const [name, files] of Object.entries(projects)) {
    const [alone, beside] = expected[name];
    ends(alone, `${how}: ${name}`, files, flags, words);
    if (!words || beside !== 0) ends(beside, `${how} with --parallel: ${name}`, files, inParallel, words);
  }
  ends(0, `${how} with --parallel: the projects that pass, as one run`, together, inParallel, words);
}
