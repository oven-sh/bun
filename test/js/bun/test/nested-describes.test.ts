import { describe, expect, test } from "bun:test";

/*
In this test we want the tests to print out the following on a success.
Each success / fail should show the path of describe and test scopes

✓ outer most describe > mid describe 1 > inner most describe 1 > first
✓ outer most describe > mid describe 1 > inner most describe 2 > second
✓ outer most describe > mid describe 2 > inner most describe 3 > first

@TODO add testing for this, would require to read the test console output
*/

describe("outer most describe", () => {
  describe("mid describe 1", () => {
    describe("inner most describe 1", () => {
      test("first", () => {
        expect(5).toEqual(5);
      });
    });
    describe("inner most describe 2", () => {
      test("second", () => {
        expect(5).toEqual(5);
      });
    });
  });
  describe("mid describe 2", () => {
    describe("inner most describe 3", () => {
      test("third", () => {
        expect(5).toEqual(5);
      });
    });
  });
});

// Regression test for #5738
// Tests that test(1), describe(test(2)), test(3) run in order 1,2,3 instead of 2,1,3
test("nested describe hooks run in correct order", async () => {
  const { bunEnv, bunExe, normalizeBunSnapshot } = await import("harness");

  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/5738.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    1 - beforeAll
    1 - beforeEach
    1 - test
    1 - afterEach
    2 - beforeAll
    1 - beforeEach
    2 - beforeEach
    2 - test
    2 - afterEach
    1 - afterEach
    2 - afterAll
    1 - afterAll"
  `);
  expect(exitCode).toBe(0);
});
