// ./supported.ts and two files of ./harness raise the five seconds of bun:test to what a build needs. The runner gives a Bun
// with assertions, which builds several times slower, more than that: a default that lowered it cut cases off on that lane alone.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  atLeastWhatTheRunnerGave,
  givenToABunWithAssertions,
  isGivenThatMuchByTheRunner,
  noLongerThan,
  raisingLimits,
} from "./harness/default-timeout";
import { test } from "./supported";

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
    withAssertionsAndALongerLimit: atLeastWhatTheRunnerGave(600_000, true, false),
    withoutAssertions: atLeastWhatTheRunnerGave(120_000, false, false),
  }).toEqual({ withAssertions: 270_000, withAssertionsAndALongerLimit: 600_000, withoutAssertions: 120_000 });
  expect({
    withAssertions: atLeastWhatTheRunnerGave(120_000, true, true),
    withAssertionsAndALongerLimit: atLeastWhatTheRunnerGave(600_000, true, true),
    withoutAssertions: atLeastWhatTheRunnerGave(120_000, false, true),
  }).toEqual({ withAssertions: undefined, withAssertionsAndALongerLimit: 600_000, withoutAssertions: 120_000 });
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

// With small numbers, so that it runs on every lane: whose number it is that ends a case.
test.each([
  ["under the runner its flag ends a case", "/tmp", ["timed out after 700ms", "timed out after 700ms"], " 2 fail"],
  ["by hand the harness's number holds", undefined, [], " 0 fail"],
])("%s", async (_, variable, cuts, count) => {
  const harness = JSON.stringify(join(import.meta.dir, "harness", "default-timeout"));
  using dir = tempDir("aot-whose-limit", {
    "whose.test.ts": `
import { test as testOfBun } from "bun:test";
import { raiseDefaultTimeout, raisingLimits } from ${harness};
const byRunner = process.env.TEST_TMPDIR !== undefined;
raiseDefaultTimeout(120_000, true, byRunner);
const test = raisingLimits(testOfBun, true, undefined, byRunner);
test("no limit of its own", async () => { await Bun.sleep(1_500); });
test("a limit of its own", async () => { await Bun.sleep(1_500); }, 170_000);
`,
  });
  const env: Record<string, string | undefined> = { ...bunEnv, NO_COLOR: "1", TEST_TMPDIR: variable };
  if (variable === undefined) delete env.TEST_TMPDIR;
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=700", "./whose.test.ts"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect((stdout + stderr).match(/timed out after \d+ms/g) ?? []).toEqual(cuts);
  expect(stdout + stderr).toContain(count);
});

// ./supported.ts stands in front of what raises limits. AOT_CASES_AT_ONCE=1 has limits raised for `test` on every lane.
test("every form of test can be declared where limits are raised", async () => {
  using dir = tempDir("aot-forms-of-test", {
    "forms.test.ts": `
import { describe, test, testOneByOne } from ${JSON.stringify(join(import.meta.dir, "supported"))};
test("plain", () => {}, 1000);
test.each([1, 2])("each %d", () => {}, 1000);
test.skipIf(false)("skipIf", () => {}, 1000);
test.if(true)("if", () => {}, 1000);
test.todoIf(false)("todoIf", () => {}, 1000);
test.skipIf(false).each([1])("skipIf each %d", () => {}, 1000);
test.concurrent.each([1])("concurrent each %d", () => {}, 1000);
test.serial.each([1])("serial each %d", () => {}, 1000);
testOneByOne.each([1])("one by one each %d", () => {}, 1000);
testOneByOne.skipIf(false)("one by one skipIf", () => {}, 1000);
describe.each([1])("describe each %d", () => test("inside", () => {}));
describe.skipIf(false)("describe skipIf", () => test("inside", () => {}));
`,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", "./forms.test.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1", AOT_CASES_AT_ONCE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect((stdout + stderr).match(/^ *\d+ (?:pass|fail|skip|todo)$/gm)?.map(line => line.trim())).toEqual([
    "13 pass",
    "0 fail",
  ]);
});

test("no file here sets a default under the runner's number by itself", () => {
  const lower: string[] = [];
  for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: import.meta.dir })) {
    if (file.includes("node_modules")) continue;
    const text = readFileSync(join(import.meta.dir, file), "utf8");
    for (const [, limit] of text.matchAll(/^ *setDefaultTimeout\(([\d_]+)\)/gm))
      if (Number(limit.replaceAll("_", "")) < givenToABunWithAssertions) lower.push(`${file}: ${limit}`);
  }
  expect(lower).toEqual([]);
});

test("no test file here hands a limit of its own to what it took straight from bun:test", () => {
  const limit = /^\s*\},\s*[\d_]+,?\s*\);?\s*$|^\s*[\d_]{4,},?\s*\n\s*\);|\),\s*[\d_]{4,}\s*\);\s*$/m;
  const direct: string[] = [];
  for (const file of new Bun.Glob("**/*.test.ts").scanSync({ cwd: import.meta.dir })) {
    if (file.includes("node_modules") || /^parallel[\\/]/.test(file)) continue;
    const text = readFileSync(join(import.meta.dir, file), "utf8").replaceAll("\r\n", "\n");
    // Behind the first statement that imports nothing may stand the text of another test file.
    const [imports] = /^(?:(?:import\b[^;]*;|\/\/.*|\/\*[^]*?\*\/)?[ \t]*\n)*/.exec(text)!;
    const names = /import\s*\{([^}]*)\}\s*from\s*"bun:test";/.exec(imports)?.[1] ?? "";
    if (/\b(?:test|it|beforeAll|afterAll|beforeEach|afterEach)\b/.test(names) && limit.test(text)) direct.push(file);
  }
  expect(direct).toEqual([]);
});

test.skipIf(!isASAN && !isDebug)(
  "a case of a Bun with assertions outlasts the 120 seconds of the other lanes",
  async () => {
    await Bun.sleep(125_000);
  },
);

test.skipIf(!isASAN && !isDebug)(
  "a case of a Bun with assertions outlasts a limit of its own that is under the runner's",
  async () => {
    await Bun.sleep(3_000);
  },
  1_000,
);
