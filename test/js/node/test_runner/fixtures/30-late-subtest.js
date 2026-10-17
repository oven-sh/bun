const test = require("node:test");

// A subtest that is created after its parent finished. Node fails it with
// ERR_TEST_FAILURE (failureType "parentAlreadyFinished") and reports it at the
// top level. t.test() still returns a promise, and the promise does not reject.
const events = [];
let finished;

test("parent", t => {
  finished = t;
});

test("creates subtests on the finished parent", () => {
  const late = [
    finished.test("late", () => events.push("body of late")),
    finished.test("late skip", { skip: true }, () => events.push("body of late skip")),
    finished.test("late todo", { todo: true }, () => events.push("body of late todo")),
    finished.test("late, created last", () => events.push("body of late, created last")),
  ];
  for (const promise of late) {
    promise.then(
      value => events.push(`resolved ${value}`),
      error => events.push(`rejected ${error}`),
    );
  }
});

test("a later test still runs", () => {
  events.push("a later test");
});

process.on("exit", () => console.log("EVENTS " + JSON.stringify(events)));
