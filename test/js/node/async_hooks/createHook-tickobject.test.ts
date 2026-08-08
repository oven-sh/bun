import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// createHook().enable() mutates process-global state (the nextTick hook
// bridge), so each case runs in its own subprocess.
async function run(src: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("async_hooks.createHook TickObject lifecycle", () => {
  test("TickObject: init is paired with destroy (no unbounded map growth)", async () => {
    // The APM/CLS pattern: init -> map.set, destroy -> map.delete. Without
    // destroy, the map grows by one entry per nextTick() call.
    const { stdout, stderr, exitCode } = await run(`
    const ah = require("async_hooks");
    const m = new Map();
    ah.createHook({
      init(id, type) { m.set(id, type); },
      destroy(id) { m.delete(id); },
    }).enable();
    let n = 0;
    (function tick() {
      if (++n < 2000) process.nextTick(tick);
      else setImmediate(() => console.log("map size:", m.size));
    })();
  `);
    expect({ stdout, stderr }).toEqual({ stdout: "map size: 0\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("TickObject: before/after/destroy fire in order around the callback", async () => {
    const { stdout, stderr, exitCode } = await run(`
    const ah = require("async_hooks");
    const events = [];
    let tickId;
    ah.createHook({
      init(id, type) { if (type === "TickObject") { tickId = id; events.push("init " + id); } },
      before(id) { if (id === tickId) events.push("before " + id); },
      after(id) { if (id === tickId) events.push("after " + id); },
      destroy(id) { if (id === tickId) events.push("destroy " + id); },
    }).enable();
    process.nextTick(() => events.push("cb"));
    setImmediate(() => console.log(events.join(",")));
  `);
    expect(stderr).toBe("");
    // node order: init, before, cb, after, destroy
    expect(stdout.trim()).toMatch(/^init (\d+),before \1,cb,after \1,destroy \1$/);
    expect(exitCode).toBe(0);
  });

  test("TickObject: nested nextTick receives outer tick's asyncId as triggerAsyncId", async () => {
    const { stdout, stderr, exitCode } = await run(`
    const ah = require("async_hooks");
    const inits = [];
    ah.createHook({
      init(id, type, triggerId) { if (type === "TickObject") inits.push([id, triggerId]); },
      destroy() {},
    }).enable();
    process.nextTick(() => {
      process.nextTick(() => {});
    });
    setImmediate(() => console.log(JSON.stringify(inits)));
  `);
    expect(stderr).toBe("");
    const inits = JSON.parse(stdout.trim()) as [number, number][];
    expect(inits.length).toBe(2);
    const [outerId, outerTrigger] = inits[0];
    const [innerId, innerTrigger] = inits[1];
    expect(typeof outerId).toBe("number");
    expect(innerId).not.toBe(outerId);
    // inner was scheduled inside outer's callback, so its trigger is outer's id
    expect(innerTrigger).toBe(outerId);
    // outer was scheduled from top-level; Bun does not yet track
    // executionAsyncId outside TickObject callbacks, so just require it is
    // not the hardcoded-wrong value that would alias a real asyncId.
    expect(outerTrigger).not.toBe(outerId);
    expect(exitCode).toBe(0);
  });

  test("TickObject: after/destroy still fire when callback throws", async () => {
    const { stdout, exitCode } = await run(`
    const ah = require("async_hooks");
    const events = [];
    let tickId;
    ah.createHook({
      init(id, type) { if (type === "TickObject") { tickId = id; events.push("init"); } },
      before(id) { if (id === tickId) events.push("before"); },
      after(id) { if (id === tickId) events.push("after"); },
      destroy(id) { if (id === tickId) events.push("destroy"); },
    }).enable();
    process.on("uncaughtException", () => {});
    process.nextTick(() => { throw new Error("boom"); });
    setImmediate(() => console.log(events.join(",")));
  `);
    expect(stdout.trim()).toBe("init,before,after,destroy");
    expect(exitCode).toBe(0);
  });

  test("TickObject: destroy-only hook still fires (asyncId assigned without init)", async () => {
    const { stdout, stderr, exitCode } = await run(`
    const ah = require("async_hooks");
    let destroys = 0;
    ah.createHook({ destroy() { destroys++; } }).enable();
    for (let i = 0; i < 100; i++) process.nextTick(() => {});
    setImmediate(() => console.log("destroys:", destroys));
  `);
    expect({ stdout, stderr }).toEqual({ stdout: "destroys: 100\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("TickObject: disable() stops delivering all lifecycle events", async () => {
    const { stdout, stderr, exitCode } = await run(`
    const ah = require("async_hooks");
    let inits = 0, destroys = 0;
    const h = ah.createHook({
      init(id, type) { if (type === "TickObject") inits++; },
      destroy() { destroys++; },
    }).enable();
    process.nextTick(() => {});
    setImmediate(() => {
      h.disable();
      process.nextTick(() => {});
      setImmediate(() => console.log(JSON.stringify({ inits, destroys })));
    });
  `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ inits: 1, destroys: 1 });
    expect(exitCode).toBe(0);
  });

  test("TickObject: disable() inside the callback skips that tick's after/destroy", async () => {
    const { stdout, stderr, exitCode } = await run(`
    const ah = require("async_hooks");
    const events = [];
    const h = ah.createHook({
      before(id) { events.push("before"); },
      after(id)  { events.push("after"); },
      destroy(id){ events.push("destroy"); },
    }).enable();
    process.nextTick(() => { h.disable(); events.push("cb"); });
    setImmediate(() => console.log(events.join(",")));
  `);
    expect({ stdout, stderr }).toEqual({ stdout: "before,cb\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("TickObject: before/after hooks observe the tock's AsyncLocalStorage store", async () => {
    const { stdout, stderr, exitCode } = await run(`
    const { AsyncLocalStorage, createHook } = require("async_hooks");
    const als = new AsyncLocalStorage();
    const seen = [];
    createHook({
      before() { seen.push(["before", als.getStore()]); },
      after()  { seen.push(["after",  als.getStore()]); },
      destroy(){ seen.push(["destroy", als.getStore()]); },
    }).enable();
    als.run("X", () => process.nextTick(() => {}));
    setImmediate(() => console.log(JSON.stringify(seen)));
  `);
    expect(stderr).toBe("");
    // node: after sees the tock's store, destroy runs after the context pop.
    expect(JSON.parse(stdout.trim())).toEqual([
      ["before", "X"],
      ["after", "X"],
      ["destroy", null],
    ]);
    expect(exitCode).toBe(0);
  });
});
