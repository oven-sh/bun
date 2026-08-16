// A parent waits for its inline subtests only until the first time every
// subtest created so far has finished (Node's subtestsPromise). A subtest that
// is still unfinished when the parent's own result is in, and was started after
// that point, fails with cancelledByParent and fails the parent, instead of
// being waited for. node-test.test.ts asserts the exact counts and the markers
// printed below; `node --test` on v26.3.0 fails and passes the same tests.
const { test, describe } = require("node:test");

const never = () => new Promise(() => {});
const tick = () => new Promise(resolve => setImmediate(resolve));

// ---- Cancelled (these tests fail) -------------------------------------------

test("FAIL: an unawaited subtest started after an earlier one settled is cancelled", async t => {
  await t.test("first", () => {});
  t.test("slow", async st => {
    // Node runs the after hooks of a cancelled subtest right away, with the
    // cancellation visible as its error.
    st.after(() => console.log(`SLOW_AFTER_HOOK failureType=${st.error?.failureType} passed=${st.passed}`));
    await never();
  });
});

test("FAIL: subtests queued behind the cancelled one are cancelled without running", async t => {
  await t.test("first", () => {});
  t.test("slow", never);
  t.test("queued test", () => console.log("QUEUED_TEST_RAN"));
  describe("queued suite", () => {
    test("queued suite child", () => console.log("QUEUED_SUITE_CHILD_RAN"));
  });
});

test("FAIL: a parent that throws cancels its in-flight subtest too", async t => {
  t.test("in flight", async st => {
    st.after(() => console.log(`IN_FLIGHT_AFTER_HOOK failureType=${st.error?.failureType}`));
    await never();
  });
  throw new Error("parent body failed");
});

test("FAIL: a skipped subtest settles the first batch like any other", async t => {
  await t.test("skipped", { skip: true }, () => {});
  t.test("slow", never);
});

// ---- Waited for (these tests pass) ------------------------------------------

test("PASS: a sync parent waits for an unawaited subtest", t => {
  t.test("slow", async () => {
    await tick();
    console.log("SYNC_PARENT_SUBTEST_FINISHED");
  });
});

test("PASS: an async parent waits for its first unawaited subtest", async t => {
  t.test("slow", async () => {
    await tick();
    console.log("ASYNC_PARENT_SUBTEST_FINISHED");
  });
});

test("PASS: every subtest of the first batch is waited for", async t => {
  t.test("a", tick);
  t.test("b", async () => {
    await tick();
    console.log("SECOND_OF_BATCH_FINISHED");
  });
});

test("PASS: a later subtest that finishes before the parent does is not cancelled", async t => {
  await t.test("first", () => {});
  t.test("second", tick);
  await tick();
  await tick();
});

test("PASS: a cancelled todo subtest does not fail its parent", async t => {
  await t.test("first", () => {});
  t.test("pending todo", { todo: true }, never);
});

// Node starts a subtest's body inside the t.test() call, so a forgotten await
// on a subtest that needs no timer or I/O to finish is harmless there.
test("PASS: a later unawaited subtest with a sync body still completes", async t => {
  await t.test("first", () => {});
  t.test("second", () => console.log("LATER_SYNC_SUBTEST_RAN"));
});

test("PASS: a later unawaited subtest that only awaits microtasks still completes", async t => {
  await t.test("first", () => {});
  t.test("second", async () => {
    await null;
    console.log("LATER_MICROTASK_SUBTEST_FINISHED");
  });
});

// Node cancels in postRun(), after the parent's own after hooks: a straggler
// that finishes while they run is not cancelled.
test("PASS: a later subtest finishing during the parent's after hook is not cancelled", async t => {
  t.after(async () => {
    await tick();
    await tick();
  });
  await t.test("first", () => {});
  t.test("second", async () => {
    await tick();
    console.log("STRAGGLER_FINISHED_DURING_AFTER_HOOK");
  });
});
