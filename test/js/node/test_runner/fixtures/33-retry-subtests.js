const test = require("node:test");

// bun only: `bun test --retry 1` runs the test again after it fails. The second
// attempt is a new test, so its subtest runs too.
const events = [];
let attempt = 0;

test("fails on the first attempt", async t => {
  attempt++;
  events.push(`attempt ${attempt}`);
  await t.test("subtest", () => {
    events.push(`sub ${attempt}`);
  });
  if (attempt === 1) throw new Error("first attempt");
});

process.on("exit", () => console.log("EVENTS " + JSON.stringify(events)));
