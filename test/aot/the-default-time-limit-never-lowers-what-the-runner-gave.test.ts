// ./supported.ts and two files of ./harness raise the five seconds of bun:test to what a build needs. The runner gives a Bun
// with assertions, which builds several times slower, more than that: a default that lowered it cut cases off on that lane alone.
//
// No case of this file waits for a limit to pass. bun:test keeps the limit of a case in its task, and a case reads it there: through `test.for`
// in this file, and through `TestRunner` of "vitest" in a child run, whose cases are declared in every form. Cases of a child run wait
// longer than a small limit allows, and so show that this is the number that ends a case.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  atLeastWhatTheRunnerGave,
  givenToABunWithAssertions,
  isGivenThatMuchByTheRunner,
  noLongerThan,
  raiseDefaultTimeout,
  raisingLimits,
} from "./harness/default-timeout";
import { test } from "./supported";

// ./supported.ts raises the default when it is loaded, and bun:test takes it back behind every file. Without --isolate or --parallel, a
// process that runs this file behind another one of the folder does not load the module again: so this file raises the default itself.
raiseDefaultTimeout(120_000);

// What this run is. `byRunner`: the runner gave this Bun what it gives a Bun with assertions, and then its flag holds. Any other Bun with
// assertions has the harness's number, and a Bun without assertions has the 120 seconds that ./supported.ts asks for.
const thisRun = {
  hasAssertions: isASAN || isDebug,
  byRunner: isGivenThatMuchByTheRunner(process.env.TEST_TMPDIR, process.execPath),
};

test("the number is the runner's own", () => {
  const runner = readFileSync(join(import.meta.dir, "..", "..", "scripts", "runner.node.ts"), "utf8");
  const minutes = Number(/^const testTimeout = (\d+) \* 60_000;$/m.exec(runner)?.[1]);
  expect(runner).toContain("const perTestTimeout = Math.ceil(testTimeout / 2) * (isAsan ? 3 : 1);");
  expect(givenToABunWithAssertions).toBe(Math.ceil((minutes * 60_000) / 2) * 3);
});

test("a file that runs beside others gets more, and the runner says that it is there", () => {
  const runner = readFileSync(join(import.meta.dir, "..", "..", "scripts", "runner.node.ts"), "utf8");
  expect(runner).toContain("const timeout = getTestTimeout(testPath) * (opts.filesAtATime ?? 1);");
  expect(runner).toContain("const perTestTimeout = Math.ceil(timeout / 2) * (isAsan ? 3 : 1);");
  expect(runner).toContain("TEST_TMPDIR: tmpdirPath,");
  expect(runner).toContain('const isAsan = basename(execPath).includes("asan");');
  expect({
    underTheRunner: isGivenThatMuchByTheRunner("/tmp", "/build/bun-asan-stripped"),
    byHand: isGivenThatMuchByTheRunner(undefined, "/build/bun-asan"),
    aDebugBunUnderTheRunner: isGivenThatMuchByTheRunner("/tmp", "/build/bun-debug"),
    underAnotherName: isGivenThatMuchByTheRunner("/tmp", "/asan/bun"),
  }).toEqual({ underTheRunner: true, byHand: false, aDebugBunUnderTheRunner: false, underAnotherName: false });
});

test("a default is raised to what the runner gave, and never lowered", () => {
  expect({
    withAssertions: atLeastWhatTheRunnerGave(120_000, true, false),
    withAssertionsAndALimitOfALongFile: atLeastWhatTheRunnerGave(240_000, true, false),
    withAssertionsAndALongerLimit: atLeastWhatTheRunnerGave(600_000, true, false),
    withoutAssertions: atLeastWhatTheRunnerGave(120_000, false, false),
  }).toEqual({
    withAssertions: 270_000,
    withAssertionsAndALimitOfALongFile: 270_000,
    withAssertionsAndALongerLimit: 600_000,
    withoutAssertions: 120_000,
  });
  expect({
    withAssertions: atLeastWhatTheRunnerGave(120_000, true, true),
    withAssertionsAndALimitOfALongFile: atLeastWhatTheRunnerGave(240_000, true, true),
    withAssertionsAndALongerLimit: atLeastWhatTheRunnerGave(600_000, true, true),
    withoutAssertions: atLeastWhatTheRunnerGave(120_000, false, true),
  }).toEqual({
    withAssertions: undefined,
    withAssertionsAndALimitOfALongFile: undefined,
    withAssertionsAndALongerLimit: 600_000,
    withoutAssertions: 120_000,
  });
});

test("a limit that a case brings as a number is raised too, whatever is chained in front of it", () => {
  const seen: unknown[][] = [];
  const registers = (...path: string[]): any =>
    Object.assign(
      function (this: unknown, ...operands: unknown[]) {
        seen.push([...path, ...operands.filter(operand => typeof operand !== "function")]);
        return path.at(-1)?.endsWith("If") || path.at(-1) === "each" ? registers(...path, "()") : undefined;
      },
      path.length < 3 && {
        get each() {
          return registers(...path, "each");
        },
        get skipIf() {
          return registers(...path, "skipIf");
        },
        get concurrent() {
          return registers(...path, "concurrent");
        },
      },
    );
  const body = () => {};
  const raising = raisingLimits(registers("test"), true, undefined, false);
  raising("a", body, 120_000);
  raising("b", body, 600_000);
  raising("c", body);
  raising("d", body, noLongerThan(5_000));
  raising("e", 60_000, body);
  raising.concurrent("f", body, 60_000);
  raising.skipIf(0)("g", body, 60_000);
  raising.each([[1, 2]])("h", body, 240_000);
  raising.concurrent.each([1])("i", body, 1_000);
  raisingLimits(registers("beforeAll"), true, undefined, false)(body, 120_000);
  expect(seen).toEqual([
    ["test", "a", 270_000],
    ["test", "b", 600_000],
    ["test", "c"],
    ["test", "d", { timeout: 5_000 }],
    ["test", "e", 270_000],
    ["test", "concurrent", "f", 270_000],
    ["test", "skipIf", 0],
    ["test", "skipIf", "()", "g", 270_000],
    ["test", "each", [[1, 2]]],
    ["test", "each", "()", "h", 270_000],
    ["test", "concurrent", "each", [1]],
    ["test", "concurrent", "each", "()", "i", 270_000],
    ["beforeAll", 270_000],
  ]);
  seen.length = 0;
  const underRunner = raisingLimits(registers("test"), true, undefined, true);
  underRunner("a", body, 120_000);
  underRunner("b", body, 600_000);
  underRunner("d", body, noLongerThan(5_000));
  underRunner("e", 60_000, body);
  underRunner.concurrent.each([1])("i", body, 1_000);
  raisingLimits(registers("beforeAll"), true, undefined, true)(body, 120_000);
  expect(seen).toEqual([
    ["test", "a"],
    ["test", "b", 600_000],
    ["test", "d", { timeout: 5_000 }],
    ["test", "e"],
    ["test", "concurrent", "each", [1]],
    ["test", "concurrent", "each", "()", "i"],
    ["beforeAll"],
  ]);
  const untouched = registers("test");
  expect(raisingLimits(untouched, false)).toBe(untouched);
});

// A run of `bun test` on one file: the limit that each case said it has, how each case ended, and what the run counted.
type Said = { limits: Record<string, number>; ends: Record<string, string>; counts: string[] };
async function testRun(
  folder: string,
  file: string,
  text: string,
  flags: string[],
  env: Record<string, string | undefined>,
): Promise<{ said: Said; stderr: string; exitCode: number }> {
  using dir = tempDir(folder, { [file]: text });
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, `./${file}`],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  // `(fail) a case [300.22ms]`, and behind it `  ^ this test timed out after 300ms.` where its limit ended it.
  const ended = /^\((pass|fail|skip|todo)\) (.+?)(?: \[[\d.]+m?s\])?(?:\n +\^ this test (timed out after \d+ms)\.)?$/gm;
  return {
    said: {
      limits: Object.fromEntries(
        [...stdout.matchAll(/^(.+): (\d+)$/gm)].map(([, title, limit]) => [title, Number(limit)]),
      ),
      ends: Object.fromEntries([...stderr.matchAll(ended)].map(([, how, title, cut]) => [title, cut ?? how])),
      counts: stderr.match(/^ *\d+ (?:pass|fail|skip|todo|errors?)$/gm)?.map(line => line.trim()) ?? [],
    },
    stderr,
    exitCode,
  };
}

// Every case of a child run begins with it.
const saysItsLimit = `
const saysItsLimit = () => {
  const { fullTestName, timeout } = TestRunner.getCurrentTest();
  console.log(fullTestName + ": " + timeout);
};`;

// With small numbers, so that it runs on every lane: whose number it is that ends a case. Four cases wait twice as long as the flag allows,
// side by side (--concurrent), and one of them brings a limit that is shorter than its wait.
const whoseLimit = `
import { test as testOfBun } from "bun:test";
import { TestRunner } from "vitest";
import { noLongerThan, raiseDefaultTimeout, raisingLimits } from ${JSON.stringify(join(import.meta.dir, "harness", "default-timeout"))};
const byRunner = process.env.TEST_TMPDIR !== undefined;
raiseDefaultTimeout(120_000, true, byRunner);
const test = raisingLimits(testOfBun, true, undefined, byRunner);
${saysItsLimit}
const waitsLongerThanTheFlag = async () => {
  saysItsLimit();
  await Bun.sleep(600);
};
test("no limit of its own", waitsLongerThanTheFlag);
test("a limit of its own", waitsLongerThanTheFlag, 170_000);
test("a limit of its own under its wait", waitsLongerThanTheFlag, 100);
test("a longer limit of its own", waitsLongerThanTheFlag, 600_000);
test("a limit that the case tests", saysItsLimit, noLongerThan(5_000));
`;
const whoseLimitRuns: { title: string; variable?: string; said: Said; exitCode: number }[] = [
  {
    title: "under the runner its flag ends a case",
    variable: "/tmp",
    said: {
      limits: {
        "no limit of its own": 300,
        "a limit of its own": 300,
        "a limit of its own under its wait": 300,
        "a longer limit of its own": 600_000,
        "a limit that the case tests": 5_000,
      },
      ends: {
        "no limit of its own": "timed out after 300ms",
        "a limit of its own": "timed out after 300ms",
        "a limit of its own under its wait": "timed out after 300ms",
        "a longer limit of its own": "pass",
        "a limit that the case tests": "pass",
      },
      counts: ["2 pass", "3 fail"],
    },
    exitCode: 1,
  },
  {
    title: "by hand the harness's number holds",
    said: {
      limits: {
        "no limit of its own": 270_000,
        "a limit of its own": 270_000,
        "a limit of its own under its wait": 270_000,
        "a longer limit of its own": 600_000,
        "a limit that the case tests": 5_000,
      },
      ends: {
        "no limit of its own": "pass",
        "a limit of its own": "pass",
        "a limit of its own under its wait": "pass",
        "a longer limit of its own": "pass",
        "a limit that the case tests": "pass",
      },
      counts: ["5 pass", "0 fail"],
    },
    exitCode: 0,
  },
];
test.concurrent.each(whoseLimitRuns)("$title", async ({ variable, said, exitCode }) => {
  const env: Record<string, string | undefined> = { ...bunEnv, NO_COLOR: "1", TEST_TMPDIR: variable };
  if (variable === undefined) delete env.TEST_TMPDIR;
  const ran = await testRun("aot-whose-limit", "whose.test.ts", whoseLimit, ["--concurrent", "--timeout=300"], env);
  expect(ran.said, ran.stderr).toEqual(said);
  expect(ran.exitCode).toBe(exitCode);
});

// ./supported.ts stands in front of what raises limits. AOT_CASES_AT_ONCE=1 has limits raised for `test` on every lane.
const forms = `
import { TestRunner } from "vitest";
import { describe, test, testOneByOne } from ${JSON.stringify(join(import.meta.dir, "supported"))};
${saysItsLimit}
test("plain", saysItsLimit, 60_000);
test.each([1, 2])("each %d", saysItsLimit, 60_000);
test.for([1])("for %d", saysItsLimit, 60_000);
test.skipIf(false)("skipIf", saysItsLimit, 60_000);
test.if(true)("if", saysItsLimit, 60_000);
test.todoIf(false)("todoIf", saysItsLimit, 60_000);
test.skipIf(false).each([1])("skipIf each %d", saysItsLimit, 60_000);
test.concurrent.each([1])("concurrent each %d", saysItsLimit, 60_000);
test.serial.each([1])("serial each %d", saysItsLimit, 60_000);
testOneByOne.each([1])("one by one each %d", saysItsLimit, 60_000);
testOneByOne.skipIf(false)("one by one skipIf", saysItsLimit, 60_000);
describe.each([1])("describe each %d", () => test("inside", saysItsLimit));
describe.skipIf(false)("describe skipIf", () => test("inside", saysItsLimit));
`;
test.concurrent("every form of test can be declared where limits are raised, and has the raised limit", async () => {
  // What the runner gives a file that runs beside two others. The child run has the environment and the executable of this run, so
  // ./supported.ts takes it for a run of the runner exactly where it takes this run for one.
  const flag = 3 * givenToABunWithAssertions;
  const env = { ...bunEnv, NO_COLOR: "1", AOT_CASES_AT_ONCE: "1" };
  const ran = await testRun("aot-forms-of-test", "forms.test.ts", forms, [`--timeout=${flag}`], env);
  // `test` leaves the limit that it is handed to the flag under the runner, and raises it by hand. `testOneByOne` and the default of
  // ./supported.ts do so in a Bun with assertions alone.
  const handedToTest = thisRun.byRunner ? flag : givenToABunWithAssertions;
  const handedToTestOneByOne = thisRun.hasAssertions ? handedToTest : 60_000;
  const withoutALimitOfItsOwn = thisRun.hasAssertions ? handedToTest : 120_000;
  const limits = {
    "plain": handedToTest,
    "each 1": handedToTest,
    "each 2": handedToTest,
    "for 1": handedToTest,
    "skipIf": handedToTest,
    "if": handedToTest,
    "todoIf": handedToTest,
    "skipIf each 1": handedToTest,
    "concurrent each 1": handedToTest,
    "serial each 1": handedToTest,
    "one by one each 1": handedToTestOneByOne,
    "one by one skipIf": handedToTestOneByOne,
    "describe each 1 > inside": withoutALimitOfItsOwn,
    "describe skipIf > inside": withoutALimitOfItsOwn,
  };
  expect(ran.said, ran.stderr).toEqual({
    limits,
    ends: Object.fromEntries(Object.keys(limits).map(title => [title, "pass"])),
    counts: ["14 pass", "0 fail"],
  });
  expect(ran.exitCode).toBe(0);
});

const defaultsSetByANumber = (text: string) =>
  [...text.matchAll(/^ *setDefaultTimeout\(([\d_]+)\)/gm)].map(([, limit]) => limit);

const limitOfItsOwn = /^\s*\},\s*[\d_]+,?\s*\);?\s*$|^\s*[\d_]{4,},?\s*\n\s*\);|\),\s*[\d_]{4,}\s*\);\s*$/m;
function handsALimitToWhatItTookStraightFromBunTest(source: string) {
  const text = source.replaceAll("\r\n", "\n");
  // Behind the first statement that imports nothing may stand the text of another test file.
  const [imports] = /^(?:(?:import\b[^;]*;|\/\/.*|\/\*[^]*?\*\/)?[ \t]*\n)*/.exec(text)!;
  const names = /import\s*\{([^}]*)\}\s*from\s*"bun:test";/.exec(imports)?.[1] ?? "";
  return /\b(?:test|it|beforeAll|afterAll|beforeEach|afterEach)\b/.test(names) && limitOfItsOwn.test(text);
}

// One walk of the folder and one read of each file for the two cases below. The reads are under way together: on a machine that no longer
// holds these files in memory, each of them waits for the disk.
let scanned: Promise<{ files: string[]; lower: string[]; direct: string[] }> | undefined;
const filesHere = () =>
  (scanned ??= (async () => {
    const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: import.meta.dir })]
      .filter(file => !file.includes("node_modules"))
      .map(file => file.replaceAll("\\", "/"));
    const lower: string[] = [];
    const direct: string[] = [];
    await Promise.all(
      files.map(async file => {
        const text = await readFile(join(import.meta.dir, file), "utf8");
        for (const limit of defaultsSetByANumber(text))
          if (Number(limit.replaceAll("_", "")) < givenToABunWithAssertions) lower.push(`${file}: ${limit}`);
        if (!file.endsWith(".test.ts") || file.startsWith("parallel/")) return;
        if (handsALimitToWhatItTookStraightFromBunTest(text)) direct.push(file);
      }),
    );
    return { files, lower: lower.sort(), direct: direct.sort() };
  })());

test.concurrent("no file here sets a default under the runner's number by itself", async () => {
  expect(
    defaultsSetByANumber("setDefaultTimeout(120_000);\n  setDefaultTimeout(600000);\nraiseDefaultTimeout(5_000);"),
  ).toEqual(["120_000", "600000"]);
  const { files, lower } = await filesHere();
  expect(files).toEqual(expect.arrayContaining(["supported.ts", "harness/default-timeout.ts", "harness/compiler.ts"]));
  expect(lower).toEqual([]);
});

test.concurrent("no test file here hands a limit of its own to what it took straight from bun:test", async () => {
  const handsOn = (from: string) =>
    `import { expect, test } from ${from};\n\ntest("a", () => {\n  expect(1).toBe(1);\n}, 30_000);\n`;
  expect({
    fromBunTest: handsALimitToWhatItTookStraightFromBunTest(handsOn('"bun:test"')),
    fromSupported: handsALimitToWhatItTookStraightFromBunTest(handsOn('"./supported"')),
    withoutALimit: handsALimitToWhatItTookStraightFromBunTest(handsOn('"bun:test"').replace(", 30_000", "")),
  }).toEqual({ fromBunTest: true, fromSupported: false, withoutALimit: false });
  const { files, direct } = await filesHere();
  expect(files).toContain(basename(import.meta.path));
  expect(direct).toEqual([]);
});

// What the cases of this very run have: it is the runner or a hand that started it. The flag of the runner is its number for a file alone,
// times the files that it has under way at a time.
const whatTheRunnerGave = (limit: number) =>
  Math.max(1, Math.round(limit / givenToABunWithAssertions)) * givenToABunWithAssertions;
const withAssertions = (limit: number) => (thisRun.byRunner ? whatTheRunnerGave(limit) : givenToABunWithAssertions);

test.for([thisRun])(
  "a case of a Bun with assertions has what the runner gives, and a case of another Bun has 120 seconds",
  ({ hasAssertions }, { task }) => {
    expect(task.timeout).toBe(hasAssertions ? withAssertions(task.timeout) : 120_000);
  },
);

test.for([thisRun])(
  "a limit of its own that is under the runner's is raised for a Bun with assertions, and holds for another Bun",
  ({ hasAssertions }, { task }) => {
    // AOT_CASES_AT_ONCE=1 has limits raised for `test` on every lane.
    const isRaised = hasAssertions || process.env.AOT_CASES_AT_ONCE === "1";
    expect(task.timeout).toBe(isRaised ? withAssertions(task.timeout) : 60_000);
  },
  60_000,
);

test.for([thisRun])(
  "a limit of its own that is above what the runner gives a file alone holds",
  (_, { task }) => {
    expect(task.timeout).toBe(600_000);
  },
  600_000,
);
