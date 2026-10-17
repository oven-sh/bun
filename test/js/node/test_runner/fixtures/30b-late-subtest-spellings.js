const test = require("node:test");

// The other ways to create a test after its parent finished. Each promise is
// created inside the parent, so that its continuation runs in the context of
// that parent on Node too.
const events = [];
let releaseTest;
let releaseSuite;
let finishedSubtest;

test("parent", async t => {
  new Promise(resolve => {
    releaseTest = resolve;
  }).then(() => {
    test("late through test()", () => {});
    test.describe("late suite", () => {
      events.push("callback of late suite");
      test("child of late suite", () => events.push("body of child of late suite"));
    });
  });
  await t.test("subtest", subtest => {
    finishedSubtest = subtest;
  });
});

test("parent of an inline suite", async () => {
  await test.describe("inline suite", () => {
    new Promise(resolve => {
      releaseSuite = resolve;
    }).then(() => {
      test("late in a finished suite", () => events.push("body of late in a finished suite"));
    });
    test("child", () => {});
  });
});

test("creates the late tests", async () => {
  releaseTest();
  releaseSuite();
  finishedSubtest.test("late on a finished subtest", () => {});
  // The continuations of the two promises run before this test finishes.
  await new Promise(resolve => setImmediate(resolve));
});

test("a later test still runs", () => {});

process.on("exit", () => console.log("EVENTS " + JSON.stringify(events)));
