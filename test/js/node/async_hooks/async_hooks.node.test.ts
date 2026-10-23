import assert from "assert";
import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

// The warning of an API that is not implemented looks for known callers in its own stack.
// BUN_FEATURE_FLAG_VERBOSE_WARNINGS turns it on.
describe.concurrent("the warning of an API that is not implemented", () => {
  test("is printed when Error.prepareStackTrace does not return a string", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Error.prepareStackTrace = () => undefined;
        console.log(require("node:async_hooks").executionAsyncId());`,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_VERBOSE_WARNINGS: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "0\n",
      stderr:
        "[bun] Warning: async_hooks.executionAsyncId/triggerAsyncId are not implemented in Bun. It will return 0 every time.\n",
      exitCode: 0,
    });
  });

  // The known callers are paths with forward slashes.
  test.skipIf(isWindows)(
    "is not printed for a known caller when Error.prepareStackTrace hides the frames",
    async () => {
      using dir = tempDir("async-hooks-warning", {
        "node_modules/zx/build/core.js": `module.exports = () => require("node:async_hooks").executionAsyncId();`,
        "index.js": `Error.prepareStackTrace = () => "not the frames";
        console.log(require("zx/build/core.js")());`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: { ...bunEnv, BUN_FEATURE_FLAG_VERBOSE_WARNINGS: "1" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
    },
  );
});
