const { suite, test } = require("node:test");

// Node never invokes a skipped suite's callback, and treats { skip, todo } as a
// skip, so neither of these may print. A todo suite's callback does run.
suite("skipped suite", { skip: true }, () => {
  console.log("[suite body ran: skip-only]");
});

suite("skip wins over todo", { skip: true, todo: true }, () => {
  console.log("[suite body ran: both-flags]");
});

suite("todo suite", { todo: true }, () => {
  console.log("[suite body ran: pending-only]");
});

test("sanity", () => {});
