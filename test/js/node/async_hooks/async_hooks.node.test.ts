import assert from "assert";
import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { bunEnv, bunExe } from "harness";

test("enterWith at main-module scope does not drop a subsequent process.nextTick", async () => {
  // Regression: cleanupAsyncHooksData ran on the microtask tick without
  // draining the nextTick queue, so a tick scheduled after enterWith() at
  // main-module scope with no other event-loop work was silently dropped.
  // This is independent of node:domain.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { AsyncLocalStorage } = require("async_hooks"); new AsyncLocalStorage().enterWith(1); process.nextTick(() => console.log("tick"));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("tick");
  expect({ stderr, exitCode }).toEqual({ stderr, exitCode: 0 });
});

test("AsyncResource does not read process.domain when node:domain is not loaded", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let calls = 0;
      Object.defineProperty(process, "domain", { get() { calls++; return null; }, configurable: true });
      const { AsyncResource } = require("async_hooks");
      new AsyncResource("a");
      new AsyncResource("b");
      process.domain; // observable read: proves the getter itself works
      console.log(JSON.stringify({ calls, hasOwn: Object.hasOwn(new AsyncResource("c"), "domain") }));
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({ calls: 1, hasOwn: false });
  expect({ stderr, exitCode }).toEqual({ stderr, exitCode: 0 });
});

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
