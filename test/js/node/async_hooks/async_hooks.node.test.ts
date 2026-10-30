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

// Each program runs in a process of its own: process.stdin is built once for each process.
async function run(program: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", program],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The example in Node's documentation of executionAsyncResource(): an init hook copies state from the current resource.
test.concurrent("executionAsyncResource() in an init hook does not overflow the stack", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const { createHook, executionAsyncResource } = require("node:async_hooks");
    const sym = Symbol("state");
    createHook({
      init(asyncId, type, triggerAsyncId, resource) {
        const cr = executionAsyncResource();
        if (cr) resource[sym] = cr[sym];
      },
    }).enable();
    executionAsyncResource()[sym] = "state";
    process.nextTick(() => console.log("tick sees", executionAsyncResource()[sym]));
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("tick sees state\n");
  expect(exitCode).toBe(0);
});

test.concurrent("executionAsyncResource() returns one plain object and does not build process.stdin", async () => {
  const { stdout, stderr, exitCode } = await run(`
    import { executionAsyncResource } from "node:async_hooks";
    import { describe } from "bun:jsc";
    // describe() prints the Structure of process. A lazy property such as stdin is in it once it is built.
    const stdinIsBuilt = () => /[{ ]stdin:/.test(describe(process));
    const resource = executionAsyncResource();
    const ownKeys = Reflect.ownKeys(resource);
    const key = Symbol("store");
    resource[key] = "stored";
    console.log(JSON.stringify({
      sameObject: executionAsyncResource() === resource,
      prototypeIsObjectPrototype: Object.getPrototypeOf(resource) === Object.prototype,
      ownKeys,
      readBack: executionAsyncResource()[key],
      stdinIsBuiltByTheCalls: stdinIsBuilt(),
      isStdin: resource === process.stdin,
      stdinIsBuiltByARead: stdinIsBuilt(),
    }));
  `);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    sameObject: true,
    prototypeIsObjectPrototype: true,
    ownKeys: [],
    readBack: "stored",
    stdinIsBuiltByTheCalls: false,
    isStdin: false,
    // The control: the comparison above read process.stdin, and the probe sees the stream that the read built.
    stdinIsBuiltByARead: true,
  });
  expect(exitCode).toBe(0);
});

test.concurrent("executionAsyncResource() does not read process.stdin", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const { executionAsyncResource } = require("node:async_hooks");
    let reads = 0;
    Object.defineProperty(process, "stdin", { configurable: true, get() { reads++; } });
    const resource = executionAsyncResource();
    executionAsyncResource();
    console.log(reads, typeof resource);
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("0 object\n");
  expect(exitCode).toBe(0);
});
