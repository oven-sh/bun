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
