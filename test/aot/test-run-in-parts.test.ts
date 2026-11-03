// What a failure costs: ./test-run-in-parts-failures.test.ts. What code sees: ./test-run-in-parts-what-code-sees.test.ts.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { envOf, files, twoFiles } from "./harness/test-run-in-parts";
import { test as oneAtATime } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// A run in parts compiles Bun's own code once more, and its case waits for that. So no case holds two such runs, and the cases run
// beside one another, as many as `--max-concurrency` allows.
const test = oneAtATime.concurrent;

type Printed = { stdout: string; stderr: string; exitCode: number };

/** What plain `bun test` prints in one process for the seven test files of ./harness/test-run-in-parts.ts. */
const inOneProcess: Printed = {
  stdout: `a ran with lib
b ran with lib
c ran with lib
d ran with lib
e ran with lib
f ran with lib
`,
  stderr: `
a.test.ts:
(pass) a

b.test.ts:
(pass) b

c.test.ts:
(pass) c

d.test.ts:
(pass) d
(skip) d skipped

e.test.ts:
(pass) e
2 | import { value } from "./lib";
3 | test("e", () => {
4 |   expect(value + (globalThis as any).fromPreload).toBe(3);
5 |   console.log("e ran with lib");
6 | });
7 | test("e fails", () => { expect(1).toBe(2); });
                                      ^
error: expect(received).toBe(expected)

Expected: 2
Received: 1

      at <anonymous> (<dir>/e.test.ts:7:35)
(fail) e fails

f.test.ts:
(pass) f

g.test.ts:

# Unhandled error between tests
-------------------------------
error: Cannot find module './no-such-file' from '<dir>/g.test.ts'
-------------------------------


 6 pass
 1 skip
 2 fail
 1 error
 7 expect() calls
Ran 9 tests across 7 files.
`,
  exitCode: 1,
};

const preload = ["--preload", "./preload.ts"];

/**
 * Runs `bun test` in a folder. Of what it printed, the folder reads `<dir>`, and no line is left that says the version, how the run is
 * built or how long something took. `words` build the run in layers, with so many test files to a program.
 */
async function printed(directory: string, words: string | undefined, ...flags: string[]): Promise<Printed> {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, envOf(words));
  // A run with such words says on lines of their own how it is built. `run()` asks them for the layers, and this for the parts.
  const toAProgram = words?.match(/TestRunPartFiles:(\d+)/)?.[1];
  if (toAProgram) expect(stderr).toMatch(new RegExp(`^AOT test run \\| .* \\| to a program ${toAProgram}\\b`, "m"));
  const told = (text: string) =>
    text
      .replaceAll(directory, "<dir>")
      .replace(/^(bun test v|AOT test run \|).*\n/gm, "")
      .replace(/ \[[\d.]+ ?m?s\]$/gm, "");
  return { stdout: told(stdout), stderr: told(stderr), exitCode };
}

/**
 * For a run whose workers print at once: all of its lines in the order of a dictionary. The name of a file is left out: it is
 * printed again wherever the lines of another file came between.
 */
const inAnyOrder = ({ stdout, stderr, exitCode }: Printed) => ({
  lines: `${stdout}\n${stderr}`
    .split("\n")
    .filter(line => line !== "" && !/^\w\.test\.ts:$/.test(line))
    .sort(),
  exitCode,
});

// One run in parts answers two cases: how it reads, and what its junit report holds. The case that comes first starts it.
let oneRun: Promise<{ plain: Printed; inParts: Printed; reports: { plain: string; inParts: string } }> | undefined;
const withJunitReport = () =>
  (oneRun ??= (async () => {
    using dir = tempDir("aot-test-run-in-parts", files);
    const junit = (name: string) => ["--reporter=junit", `--reporter-outfile=${name}.xml`];
    // Without what differs from run to run: when a file ran, where, and for how long. A CI also names its job and commit in each suite.
    const report = (name: string) =>
      readFileSync(join(String(dir), `${name}.xml`), "utf8")
        .replaceAll(String(dir), "<dir>")
        .replace(/ (time|hostname|timestamp)="[^"]*"/g, "")
        .replace(/^ *<properties>[^]*?<\/properties>\n/gm, "");
    const plain = await printed(String(dir), undefined, ...preload, ...junit("plain"));
    const inParts = await printed(String(dir), twoFiles, ...preload, "--aot", ...junit("in-parts"));
    return { plain, inParts, reports: { plain: report("plain"), inParts: report("in-parts") } };
  })());

test("a test run in parts reads as one run", async () => {
  const { plain, inParts } = await withJunitReport();
  expect(plain).toEqual(inOneProcess);
  expect(inParts).toEqual(plain);
});

test("under --parallel the parts run at once, with the same report", async () => {
  using dir = tempDir("aot-test-run-in-parts-parallel", files);
  const plain = await printed(String(dir), undefined, ...preload, "--parallel=3");
  expect(inAnyOrder(plain)).toEqual(inAnyOrder(inOneProcess));
  const inParts = await printed(String(dir), twoFiles, ...preload, "--aot", "--parallel=3");
  expect(inAnyOrder(inParts)).toEqual(inAnyOrder(plain));
});

const withTimings = {
  ...files,
  // No time for c: a file nobody has timed may be slow, so it is dealt first, and it counts as one of the slowest tenth, 5000 ms.
  "timings.json": JSON.stringify({
    version: 1,
    files: { "a.test.ts": 10, "b.test.ts": 20, "d.test.ts": 900, "e.test.ts": 30, "f.test.ts": 5000, "g.test.ts": 1 },
  }),
};

test("with --timings the parts take about as long as one another, and each begins with its slowest file", async () => {
  using dir = tempDir("aot-test-run-in-parts-timings", withTimings);
  const oneWorker = ["--parallel=1", "--timings=timings.json"];
  const plain = await printed(String(dir), undefined, ...preload, ...oneWorker);
  expect(inAnyOrder(plain)).toEqual(inAnyOrder(inOneProcess));
  const inParts = await printed(String(dir), twoFiles, ...preload, "--aot", ...oneWorker);
  // Each file goes to the part that has the least so far: c | f | d | e b a g. A worker runs a part to its end.
  // g imports a file that is not there, and whether its name is printed is not asked here.
  const order = [...inParts.stderr.matchAll(/^([a-f])\.test\.ts:$/gm)].map(match => match[1]).join("");
  expect(order).toContain("eba");
  expect(order).toHaveLength(6);
  expect(inAnyOrder(inParts)).toEqual(inAnyOrder(plain));
});

test("with --timings and --parallel the parts run at once, with the same report", async () => {
  using dir = tempDir("aot-test-run-in-parts-timings-parallel", withTimings);
  const threeWorkers = ["--parallel=3", "--timings=timings.json"];
  const plain = await printed(String(dir), undefined, ...preload, ...threeWorkers);
  expect(inAnyOrder(plain)).toEqual(inAnyOrder(inOneProcess));
  const inParts = await printed(String(dir), twoFiles, ...preload, "--aot", ...threeWorkers);
  expect(inAnyOrder(inParts)).toEqual(inAnyOrder(plain));
});

test("a JavaScript test file runs beside a tsconfig.json that does not allow JavaScript", async () => {
  using dir = tempDir("aot-test-run-in-parts-javascript", {
    "tsconfig.json": "{}",
    "a.test.js": `import { test } from "bun:test";\ntest("a", () => {});\n`,
    "b.test.js": `import { test } from "bun:test";\ntest("b", () => {});\n`,
    "c.test.ts": `import { test } from "bun:test";\ntest("c", () => {});\n`,
  });
  expect(await printed(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual({
    stdout: "",
    stderr: `
a.test.js:
(pass) a

b.test.js:
(pass) b

c.test.ts:
(pass) c

 3 pass
 0 fail
Ran 3 tests across 3 files.
`,
    exitCode: 0,
  });
});

test("the junit report of a run in parts has every test", async () => {
  const { reports } = await withJunitReport();
  const cases = [...reports.plain.matchAll(/<testcase name="([^"]*)"/g)].map(match => match[1]);
  expect(cases).toEqual(["a", "b", "c", "d", "d skipped", "e", "e fails", "f", "(unhandled error)"]);
  expect(reports.inParts).toEqual(reports.plain);
});
