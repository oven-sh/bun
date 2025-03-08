import { describe, test } from "bun:test";

test.skip("test #1", () => {
  console.log("unreachable");
});

test.skipIf(true)("test #2", () => {
  console.log("unreachable");
});

test.skipIf(1)("test #3", () => {
  console.log("unreachable");
});

test.skipIf(false)("test #4", () => {
  console.log("reachable");
});

test.skipIf(null)("test #5", () => {
  console.log("reachable");
});

describe.skip("describe #1", () => {
  test("test #6", () => {
    console.log("unreachable");
  });
});

describe.skipIf(true)("describe #2", () => {
  test("test #7", () => {
    console.log("unreachable");
  });
});

describe.skipIf(1)("describe #3", () => {
  test("test #8", () => {
    console.log("unreachable");
  });
});

describe.skipIf(false)("describe #4", () => {
  test("test #9", () => {
    console.log("reachable");
  });
});

describe.skipIf(null)("describe #5", () => {
  test("test #10", () => {
    console.log("reachable");
  });
});

test.if(false)("test #11", () => {
  console.log("unreachable");
});

test.if(null)("test #12", () => {
  console.log("unreachable");
});

test.if(true)("test #13", () => {
  console.log("reachable");
});

test.if(1)("test #14", () => {
  console.log("reachable");
});
