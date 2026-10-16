/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * Node's AsyncLocalStorage.bind(fn) is AsyncResource.bind(fn). With no thisArg,
 * the function it returns calls fn with the receiver of each call:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/async_local_storage/async_context_frame.js#L41-L47
 * https://github.com/nodejs/node/blob/v26.3.0/lib/async_hooks.js#L250-L277
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const receiver = function (this: unknown) {
  return this;
};

describe("AsyncLocalStorage.bind", () => {
  test("passes the receiver of the call to fn", async () => {
    const owner = { method: AsyncLocalStorage.bind(receiver) };
    const other = {};

    const emitter = new EventEmitter();
    let heard: unknown;
    emitter.on(
      "x",
      AsyncLocalStorage.bind(function (this: unknown) {
        heard = this;
      }),
    );
    emitter.emit("x");

    const { promise: fired, resolve } = Promise.withResolvers<unknown>();
    const timer = setTimeout(
      AsyncLocalStorage.bind(function (this: unknown) {
        resolve(this);
      }),
      0,
    );

    const label = (v: unknown) =>
      v === owner ? "owner" : v === other ? "other" : v === emitter ? "emitter" : v === timer ? "timer" : String(v);
    assert.deepStrictEqual(
      {
        method: label(owner.method()),
        call: label(owner.method.call(other)),
        apply: label(owner.method.apply(other)),
        reflectApply: label(Reflect.apply(owner.method, other, [])),
        rebound: label(owner.method.bind(other)()),
        nested: label(AsyncLocalStorage.bind(owner.method).call(other)),
        async: label(
          await AsyncLocalStorage.bind(async function (this: unknown) {
            return this;
          }).call(other),
        ),
        listener: label(heard),
        timer: label(await fired),
        primitive: label(owner.method.call("str")),
        null: label(owner.method.call(null)),
        bare: label((0, owner.method)()),
      },
      {
        method: "owner",
        call: "other",
        apply: "other",
        reflectApply: "other",
        rebound: "other",
        nested: "other",
        async: "other",
        listener: "emitter",
        timer: "timer",
        primitive: "str",
        null: "null",
        bare: "undefined",
      },
    );

    class Counter {
      count = 0;
      add = AsyncLocalStorage.bind(function (this: Counter, n: number) {
        return (this.count += n);
      });
    }
    assert.strictEqual(new Counter().add(2), 2);
  });

  // The receiver test passes with a wrapper that never installs the context.
  test("runs fn in the context captured by bind() and restores the caller's", () => {
    const als = new AsyncLocalStorage<string>();
    const enter = () => {
      als.enterWith("C");
      return als.getStore();
    };
    const outside = AsyncLocalStorage.bind(() => als.getStore());
    const [inA, throws, enters] = als.run("A", () => [
      AsyncLocalStorage.bind(() => als.getStore()),
      AsyncLocalStorage.bind(() => {
        throw new Error(als.getStore());
      }),
      AsyncLocalStorage.bind(enter),
    ]);

    als.run("B", () => {
      assert.deepStrictEqual([inA(), als.getStore()], ["A", "B"]);
      assert.deepStrictEqual([outside(), als.getStore()], [undefined, "B"]);
      assert.throws(throws, { message: "A" });
      assert.strictEqual(als.getStore(), "B");
      assert.deepStrictEqual([enters(), als.getStore()], ["C", "B"]);
      // Bound and called in one frame: the wrapper still restores that frame.
      assert.deepStrictEqual([AsyncLocalStorage.bind(enter)(), als.getStore()], ["C", "B"]);
    });
  });

  test("names the result 'bound'", () => {
    const bound = AsyncLocalStorage.bind(function named() {});
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(bound, "name"), {
      value: "bound",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  });

  test("ignores extra arguments", () => {
    // @ts-expect-error bind() takes one parameter
    assert.deepStrictEqual(AsyncLocalStorage.bind((...args: unknown[]) => args, "x")("y"), ["y"]);
  });

  test("does not need the class as its receiver", () => {
    const { bind } = AsyncLocalStorage;
    assert.deepStrictEqual(bind((...args: unknown[]) => args)("y"), ["y"]);

    let snapshots = 0;
    class Sub extends AsyncLocalStorage<unknown> {
      static snapshot() {
        snapshots++;
        return super.snapshot();
      }
    }
    assert.deepStrictEqual(Sub.bind((...args: unknown[]) => args)("y"), ["y"]);
    assert.strictEqual(snapshots, 0);
  });

  // Node's bind() and the function it returns do not spread an array. Its
  // exit() does, so exit() is not part of this test.
  test("works while Array.prototype[Symbol.iterator] is deleted", () => {
    const als = new AsyncLocalStorage<string>();
    const iterator = Array.prototype[Symbol.iterator];
    let result: unknown;
    // @ts-expect-error the iterator is not optional
    delete Array.prototype[Symbol.iterator];
    try {
      const bound = als.run("v", () => AsyncLocalStorage.bind((a: string, b: string) => `${als.getStore()}:${a}/${b}`));
      result = bound("x", "y");
    } finally {
      Array.prototype[Symbol.iterator] = iterator;
    }
    assert.strictEqual(result, "v:x/y");
  });
});

// Node's snapshot() is AsyncLocalStorage.bind((cb, ...args) => cb(...args)): a
// function named "bound" whose arrow never hands a receiver to cb.
describe("AsyncLocalStorage.snapshot", () => {
  test("returns a function named 'bound' that calls fn without a receiver", () => {
    const runInSnapshot = AsyncLocalStorage.snapshot();
    const holder = { runInSnapshot };
    assert.deepStrictEqual(
      {
        name: runInSnapshot.name,
        length: runInSnapshot.length,
        bare: runInSnapshot(receiver),
        method: holder.runInSnapshot(receiver),
      },
      { name: "bound", length: 1, bare: undefined, method: undefined },
    );
  });

  test("restores the frame it was taken in when called there", () => {
    const als = new AsyncLocalStorage<string>();
    als.run("A", () => {
      const seen = AsyncLocalStorage.snapshot()(() => {
        als.enterWith("C");
        return als.getStore();
      });
      assert.deepStrictEqual([seen, als.getStore()], ["C", "A"]);
    });
  });
});

// Node: ReflectApply(fn, null, args) on every path of run().
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/async_local_storage/async_context_frame.js#L57-L69
test("AsyncLocalStorage run() and exit() call the callback with this === null", () => {
  const als = new AsyncLocalStorage<string>();
  assert.deepStrictEqual(
    {
      run: als.run("s", receiver),
      sameValue: als.run("s", () => als.run("s", receiver)),
      exit: als.run("s", () => als.exit(receiver)),
      exitSameValue: als.exit(receiver),
    },
    { run: null, sameValue: null, exit: null, exitSameValue: null },
  );
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  // A dispatcher of Bun that supplies a receiver: fetch runs with the server as `this`.
  test("Bun.serve calls a bound fetch handler with the server as its receiver", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: AsyncLocalStorage.bind(function (this: unknown) {
        return new Response(String(this === server));
      }),
    });
    assert.strictEqual(await (await fetch(server.url)).text(), "true");
  });

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
