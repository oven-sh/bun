// node-test.test.ts runs this with `--timeout 10`: a before() or after() hook
// with its own timeout is not ended at the runner default.
const { after, before, describe, test } = require("node:test");
const assert = require("node:assert");

const ran = [];
const slow = name => async () => {
  await new Promise(resolve => setTimeout(resolve, 50));
  ran.push(name);
};

before(slow("file before"), { timeout: 3000 });
after(
  async () => {
    await slow("file after")();
    console.log(ran.join(", "));
  },
  { timeout: Infinity },
);

describe("suite", () => {
  before(slow("suite before"), { timeout: Infinity });
  after(slow("suite after"), { timeout: 3000 });

  test("runs after both before hooks", { timeout: 3000 }, () => {
    assert.deepStrictEqual(ran, ["file before", "suite before"]);
  });
});
