const { test, after, afterEach } = require("node:test");

// node-test.test.ts runs this file with a short `--timeout`. That timeout ends
// H, whose afterEach hook then never settles. bun:test must still move on to
// the next test, one more timeout later.
const log = [];

afterEach(t => {
  log.push(`afterEach(${t.name})`);
  if (t.name === "H") return new Promise(() => {});
});

test("H", () => new Promise(() => {}));

test("I", { timeout: Infinity }, () => {
  log.push("I");
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
