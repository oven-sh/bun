const test = require("node:test");

// bun only: `bun test --retry 1` runs a failed test again. The second attempt
// is a new test: its subtests run again, and the failures of the first attempt
// do not count for it.
const events = [];
let attempt = 0;

test("subtests that fail on the first attempt only", { tags: ["retried"] }, async t => {
  const n = ++attempt;
  events.push(`attempt ${n} has the tags ${t.tags}`);
  t.after(async () => {
    await t.test("from the after hook", () => {
      events.push(`hook subtest ${n}`);
      if (n === 1) throw new Error("from the hook subtest of attempt 1");
    });
  });
  await t.test("from the body", () => {
    events.push(`body subtest ${n}`);
    if (n === 1) throw new Error("from the body subtest of attempt 1");
  });
});

process.on("exit", () => console.log("EVENTS " + JSON.stringify(events)));
