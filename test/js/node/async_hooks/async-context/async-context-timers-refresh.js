process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const assert = require("assert");

// `timeout.refresh()` on a timer whose callback already ran reactivates it and,
// like Node's `initAsyncResource`, re-captures the async context active at the
// `refresh()` call site. A still-pending timer keeps its creation context.
const als = new AsyncLocalStorage();

async function main() {
  const seen = [];
  let onFire;
  const fired = () => new Promise(resolve => (onFire = resolve));

  let t;
  let refreshFromInsideCallback = false;
  const callback = () => {
    seen.push(als.getStore() ?? null);
    if (refreshFromInsideCallback) {
      refreshFromInsideCallback = false;
      // The callback is still running, so the timer is not destroyed yet and
      // this refresh() must not re-bind it (Node keeps the existing context too).
      assert.strictEqual(t._destroyed, false);
      als.run("inside", () => t.refresh());
    }
    onFire();
  };

  let wait = fired();
  als.run("creator", () => {
    t = setTimeout(callback, 1);
  });
  // Refreshing a timer that has not fired yet does not re-bind it.
  als.run("early", () => t.refresh());
  await wait;

  // The callback already ran, so refresh() re-captures the caller's context.
  assert.strictEqual(t._destroyed, true);
  wait = fired();
  als.run("refresher", () => t.refresh());
  await wait;

  // Outside of any context, refresh() drops the previously captured context.
  assert.strictEqual(t._destroyed, true);
  wait = fired();
  t.refresh();
  await wait;

  // And a later refresh() binds the (previously unbound) callback again. That fire
  // refreshes itself from inside its own callback, which must keep the same context.
  assert.strictEqual(t._destroyed, true);
  refreshFromInsideCallback = true;
  wait = fired();
  als.run("again", () => t.refresh());
  await wait;

  wait = fired();
  await wait;

  assert.deepStrictEqual(seen, ["creator", "refresher", null, "again", "again"]);
}

main().then(
  () => process.exit(0),
  err => {
    console.error("FAIL: timeout.refresh() async context", err);
    process.exit(1);
  },
);
