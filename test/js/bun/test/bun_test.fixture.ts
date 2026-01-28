import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";

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
  throw "failed describe: error";
});

// == async ==

describe("async describe 1", async () => {
  console.log("async describe 1");
  describe("async describe 2", async () => {
    console.log("async describe 2");
  });
  describe("async describe 3", async () => {
    console.log("async describe 3");
    await Bun.sleep(1);
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

// == done ==

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
  test.failing("snapshot in concurrent group", async () => {
    console.log("snapshot in concurrent group");
    // this is a technical limitation of not using async context. in the future, we could allow thisa
    expect("hello").toMatchSnapshot();
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
test.todo("failing todo passes", () => {
  throw "this error would be shown if the --todo flag was passed";
});
test.failing("failing failing passes", () => {
  throw "this error is not shown";
});

// == timeout ==
test("this test times out", () => Bun.sleep(100), 1);
test("this test times out with done", done => {}, 1);

// == each ==
test.each([
  [1, 2, 3],
  [2, 3, 5],
  [3, 4, 7],
])("addition %i + %i = %i", (a, b, expected) => {
  console.log(`adding: ${a} + ${b} = ${expected}`);
  expect(a + b).toBe(expected);
});

// == expect.assertions/hasAssertions ==
test.failing("expect.assertions", () => {
  // this test should fail despite being 'test.failing', matching existing behaviour
  // we might consider changing this.
  expect.assertions(1);
  expect.hasAssertions(); // make sure this doesn't overwrite the assertions count, matching existing behaviour
});

test.concurrent.failing("expect.assertions not yet supported in concurrent tests", () => {
  expect.hasAssertions(); // this call will fail because expect.hasAssertions is not yet supported in concurrent tests
  expect(true).toBe(true);
});
test.concurrent.failing("expect.assertions not yet supported in concurrent tests", () => {
  expect.assertions(1); // this call will fail because expect.assertions is not yet supported in concurrent tests
  expect(true).toBe(true);
});

test("expect.assertions works", () => {
  expect.assertions(2);
  expect(true).toBe(true);
  expect(true).toBe(true);
});

test("expect.assertions combined with timeout", async () => {
  expect.assertions(1);
  await Bun.sleep(100);
}, 1);

// === timing edge case ===
test.failing("more functions called after delayed done", done => {
  process.nextTick(() => {
    done();
    expect(true).toBe(false);
  });
});
test("another test", async () => {});

// === timing failure case. if this is fixed in the future, update the test ===
test("misattributed error", () => {
  setTimeout(() => {
    expect(true).toBe(false);
  }, 10);
});
test.failing("passes because it catches the misattributed error", done => {
  setTimeout(done, 50);
});

// === hooks ===
describe("hooks", () => {
  beforeAll(() => {
    console.log("beforeAll1");
  });
  beforeEach(async () => {
    console.log("beforeEach1");
  });
  afterAll(done => {
    console.log("afterAll1");
    done();
  });
  afterEach(done => {
    console.log("afterEach1");
    Promise.resolve().then(done);
  });
  afterEach(() => {
    console.log("afterEach2");
  });
  afterAll(() => {
    console.log("afterAll2");
  });
  beforeAll(async () => {
    console.log("beforeAll2");
  });
  beforeEach(() => {
    console.log("beforeEach2");
  });
  test("test1", () => {
    console.log("test1");
  });
  test("test2", () => {
    console.log("test2");
  });
});

// === done parameter ===
describe("done parameter", () => {
  test("instant done", done => {
    done();
  });
  test("delayed done", done => {
    setTimeout(() => {
      done();
    }, 1);
  });
  describe("done combined with promise", () => {
    let completion = 0;
    beforeEach(() => (completion = 0));
    afterEach(() => {
      if (completion != 2) throw "completion is not 2";
    });
    test("done combined with promise, promise resolves first", async done => {
      setTimeout(() => {
        completion += 1;
        done();
      }, 200);
      await Bun.sleep(50);
      completion += 1;
    });
    test("done combined with promise, done resolves first", async done => {
      setTimeout(() => {
        completion += 1;
        done();
      }, 50);
      await Bun.sleep(200);
      completion += 1;
    });
    test("fails when completion is not incremented", () => {});
  });
  describe("done combined with promise error conditions", () => {
    test("both error and done resolves first", async done => {
      done("test error"); // this error is ignored because
      throw "promise error";
    });
    test("done errors only", async done => {
      done("done error");
    });
    test("promise errors only", async done => {
      setTimeout(() => done(), 10);
      throw "promise error";
    });
  });
  test("second call of done callback ignores triggers error", done => {
    done();
    done("uh oh!");
  });
});

test.failing("microtasks and rejections are drained after the test callback is executed", () => {
  Promise.reject(new Error("uh oh!"));
});

describe("after inside test", () => {
  afterAll(() => {
    console.log("after-inside-test: afterAll3");
  });
  afterEach(() => {
    console.log("after-inside-test: afterEach3");
  });

  test("the test 1", () => {
    afterEach(() => {
      console.log("after-inside-test: afterEach1");
    });
    afterAll(() => {
      console.log("after-inside-test: afterAll1");
    });
    console.log("after-inside-test: the test 1");
  });
  test("the test 2", () => {
    afterEach(() => {
      console.log("after-inside-test: afterEach2");
    });
    afterAll(() => {
      console.log("after-inside-test: afterAll2");
    });
    console.log("after-inside-test: the test 2");
  });
});

test("beforeEach inside test fails", () => {
  expect(() => beforeEach(() => {})).toThrowErrorMatchingInlineSnapshot(
    `"Cannot call beforeEach() inside a test. Call it inside describe() instead."`,
  );
});

console.log("exit");
