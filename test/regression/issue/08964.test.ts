// This test passes by simply running it. It is a regression test for issue #8964
import { describe, test, afterAll } from "bun:test";

var expected: number[] = [];
var runs: number[] = [];
var count = 0;
function makeTest(yes = false) {
  const thisCount = count++;
  if (yes) expected.push(thisCount);
  test("test " + thisCount, () => {
    runs.push(thisCount);
  });
}

describe("Outer", () => {
  describe.only("Inner", () => {
    describe("Inside Only", () => {
      makeTest(true);
    });
    makeTest(true);

    expected.push(997, 998, 999);
    test.each([997, 998, 999])("test %i", i => {
      runs.push(i);
    });
  });

  test.each([2997, 2998, 2999])("test %i", i => {
    runs.push(i);
  });

  describe("Inner #2", () => {
    makeTest();
    describe("Inside Inner #2", () => {
      makeTest();
      describe.only("Inside Inner #2 Only", () => {
        makeTest(true);
      });
    });
  });
  makeTest();
});

afterAll(() => {
  if (runs.length !== expected.length) {
    console.error(new Error("Test count mismatch"));
    process.exit(1);
  }
  if (runs.sort().join(",") !== expected.sort().join(",")) {
    console.error(new Error("Test order mismatch"));
    process.exit(1);
  }
});
