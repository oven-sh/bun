const { suite, test } = require("node:test");

// Node never invokes a skipped suite's callback, and treats { skip, todo } as a
// skip, so neither of these may print. A todo suite's callback does run.
suite("skipped suite", { skip: true }, () => {
  console.log("SKIPPED SUITE BODY RAN");
});

suite("skip wins over todo", { skip: true, todo: true }, () => {
  console.log("SKIP+TODO SUITE BODY RAN");
});

suite("todo suite", { todo: true }, () => {
  console.log("TODO SUITE BODY RAN");
});

test("sanity", () => {});
