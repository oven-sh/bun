import { test, describe } from "bun:test";

test("test #1", () => {
  console.error("unreachable");
});

test.only("test #2", () => {
  console.error("reachable");
});

test("test #3", () => {
  console.error("unreachable");
});

test.skip("test #4", () => {
  console.error("unreachable");
});

test.todo("test #5");

describe("describe #1", () => {
    test("test #6", () => {
        console.error("unreachable");
    });
    test.only("test #7", () => {
        console.error("reachable");
    });
});

describe.only("describe #2", () => {
    test("test #8", () => {
        console.error("reachable");
    });
    test.skip("test #9", () => {
        console.error("unreachable");
    });
    test.only("test #10", () => {
        console.error("reachable");
    });
});

describe("describe #3", () => {
    describe("describe #4", () => {
        test.only("test #11", () => {
            console.error("reachable");
        });
    });
});
