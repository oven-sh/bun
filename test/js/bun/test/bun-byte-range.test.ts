import { expect, test, describe } from "bun:test";
import "harness";
import path from "path";
import { readFileSync } from "fs";
import { spawnSync } from "bun";
import { bunExe, bunEnv } from "harness";

const fixture = readFileSync(path.join(import.meta.dir, "bun-byte-range-fixture.ts"), "utf8");

function runTest(startMarker: string, endMarker: string, expectedOutput: string[]) {
  const startRange = fixture.indexOf(startMarker);
  const endRange = fixture.indexOf(endMarker, startRange + startMarker.length);
  const length = endRange - startRange;
  const byteRange = `${startRange}:${length + endMarker.length}`;
  const rangedPath = path.join(import.meta.dir, "bun-byte-range-fixture.ts") + "::" + byteRange;

  const { stdout, exitCode } = spawnSync({
    cmd: [bunExe(), "test", rangedPath],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const text = stdout.toString().trim().split("\n");
  expect(text).toEqual(expectedOutput);
  expect(exitCode).toBe(0);
}

function runTestMultipleMarkers(markers: Array<[string, string]>, expectedOutput: string[]) {
  const ranges = markers.map(([startMarker, endMarker]) => {
    const startRange = fixture.indexOf(startMarker);
    const endRange = fixture.indexOf(endMarker, startRange + startMarker.length);
    const length = endRange - startRange;
    return `${startRange}:${length + endMarker.length}`;
  });
  const rangedPath = path.join(import.meta.dir, "bun-byte-range-fixture.ts") + "::" + ranges.join("::");
  console.log({ rangedPath });
  const { stdout, exitCode } = spawnSync({
    cmd: [bunExe(), "test", rangedPath],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const text = stdout.toString().trim().split("\n");
  expect(text).toEqual(expectedOutput);
  expect(exitCode).toBe(0);
}

describe("single byte range filter", () => {
  test("Test #1 and #2", () => {
    runTest("<!-- <Test [0]> -->", "<!-- <Test [1]> -->", ["beforeAll", "Test #1 ran", "Test #2 ran", "afterAll"]);
  });

  test("Test #1", () => {
    runTest("<!-- <Test [0]> -->", "Test #1 ran", ["beforeAll", "Test #1 ran", "afterAll"]);
  });

  test("Test #2", () => {
    runTest("<!-- <Test [1]> -->", "<!-- <Describe [0]> -->", ["beforeAll", "Test #2 ran", "afterAll"]);
  });

  describe("Describe block tests", () => {
    test("all tests in Describe block", () => {
      runTest("<!-- <Describe [0]> -->", "// --- Before test.only", [
        "beforeAll",
        "beforeEach",
        "Test #3 ran",
        "afterEach",
        "beforeEach",
        "Test #4 ran",
        "afterEach",
        "beforeEach",
        "Test #5 ran",
        "afterEach",
        "afterAll",
      ]);
    });

    test("Test #3 in Describe block", () => {
      runTest("<!-- <Test In Describe [0]> -->", "/// --- Before Test#2InDescribe", [
        "beforeAll",
        "beforeEach",
        "Test #3 ran",
        "afterEach",
        "afterAll",
      ]);
    });

    test("Test #4 in Describe block", () => {
      runTest("<!-- <Test In Describe [1]> -->", "--- Before Test#3InDescribe", [
        "beforeAll",
        "beforeEach",
        "Test #4 ran",
        "afterEach",
        "afterAll",
      ]);
    });

    test("Test #5 in Describe block", () => {
      runTest("<!-- <Test In Describe [2]> -->", "});", [
        "beforeAll",
        "beforeEach",
        "Test #5 ran",
        "afterEach",
        "afterAll",
      ]);
    });

    test("multiple tests in Describe block", () => {
      runTest("<!-- <Test In Describe [1]> -->", "<!-- <Test In Describe [2]> -->", [
        "beforeAll",
        "beforeEach",
        "Test #4 ran",
        "afterEach",
        "beforeEach",
        "Test #5 ran",
        "afterEach",
        "afterAll",
      ]);
    });
  });

  test("Test #6 (test.only)", () => {
    runTest("<Test [5]>", "#6 ran", ["beforeAll", "Test #6 ran", "afterAll"]);
  });

  test("Test #7 after (test.only)", () => {
    runTest("// After test.only", "#7 ran", ["beforeAll", "Test #7 ran", "afterAll"]);
  });

  test("entire file", () => {
    runTest("<Test [0]>", "Test #7 ran", [
      "beforeAll",
      "beforeEach",
      "Test #3 ran",
      "afterEach",
      "beforeEach",
      "Test #4 ran",
      "afterEach",
      "beforeEach",
      "Test #5 ran",
      "afterEach",
      "Test #1 ran",
      "Test #2 ran",
      "Test #6 ran",
      "Test #7 ran",
      "afterAll",
    ]);
  });

  test("entire file", () => {
    runTest("<Test [0]>", "Test #7 ran", [
      "beforeAll",
      "beforeEach",
      "Test #3 ran",
      "afterEach",
      "beforeEach",
      "Test #4 ran",
      "afterEach",
      "beforeEach",
      "Test #5 ran",
      "afterEach",
      "Test #1 ran",
      "Test #2 ran",
      "Test #6 ran",
      "Test #7 ran",
      "afterAll",
    ]);
  });
});

describe("multiple byte range filter", () => {
  test("Test #1 and #2", () => {
    runTestMultipleMarkers(
      [
        ["<!-- <Test [0]> -->", ");"],
        ["<!-- <Test [1]> -->", ");"],
      ],
      ["beforeAll", "Test #1 ran", "Test #2 ran", "afterAll"],
    );
  });

  test("entire file", () => {
    runTestMultipleMarkers(
      [
        ["Test #1", ");"],
        ["Test #2", ");"],
        ["Test #3", ");"],
        ["Test #4", ");"],
        ["Test #5", ");"],
        ["Test #6", ");"],
        ["Test #7", ");"],
      ],
      [
        "beforeAll",
        "beforeEach",
        "Test #3 ran",
        "afterEach",
        "beforeEach",
        "Test #4 ran",
        "afterEach",
        "beforeEach",
        "Test #5 ran",
        "afterEach",
        "Test #1 ran",
        "Test #2 ran",
        "Test #6 ran",
        "Test #7 ran",
        "afterAll",
      ],
    );
  });
});
