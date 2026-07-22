// A failing collection-phase test bumps the VM's unhandled-error counter, which
// makes is_event_loop_alive() return false. The node:test drain must keep
// spinning on the ref'd timer regardless so the late test still runs.
const { test } = require("node:test");
const assert = require("node:assert");

test("sync failing", () => assert.fail("sync is red"));

setTimeout(() => {
  test("late failing", () => assert.fail("late is red"));
}, 50);
