// Run with `bun test --retry 1`. Every test here fails its first attempt and passes its second one. bun:test
// calls the same test() callback again for a retry, so nothing the first attempt did may reach the second.
const { test } = require("node:test");
const assert = require("node:assert");

const log = (...args) => console.log("OBS", ...args);
const attempts = {};
const attempt = t => (attempts[t.name] = (attempts[t.name] ?? 0) + 1);

const signals = [];
test("t.signal", t => {
  signals.push(t.signal);
  const previous = signals.at(-2);
  log(`t.signal: attempt ${attempt(t)}`, "aborted=" + t.signal.aborted, "previous attempt aborted=" + previous?.aborted);
  assert.ok(previous, "the first attempt fails");
});

test("t.plan()", t => {
  t.plan(1);
  t.assert.strictEqual(attempt(t), 2, "the first attempt fails");
});

let childRuns = 0;
test("subtests", async t => {
  const n = attempt(t);
  await t.test("child", () => {
    childRuns++;
    assert.strictEqual(n, 2, "the subtest of the first attempt fails");
  });
  log(`subtests: attempt ${n}`, "child runs=" + childRuns);
});

let afterRuns = 0;
test("t.after()", t => {
  const n = attempt(t);
  t.after(() => log(`t.after(): hook of attempt ${n}`, "runs=" + ++afterRuns));
  assert.strictEqual(n, 2, "the first attempt fails");
});

// The first attempt times out, and its body goes on while the second attempt is running.
const goOn = Promise.withResolvers();
const went = Promise.withResolvers();
test("timeout", { timeout: 1 }, async t => {
  const n = attempt(t);
  t.signal.addEventListener("abort", () => log(`timeout: abort event of attempt ${n}`));
  if (n === 1) {
    await goOn.promise;
    log("timeout: the body of attempt 1 goes on", "aborted=" + t.signal.aborted);
    went.resolve();
    throw new Error("a late error");
  }
  goOn.resolve();
  await went.promise;
  log("timeout: attempt 2", "aborted=" + t.signal.aborted);
});
