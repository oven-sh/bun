// Node's mock timers clamp only the upper bound, so a zero-delay interval
// re-fires inside a single tick()/runAll() until its callback clears it. Real
// timers clamp to 1ms. Clamping here would diverge: node fires the interval
// below 4 times on tick(1), a `delay >= 1` clamp fires it twice. Both numbers
// were taken from the node v26.3.0 binary.
const assert = require("node:assert");
const { test } = require("node:test");

test("setInterval(fn, 0) re-fires within one tick until cleared", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const interval = setInterval(() => {
    if (++calls > 3) clearInterval(interval);
  }, 0);
  t.mock.timers.tick(1);
  assert.strictEqual(calls, 4);
});

test("runAll() drains a zero-delay interval that clears itself", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const interval = setInterval(() => {
    if (++calls > 1) clearInterval(interval);
  }, 0);
  t.mock.timers.runAll();
  assert.strictEqual(calls, 2);
});

test("setTimeout(fn, 0) still fires once on tick(0)", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  setTimeout(() => calls++, 0);
  t.mock.timers.tick(0);
  assert.strictEqual(calls, 1);
});
