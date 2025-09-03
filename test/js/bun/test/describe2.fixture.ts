import { describe, test, expect } from "bun:test";

console.log("enter");

describe("describe 1", () => {
  console.log("describe 1");
  describe("describe 2", () => {
    console.log("describe 2");
  });
  describe("describe 3", () => {
    console.log("describe 3");
  });
});
describe("describe 4", () => {
  console.log("describe 4");
  describe("describe 5", () => {
    console.log("describe 5");
    describe("describe 6", () => {
      console.log("describe 6");
    });
    describe("describe 7", () => {
      console.log("describe 7");
    });
  });
});
describe("describe 8", () => {
  console.log("describe 8");
});
describe.each([1, 2, 3, 4])("describe each %s", i => {
  console.log(`describe each ${i}`);
  describe.each(["a", "b", "c", "d"])("describe each %s", j => {
    console.log(`describe each ${i}${j}`);
  });
});

describe("failed describe", () => {
  console.log("failed describe");
  test("in failed describe", () => {
    console.log("this test should not run because it is in a failed describe");
  });
  describe("failed describe inner 1", () => {
    console.log("failed describe inner 1");
    test("in failed describe inner 1", () => {
      console.log("this test should not run because it is in a failed describe inner 1");
    });
  });
  describe("failed describe inner 2", () => {
    console.log("failed describe inner 2");
  });
  throw "uh oh";
});

// == async ==

describe("async describe 1", async () => {
  console.log("async describe 1");
  describe("async describe 2", async () => {
    console.log("async describe 2");
  });
  describe("async describe 3", async () => {
    console.log("async describe 3");
  });
});
describe("async describe 4", async () => {
  console.log("async describe 4");
  describe("async describe 5", async () => {
    console.log("async describe 5");
  });
  describe("async describe 6", async () => {
    console.log("async describe 6");
  });
});

describe("actual tests", () => {
  test("more functions called after delayed done", done => {
    process.nextTick(() => {
      done();
      throw "uh oh";
    });
  });
  test("another test", async () => {
    expect(true).toBe(true);
  });
});

// == concurrent ==

describe.concurrent("concurrent describe 1", () => {
  test("item 1", async () => {});
  test("item 2", async () => {});
  test("snapshot in concurrent group", async () => {
    // this is a technical limitation of not using async context. in the future, we could allow thisa
    try {
      expect("hello").toMatchSnapshot();
    } catch (e) {
      throw (e as Error).message;
    }
  });
});

// == other stuff ==

test("LINE 66", () => console.log("LINE 66"));
test.skip("LINE 67", () => console.log("LINE 67"));
test.failing("LINE 68", () => console.log("LINE 68"));
test.todo("LINE 69", () => console.log("LINE 69"));
test.each([1, 2, 3])("LINE 70", item => console.log("LINE 70", item));
test.if(true)("LINE 71", () => console.log("LINE 71"));
test.skipIf(true)("LINE 72", () => console.log("LINE 72"));
test.concurrent("LINE 74", () => console.log("LINE 74"));

// == timeout ==
test("this test times out", () => Bun.sleep(100), 1);
test("this test times out with done", done => {}, 1);

console.log("exit");
