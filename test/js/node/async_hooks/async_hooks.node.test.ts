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

// Node rejects an empty AsyncResource type only while a hook with an `init`
// callback is currently enabled. Hook counts are process-global, so the whole
// ordered sequence runs in one child.
test("new AsyncResource('') only throws while an init hook is enabled", async () => {
  const fixture = `
    const ah = require("node:async_hooks");
    const probe = (type = "") => {
      try {
        new ah.AsyncResource(type);
        return "ok";
      } catch (e) {
        return e.code;
      }
    };
    const out = {};

    out.noHookEver = probe();

    const empty = ah.createHook({}).enable();
    out.emptyHookEnabled = probe();
    empty.disable();

    const destroyOnly = ah.createHook({ destroy() {} }).enable();
    out.destroyOnlyEnabled = probe();
    destroyOnly.disable();

    const initHook = ah.createHook({ init() {} }).enable();
    out.initHookEnabled = probe();
    out.initHookEnabledNonEmptyType = probe("resource");
    initHook.disable();
    out.initHookDisabled = probe();

    const first = ah.createHook({ init() {} }).enable();
    const second = ah.createHook({ init() {} }).enable();
    first.disable();
    out.oneOfTwoInitHooksLeft = probe();
    second.disable();
    out.bothInitHooksDisabled = probe();

    const twice = ah.createHook({ init() {} });
    twice.enable();
    twice.enable();
    twice.disable();
    out.enabledTwiceDisabledOnce = probe();

    const kept = ah.createHook({ init() {} }).enable();
    const dropped = ah.createHook({ init() {} }).enable();
    dropped.disable();
    dropped.disable();
    out.doubleDisableKeepsOtherHook = probe();
    kept.disable();
    out.afterLastInitHookDisabled = probe();

    const neverEnabled = ah.createHook({ init() {} });
    neverEnabled.disable();
    out.disableWithoutEnable = probe();

    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Surface the child's stderr in the diff if it died before printing anything.
  const result = stdout ? JSON.parse(stdout) : { crashed: stderr };

  // Expected values are what node v26.3.0 prints for the same script.
  expect(result).toEqual({
    noHookEver: "ok",
    emptyHookEnabled: "ok",
    destroyOnlyEnabled: "ok",
    initHookEnabled: "ERR_ASYNC_TYPE",
    initHookEnabledNonEmptyType: "ok",
    initHookDisabled: "ok",
    oneOfTwoInitHooksLeft: "ERR_ASYNC_TYPE",
    bothInitHooksDisabled: "ok",
    enabledTwiceDisabledOnce: "ok",
    doubleDisableKeepsOtherHook: "ERR_ASYNC_TYPE",
    afterLastInitHookDisabled: "ok",
    disableWithoutEnable: "ok",
  });
  expect(exitCode).toBe(0);
});
