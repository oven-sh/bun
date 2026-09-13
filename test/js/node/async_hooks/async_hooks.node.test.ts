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

test("createHook reports timer init and destroy without disturbing async context", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { AsyncLocalStorage, createHook } = require("node:async_hooks");
      const ownership = new AsyncLocalStorage();
      const ids = new Map();
      const handles = new Map();
      const resources = new Map();
      const observed = new Map();
      let creating;

      function record(label) {
        let entry = observed.get(label);
        if (!entry) {
          entry = { callbacks: [], destroys: 0, order: [] };
          observed.set(label, entry);
        }
        return entry;
      }

      const hook = createHook({
        init(id, type, _trigger, resource) {
          if (creating === undefined || (type !== "Timeout" && type !== "Immediate")) return;
          ids.set(id, creating);
          resources.set(creating, resource);
          const entry = record(creating);
          entry.order.push("init");
          Object.assign(entry, { type, initStore: ownership.getStore(), initReceiver: this === hook });
        },
        destroy(id) {
          const label = ids.get(id);
          if (label !== undefined) {
            ids.delete(id);
            const entry = record(label);
            entry.destroys++;
            entry.destroyStore = ownership.getStore() ?? null;
            entry.destroyReceiver = this === hook;
            entry.order.push("destroy");
          }
        },
      }).enable();

      function create(label, fn) {
        creating = label;
        try {
          const handle = fn();
          handles.set(label, handle);
          return handle;
        } finally {
          creating = undefined;
        }
      }

      const timeoutDone = Promise.withResolvers();
      const intervalDone = Promise.withResolvers();
      const immediateDone = Promise.withResolvers();
      ownership.run("owner", () => {
        create("timeout-cleared", () => setTimeout(() => record("timeout-cleared").callbacks.push("ran"), 1));
        clearTimeout(handles.get("timeout-cleared"));
        record("timeout-cleared").order.push("clear");

        create("immediate-cleared", () => setImmediate(() => record("immediate-cleared").callbacks.push("ran")));
        clearImmediate(handles.get("immediate-cleared"));
        record("immediate-cleared").order.push("clear");

        create("timeout-fired", () => setTimeout(() => {
          const entry = record("timeout-fired");
          entry.callbacks.push(ownership.getStore());
          entry.order.push("callback");
          timeoutDone.resolve();
        }, 1));

        const interval = create("interval-cleared", () => setInterval(() => {
          const entry = record("interval-cleared");
          entry.callbacks.push(ownership.getStore());
          entry.order.push("callback");
          clearInterval(interval);
          entry.order.push("clear");
          intervalDone.resolve();
        }, 1));

        create("immediate-fired", () => setImmediate(() => {
          const entry = record("immediate-fired");
          entry.callbacks.push(ownership.getStore());
          entry.order.push("callback");
          immediateDone.resolve();
        }));
      });

      await Promise.all([timeoutDone.promise, intervalDone.promise, immediateDone.promise]);
      await new Promise(resolve => setImmediate(resolve));
      hook.disable();

      const result = {};
      for (const [label, entry] of observed) {
        result[label] = {
          ...entry,
          resourceMatches: resources.get(label) === handles.get(label),
        };
      }
      result.pending = ids.size;
      console.log(JSON.stringify(result));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "timeout-cleared": {
      callbacks: [],
      destroys: 1,
      order: ["init", "clear", "destroy"],
      type: "Timeout",
      initStore: "owner",
      initReceiver: true,
      resourceMatches: true,
      destroyStore: null,
      destroyReceiver: true,
    },
    "immediate-cleared": {
      callbacks: [],
      destroys: 1,
      order: ["init", "clear", "destroy"],
      type: "Immediate",
      initStore: "owner",
      initReceiver: true,
      resourceMatches: true,
      destroyStore: null,
      destroyReceiver: true,
    },
    "timeout-fired": {
      callbacks: ["owner"],
      destroys: 1,
      order: ["init", "callback", "destroy"],
      type: "Timeout",
      initStore: "owner",
      initReceiver: true,
      resourceMatches: true,
      destroyStore: null,
      destroyReceiver: true,
    },
    "interval-cleared": {
      callbacks: ["owner"],
      destroys: 1,
      order: ["init", "callback", "clear", "destroy"],
      type: "Timeout",
      initStore: "owner",
      initReceiver: true,
      resourceMatches: true,
      destroyStore: null,
      destroyReceiver: true,
    },
    "immediate-fired": {
      callbacks: ["owner"],
      destroys: 1,
      order: ["init", "callback", "destroy"],
      type: "Immediate",
      initStore: "owner",
      initReceiver: true,
      resourceMatches: true,
      destroyStore: null,
      destroyReceiver: true,
    },
    pending: 0,
  });
  expect(exitCode).toBe(0);
});

test("createHook defers timer hook changes during nested init", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("node:fs");
      const { createHook } = require("node:async_hooks");
      const events = [];
      let creating;
      const second = createHook({
        init(_id, type) {
          if (type === "Timeout") events.push("second:" + creating);
        },
      });
      let first;
      first = createHook({
        init(_id, type) {
          if (type !== "Timeout") return;
          events.push("first:" + creating);
          if (creating === "outer") {
            second.enable();
            first.disable();
            creating = "nested";
            setTimeout(() => {}, 1);
            creating = "outer";
          }
        },
      }).enable();

      creating = "outer";
      setTimeout(() => {}, 1);
      creating = "later";
      setTimeout(() => {}, 1);
      creating = undefined;
      setImmediate(() => setImmediate(() => fs.writeSync(1, JSON.stringify(events))));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: ["first:outer", "first:nested", "second:later"],
    stderr: "",
    exitCode: 0,
  });
});

test("createHook defers timer hook changes during nested TickObject init", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("node:fs");
      const { createHook } = require("node:async_hooks");
      const events = [];
      let creating;
      const second = createHook({
        init(_id, type) {
          if (type === "Timeout") events.push("second:" + creating);
        },
      });
      let first;
      first = createHook({
        init(_id, type) {
          if (type === "TickObject") {
            events.push("first:" + creating);
            second.enable();
            first.disable();
            creating = "nested";
            setTimeout(() => {}, 1);
            creating = "tick";
          } else if (type === "Timeout") {
            events.push("first:" + creating);
          }
        },
      }).enable();

      creating = "tick";
      process.nextTick(() => {});
      creating = "later";
      setTimeout(() => {}, 1);
      creating = undefined;
      setImmediate(() => setImmediate(() => fs.writeSync(1, JSON.stringify(events))));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: ["first:tick", "first:nested", "second:later"],
    stderr: "",
    exitCode: 0,
  });
});

test("createHook does not replay timer destroy after a disabled cancellation", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("node:fs");
      const { createHook } = require("node:async_hooks");
      let targetId;
      let destroys = 0;
      const hook = createHook({
        init(id, type) {
          if (type === "Timeout" && targetId === undefined) targetId = id;
        },
        destroy(id) {
          if (id === targetId) destroys++;
        },
      }).enable();
      const timer = setTimeout(() => {}, 1);
      hook.disable();
      clearTimeout(timer);
      hook.enable();
      setImmediate(() => setImmediate(() => fs.writeSync(1, JSON.stringify({ targetSeen: targetId !== undefined, destroys }))));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: { targetSeen: true, destroys: 0 },
    stderr: "",
    exitCode: 0,
  });
});

test("createHook destroys a timer created before hook enablement", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("node:fs");
      const { createHook } = require("node:async_hooks");
      const timer = setTimeout(() => {}, 1);
      let destroys = 0;
      createHook({ destroy() { destroys++; } }).enable();
      clearTimeout(timer);
      setImmediate(() => fs.writeSync(1, String(destroys)));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1", stderr: "", exitCode: 0 });
});

test("refreshing a completed timeout starts a new async lifecycle", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("node:fs");
      const { createHook } = require("node:async_hooks");
      const ids = [];
      const destroyed = [];
      let timer;
      let fires = 0;
      createHook({
        init(id, type, _trigger, resource) {
          if (type === "Timeout" && (timer === undefined || resource === timer)) ids.push(id);
        },
        destroy(id) {
          if (ids.includes(id)) destroyed.push(id);
        },
      }).enable();
      timer = setTimeout(function callback() {
        if (++fires === 1) {
          setImmediate(() => timer.refresh());
        } else {
          setImmediate(() => setImmediate(() => fs.writeSync(1, JSON.stringify({ ids, destroyed, fires }))));
        }
      }, 1);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = JSON.parse(stdout);
  expect({
    ids: result.ids.length,
    uniqueIds: new Set(result.ids).size,
    destroyed: result.destroyed,
    fires: result.fires,
  }).toEqual({ ids: 2, uniqueIds: 2, destroyed: result.ids, fires: 2 });
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
});
