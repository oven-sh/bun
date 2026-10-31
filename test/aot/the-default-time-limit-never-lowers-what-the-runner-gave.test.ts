// ./supported.ts and two files of ./harness raise the five seconds of bun:test to what a build needs. The runner gives a Bun
// with assertions, which builds several times slower, more than that: a default that lowered it cut cases off on that lane alone.
import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atLeastWhatTheRunnerGave, givenToABunWithAssertions } from "./harness/default-timeout";
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

test("no file of the harness sets the default by itself", () => {
  for (const file of ["supported.ts", "harness/commands.ts", "harness/shared-builds.ts"])
    expect({ file, sets: readFileSync(join(import.meta.dir, file), "utf8").includes("setDefaultTimeout") }).toEqual({
      file,
      sets: false,
    });
});

test.skipIf(!isASAN && !isDebug)(
  "a case of a Bun with assertions outlasts the 120 seconds of the other lanes",
  async () => {
    await Bun.sleep(125_000);
  },
);
