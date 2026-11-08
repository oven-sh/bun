// Run with `bun test --retry 1 --timeout 1`. bun:test's own timeout ends the first attempt while its body is
// still waiting, and it does not tell node:test. That attempt never runs its `t.after` hooks or resets its mocks,
// so the second attempt stays on the same node and does both when it ends. The second test has no timeout.
const { test } = require("node:test");

const log = (...args) => console.log("OBS", ...args);
const realSetTimeout = globalThis.setTimeout;
const target = { method: () => "real" };
let attempts = 0;

test("its first attempt hangs", async t => {
  const n = ++attempts;
  t.after(() => log(`t.after of attempt ${n}`));
  if (n === 2) throw new Error("the second attempt fails as well");
  t.mock.method(target, "method", () => "mocked");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await new Promise(() => {});
});

test("next", { timeout: Infinity }, () => {
  log("next:", `method=${target.method()}`, `setTimeout is real=${globalThis.setTimeout === realSetTimeout}`);
});
