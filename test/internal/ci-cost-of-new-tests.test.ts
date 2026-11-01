import { expect, test } from "bun:test";
import { costOfNewTests } from "../../scripts/ci-cost-of-new-tests";

const durations = {
  "js/a.test.ts": 100,
  "js/b.test.ts": 200,
  "js/c.test.ts": 300,
  "js/d.test.ts": 400,
  "js/e.test.ts": 500,
  "builds/one.test.ts": 60_000,
  "builds/two.test.ts": 90_000,
  "builds/three.test.ts": 240_000,
  "builds/programs/a.js": 100,
  "builds/programs/b.js": 100,
  "builds/programs/c.js": 100,
  "builds/programs/d.js": 100,
  "builds/few/one.test.ts": 1_000,
  "builds/few/two.test.ts": 1_000,
};
const costOf = costOfNewTests(durations);

test("a new file counts as the mean of the files beside it", () => {
  expect(costOf("builds/new.test.ts")).toBe(130_000);
  expect(costOf("js/new.test.ts")).toBe(300);
  expect(costOf("builds/programs/new.js")).toBe(100);
});

test("files further down do not count", () => {
  expect(costOf("builds/new.test.ts")).toBeGreaterThan(60_000);
});

test("a folder with nothing or little to judge by leaves it to the folder above", () => {
  expect(costOf("builds/new-folder/new.test.ts")).toBe(130_000);
  expect(costOf("builds/new-folder/deeper/new.test.ts")).toBe(130_000);
  expect(costOf("builds/few/new.test.ts")).toBe(130_000);
});

test("where no folder above tells, the median of the table", () => {
  expect(costOf("elsewhere/new.test.ts")).toBe(400);
  expect(costOf("new.test.ts")).toBe(400);
  expect(costOfNewTests({})("new.test.ts")).toBe(100);
});

test("a path of Windows", () => {
  expect(costOf("builds\\new.test.ts")).toBe(130_000);
});
