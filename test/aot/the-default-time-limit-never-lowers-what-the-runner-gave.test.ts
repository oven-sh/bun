// ./supported.ts and two files of ./harness raise the five seconds of bun:test to what a build needs. The runner gives a Bun
// with assertions, which builds several times slower, more than that: a default that lowered it cut cases off on that lane alone.
import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  atLeastWhatTheRunnerGave,
  givenToABunWithAssertions,
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

test("a default is raised to what the runner gave, and never lowered", () => {
  expect({
    withAssertions: atLeastWhatTheRunnerGave(120_000, true),
    withAssertionsAndALongerLimit: atLeastWhatTheRunnerGave(600_000, true),
    withoutAssertions: atLeastWhatTheRunnerGave(120_000, false),
  }).toEqual({ withAssertions: 270_000, withAssertionsAndALongerLimit: 600_000, withoutAssertions: 120_000 });
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
  const raising = raisingLimits(registers("test"), true);
  raising("a", body, 120_000);
  raising("b", body, 600_000);
  raising("c", body);
  raising("d", body, noLongerThan(5_000));
  raising("e", 60_000, body);
  raising.concurrent("f", body, 60_000);
  raising.skipIf(0)("g", body, 60_000);
  raising.each([[1, 2]])("h", body, 240_000);
  raising.concurrent.each([1])("i", body, 1_000);
  raisingLimits(registers("beforeAll"), true)(body, 120_000);
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
  const untouched = registers("test");
  expect(raisingLimits(untouched, false)).toBe(untouched);
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
