import assert from "assert";
import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { bunEnv, bunExe } from "harness";

test("node async_hooks.AsyncLocalStorage enable disable", async done => {
  const asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

  asyncLocalStorage.run(new Map(), () => {
    asyncLocalStorage.getStore()!.set("foo", "bar");
    process.nextTick(() => {
      assert.strictEqual(asyncLocalStorage.getStore()!.get("foo"), "bar");
      process.nextTick(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
      });

      asyncLocalStorage.disable();
      assert.strictEqual(asyncLocalStorage.getStore(), undefined);

      // Calls to exit() should not mess with enabled status
      asyncLocalStorage.exit(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
      });
      assert.strictEqual(asyncLocalStorage.getStore(), undefined);

      process.nextTick(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
        asyncLocalStorage.run(new Map().set("bar", "foo"), () => {
          assert.strictEqual(asyncLocalStorage.getStore()!.get("bar"), "foo");
          done();
        });
      });
    });
  });
});

test("node async_hooks.AsyncLocalStorage enable disable multiple times", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();

  asyncLocalStorage.enterWith("first value");
  expect(asyncLocalStorage.getStore()).toBe("first value");
  asyncLocalStorage.disable();
  expect(asyncLocalStorage.getStore()).toBe(undefined);

  asyncLocalStorage.enterWith("second value");
  expect(asyncLocalStorage.getStore()).toBe("second value");
  asyncLocalStorage.disable();
  expect(asyncLocalStorage.getStore()).toBe(undefined);

  const { promise, resolve, reject } = Promise.withResolvers();
  asyncLocalStorage.run("first run value", () => {
    try {
      expect(asyncLocalStorage.getStore()).toBe("first run value");
      asyncLocalStorage.disable();
      expect(asyncLocalStorage.getStore()).toBe(undefined);
      asyncLocalStorage.run("second run value", () => {
        try {
          expect(asyncLocalStorage.getStore()).toBe("second run value");
          asyncLocalStorage.disable();
          expect(asyncLocalStorage.getStore()).toBe(undefined);

          resolve(undefined);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });

  await promise;
});

test("AsyncResource.prototype.bind", () => {
  const localStorage = new AsyncLocalStorage<true>();
  let ar!: AsyncResource;
  localStorage.run(true, () => {
    ar = new AsyncResource("test");
  });
  expect(ar.bind(() => localStorage.getStore())()).toBe(true);
});

test("AsyncResource.bind", () => {
  const localStorage = new AsyncLocalStorage<true>();
  let fn!: () => true | undefined;
  localStorage.run(true, () => {
    fn = AsyncResource.bind(() => localStorage.getStore());
  });
  expect(fn()).toBe(true);
});

test("async_hooks async ids follow process.nextTick causality", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { executionAsyncId, triggerAsyncId } = require("async_hooks");
      const out = [];
      out.push(["top", executionAsyncId(), triggerAsyncId()]);
      process.nextTick(() => {
        const outer = executionAsyncId();
        out.push(["outer", outer, triggerAsyncId()]);
        process.nextTick(() => out.push(["a", executionAsyncId(), triggerAsyncId()]));
        process.nextTick(() => {
          out.push(["b", executionAsyncId(), triggerAsyncId()]);
          console.log(JSON.stringify(out));
        });
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const rows = JSON.parse(stdout.trim());
  const [top, outer, a, b] = rows;
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  // The root execution context is 1 and has no trigger.
  expect(top).toEqual(["top", 1, 0]);
  // The tick's trigger is the context that scheduled it.
  expect(outer[2]).toBe(1);
  expect(outer[1]).toBeGreaterThan(1);
  // Siblings scheduled from the same tick share a trigger and have distinct ids.
  expect(a[2]).toBe(outer[1]);
  expect(b[2]).toBe(outer[1]);
  expect(a[1]).not.toBe(b[1]);
});

test("async_hooks createHook reports TickObject and AsyncResource events", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { createHook, AsyncResource } = require("async_hooks");
      const events = [];
      const hook = createHook({
        init(id, type, triggerId) { events.push(["init", type, id === triggerId]); },
        before(id) { events.push(["before", id > 0]); },
        after(id) { events.push(["after", id > 0]); },
        destroy(id) { events.push(["destroy", id > 0]); },
      });
      if (hook.enable() !== hook) throw new Error("enable() must return the hook");
      if (hook.enable() !== hook) throw new Error("enable() must be idempotent");
      const res = new AsyncResource("mine");
      res.runInAsyncScope(() => {});
      res.emitDestroy();
      process.nextTick(() => {});
      // destroy is delivered off a microtask queue, which only runs once the
      // whole nextTick queue has drained.
      setTimeout(() => {
        if (hook.disable() !== hook) throw new Error("disable() must return the hook");
        if (hook.disable() !== hook) throw new Error("disable() must be idempotent");
        console.log(JSON.stringify(events));
      }, 1);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const events = JSON.parse(stdout.trim());
  expect(events).toContainEqual(["init", "mine", false]);
  expect(events).toContainEqual(["init", "TickObject", false]);
  expect(events).toContainEqual(["before", true]);
  expect(events).toContainEqual(["after", true]);
  expect(events).toContainEqual(["destroy", true]);
});

test("async_hooks AsyncResource.asyncId is stable and matches executionAsyncId in scope", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { AsyncResource, executionAsyncId, triggerAsyncId } = require("async_hooks");
      const res = new AsyncResource("mine");
      const id = res.asyncId();
      if (id !== res.asyncId()) throw new Error("asyncId() is not stable");
      if (!(id > 1)) throw new Error("asyncId() must be a real id, got " + id);
      res.runInAsyncScope(() => {
        if (executionAsyncId() !== id) throw new Error("executionAsyncId() mismatch");
        if (triggerAsyncId() !== res.triggerAsyncId()) throw new Error("triggerAsyncId() mismatch");
      });
      if (executionAsyncId() !== 1) throw new Error("scope was not unwound");
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
});
