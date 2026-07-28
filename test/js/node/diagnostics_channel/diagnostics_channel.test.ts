import { gc } from "bun";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel, Channel, hasSubscribers, subscribe, unsubscribe } from "node:diagnostics_channel";

describe("Channel", () => {
  // test-diagnostics-channel-has-subscribers.js
  test("can have subscribers", () => {
    const name = "channel1";
    const dc = channel(name);
    expect(hasSubscribers(name)).toBeFalse();

    dc.subscribe(() => {});
    expect(hasSubscribers(name)).toBeTrue();

    checkCalls();
  });

  // test-diagnostics-channel-symbol-named.js
  test("can have symbol as name", () => {
    const input = {
      foo: "bar",
    };

    const symbol = Symbol("channel2");

    // Individual channel objects can be created to avoid future lookups
    const dc = channel(symbol);

    // Expect two successful publishes later
    dc.subscribe(
      mustCall((message, name) => {
        expect(name).toBe(symbol);
        expect(message).toStrictEqual(input);
      }),
    );

    dc.publish(input);

    expect(() => {
      // @ts-expect-error
      channel(null);
    }).toThrow(/"channel" argument must be of type string or symbol/);

    checkCalls();
  });

  // test-diagnostics-channel-sync-unsubscribe.js
  test("does not throw when unsubscribed", () => {
    const name = "channel3";
    const data = "some message";

    const onMessageHandler: any = mustCall(() => unsubscribe(name, onMessageHandler));

    subscribe(name, onMessageHandler);

    // This must not throw.
    channel(name).publish(data);

    checkCalls();
  });

  // test-diagnostics-channel-pub-sub.js
  test("can publish and subscribe", () => {
    const name = "channel4";
    const input = {
      foo: "bar",
    };

    // Individual channel objects can be created to avoid future lookups
    const dc = channel(name);
    expect(dc).toBeInstanceOf(Channel);

    // No subscribers yet, should not publish
    expect(dc.hasSubscribers).toBeFalse();

    const subscriber = mustCall((message, name) => {
      expect(name).toBe(dc.name);
      expect(message).toStrictEqual(input);
    });

    // Now there's a subscriber, should publish
    subscribe(name, subscriber);
    expect(dc.hasSubscribers).toBeTrue();

    // The ActiveChannel prototype swap should not fail instanceof
    expect(dc).toBeInstanceOf(Channel);

    // Should trigger the subscriber once
    dc.publish(input);

    // Should not publish after subscriber is unsubscribed
    expect(unsubscribe(name, subscriber)).toBeTrue();
    expect(dc.hasSubscribers).toBeFalse();

    // unsubscribe() should return false when subscriber is not found
    expect(unsubscribe(name, subscriber)).toBeFalse();

    expect(() => {
      // @ts-expect-error
      subscribe(name, null);
    }).toThrow(/"subscription" argument must be of type/);

    // Reaching zero subscribers should not delete from the channels map as there
    // will be no more weakref to incRef if another subscribe happens while the
    // channel object itself exists.
    dc.subscribe(subscriber);
    dc.unsubscribe(subscriber);
    dc.subscribe(subscriber);

    checkCalls();
  });

  // test-diagnostics-channel-object-channel-pub-sub.js
  test("can publish and subscribe using object", () => {
    const name = "channel5";
    const input = {
      foo: "bar",
    };

    // Should not have named channel
    expect(hasSubscribers(name)).toBeFalse();

    // Individual channel objects can be created to avoid future lookups
    const dc = channel(name);
    expect(dc).toBeInstanceOf(Channel);
    expect(channel(name)).toBe(dc); // intentional object equality check

    // No subscribers yet, should not publish
    expect(dc.hasSubscribers).toBeFalse();

    const subscriber = mustCall((message, name) => {
      expect(name).toBe(dc.name);
      expect(message).toStrictEqual(input);
    });

    // Now there's a subscriber, should publish
    dc.subscribe(subscriber);
    expect(dc.hasSubscribers).toBeTrue();

    // The ActiveChannel prototype swap should not fail instanceof
    expect(dc).toBeInstanceOf(Channel);

    // Should trigger the subscriber once
    dc.publish(input);

    // Should not publish after subscriber is unsubscribed
    expect(dc.unsubscribe(subscriber)).toBeTrue();
    expect(dc.hasSubscribers).toBeFalse();

    // unsubscribe() should return false when subscriber is not found
    expect(dc.unsubscribe(subscriber)).toBeFalse();

    expect(() => {
      // @ts-expect-error
      subscribe(null);
    }).toThrow(/"channel" argument must be of type/);

    checkCalls();
  });

  // test-diagnostics-channel-safe-subscriber-errors.js
  // TODO: Needs support for 'uncaughtException' event
  test.todo("can handle subscriber errors", () => {
    const input = {
      foo: "bar",
    };
    const dc = channel("channel6");
    const error = new Error("This error should have been caught!");

    process.on(
      "uncaughtException",
      mustCall(err => {
        expect(err).toStrictEqual(error);
      }),
    );

    dc.subscribe(
      mustCall(() => {
        throw error;
      }),
    );

    // The failing subscriber should not stop subsequent subscribers from running
    dc.subscribe(mustCall(() => {}));

    // Publish should continue without throwing
    const fn = mustCall(() => {});
    dc.publish(input);
    fn();

    checkCalls();
  });

  // test-diagnostics-channel-bind-store.js
  // TODO: Needs support for 'uncaughtException' event
  test.todo("can use bind store", () => {
    let n = 0;
    const name = "channel7";
    const thisArg = new Date();
    const inputs = [{ foo: "bar" }, { baz: "buz" }];

    const dc = channel(name);

    // Bind a storage directly to published data
    const store1 = new AsyncLocalStorage();
    dc.bindStore(store1);
    let store1bound = true;

    // Bind a store with transformation of published data
    const store2 = new AsyncLocalStorage();
    dc.bindStore(
      store2,
      mustCall(data => {
        expect(data).toStrictEqual(inputs[n]);
        return { data };
      }, 4),
    );

    // Regular subscribers should see publishes from runStores calls
    dc.subscribe(
      mustCall(data => {
        if (store1bound) {
          expect(data).toStrictEqual(store1.getStore());
        }
        expect({ data }).toStrictEqual(store2.getStore());
        expect(data).toStrictEqual(inputs[n]);
      }, 4),
    );

    // Verify stores are empty before run
    expect(store1.getStore()).toBeUndefined();
    expect(store2.getStore()).toBeUndefined();

    dc.runStores(
      inputs[n],
      mustCall(function (a, b) {
        // Verify this and argument forwarding
        expect(this).toBe(thisArg);
        expect(a).toBe(1);
        expect(b).toBe(2);

        // Verify store 1 state matches input
        expect(store1.getStore()).toStrictEqual(inputs[n]);

        // Verify store 2 state has expected transformation
        expect(store2.getStore()).toStrictEqual({ data: inputs[n] });

        // Should support nested contexts
        n++;
        dc.runStores(
          inputs[n],
          mustCall(function () {
            // Verify this and argument forwarding
            expect(this).toBeUndefined();

            // Verify store 1 state matches input
            expect(store1.getStore()).toStrictEqual(inputs[n]);

            // Verify store 2 state has expected transformation
            expect(store2.getStore()).toStrictEqual({ data: inputs[n] });
          }),
        );
        n--;

        // Verify store 1 state matches input
        expect(store1.getStore()).toStrictEqual(inputs[n]);

        // Verify store 2 state has expected transformation
        expect(store2.getStore()).toStrictEqual({ data: inputs[n] });
      }),
      thisArg,
      1,
      2,
    );

    // Verify stores are empty after run
    expect(store1.getStore()).toBeUndefined();
    expect(store2.getStore()).toBeUndefined();

    // Verify unbinding works
    expect(dc.unbindStore(store1)).toBeTrue();
    store1bound = false;

    // Verify unbinding a store that is not bound returns false
    expect(dc.unbindStore(store1)).toBeFalse();

    n++;
    dc.runStores(
      inputs[n],
      mustCall(() => {
        // Verify after unbinding store 1 will remain undefined
        expect(store1.getStore()).toBeUndefined();

        // Verify still bound store 2 receives expected data
        expect(store2.getStore()).toStrictEqual({ data: inputs[n] });
      }),
    );

    // Contain transformer errors and emit on next tick
    const fail = new Error("fail");
    dc.bindStore(store1, () => {
      throw fail;
    });

    let calledRunStores = false;
    process.once(
      "uncaughtException",
      mustCall(err => {
        expect(calledRunStores).toBeTrue();
        expect(err).toStrictEqual(fail);
      }),
    );

    dc.runStores(
      inputs[n],
      mustCall(() => {}),
    );
    calledRunStores = true;

    checkCalls();
  });

  // test-diagnostics-channel-memory-leak.js
  test("references are not leaked", () => {
    function noop() {}

    const heapUsedBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) {
      const name = `channel7-${i}`;
      subscribe(name, noop);
      unsubscribe(name, noop);
    }

    gc(true);
    const heapUsedAfter = process.memoryUsage().heapUsed;

    expect(heapUsedBefore).toBeGreaterThanOrEqual(heapUsedAfter);
  });
});

describe("TracingChannel", () => {
  // Port tests from:
  // https://github.com/search?q=repo%3Anodejs%2Fnode+test-diagnostics-channel+AND+%2Ftracing%2F&type=code
  test.todo("TODO");
});

// Node.js documents built-in console.{log,info,debug,warn,error} channels that
// receive the argument array on every corresponding console.* call. These run
// in a subprocess so the test runner's own console output is not polluted.
describe.concurrent("built-in console.* channels", () => {
  test("global console methods publish their arguments", async () => {
    const script = `
      const dc = require("node:diagnostics_channel");
      const NAMES = ["console.log", "console.info", "console.debug", "console.warn", "console.error"];
      const received = {};
      const held = [];
      for (const n of NAMES) {
        received[n] = [];
        const ch = dc.channel(n);
        const f = (args, name) => received[name].push(args);
        ch.subscribe(f);
        held.push([ch, f]);
      }
      const obj = { x: 2 };
      console.log("a", 1);
      console.info("i");
      console.debug("d", obj);
      console.warn("w");
      console.error("e", 3, 4);
      console.log();
      void held.length;
      if (received["console.debug"][0][1] !== obj) throw new Error("object identity not preserved");
      process.stdout.write("RESULT " + JSON.stringify(received) + "\\n");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout.split("\n").find(l => l.startsWith("RESULT "));
    expect(line).toBeDefined();
    const received = JSON.parse(line!.slice("RESULT ".length));

    expect(received).toEqual({
      "console.log": [["a", 1], []],
      "console.info": [["i"]],
      "console.debug": [["d", { x: 2 }]],
      "console.warn": [["w"]],
      "console.error": [["e", 3, 4]],
    });
    expect(stderr).toContain("w\n");
    expect(exitCode).toBe(0);
  });

  test("no publish when diagnostics_channel was never required", async () => {
    // Publishing is gated on node:diagnostics_channel having been loaded; when
    // it is required only after the console calls, those earlier calls must not
    // have published (and must not have thrown).
    const script = `
      console.log("before-1");
      console.error("before-2");
      const dc = require("node:diagnostics_channel");
      let count = 0;
      dc.subscribe("console.log", () => count++);
      console.log("after");
      process.stdout.write("RESULT " + count + "\\n");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("before-1\n");
    expect(stdout).toContain("RESULT 1\n");
    expect(stderr).toContain("before-2\n");
    expect(exitCode).toBe(0);
  });

  test("Console constructor instances publish to the same channels", async () => {
    const script = `
      const dc = require("node:diagnostics_channel");
      const { Writable } = require("node:stream");
      const received = {};
      for (const n of ["console.log", "console.info", "console.debug", "console.warn", "console.error"]) {
        received[n] = 0;
        dc.subscribe(n, () => received[n]++);
      }
      const sink = new Writable({ write(chunk, enc, cb) { cb(); } });
      const c = new console.Console(sink, sink);
      c.log("a");
      c.info("b");
      c.debug("c");
      c.warn("d");
      c.error("e");
      process.stdout.write("RESULT " + JSON.stringify(received) + "\\n");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout.split("\n").find(l => l.startsWith("RESULT "));
    expect(line).toBeDefined();
    expect(JSON.parse(line!.slice("RESULT ".length))).toEqual({
      "console.log": 1,
      "console.info": 1,
      "console.debug": 1,
      "console.warn": 1,
      "console.error": 1,
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("materializing the console.log channel does not affect other console methods", async () => {
    const script = `
      const dc = require("node:diagnostics_channel");
      let logCount = 0;
      dc.subscribe("console.log", () => logCount++);
      console.dir({ a: 1 });
      console.trace("t");
      console.assert(false, "ok");
      process.stdout.write("RESULT " + logCount + "\\n");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("RESULT 0\n");
    expect(exitCode).toBe(0);
  });
});

const mocks = new Map();

function mustCall<T>(fn: (...args: any[]) => T, expected?: number) {
  const instance = mock(fn);
  mocks.set(instance, expected ?? 1);
  return instance;
}

function mustNotCall<T>(fn: (...args: any[]) => T) {
  return mustCall(fn, 0);
}

// FIXME: remove this and use `afterEach` instead
// Currently, `bun test` disallows `expect()` in `afterEach`
function checkCalls() {
  for (const [mock, expected] of mocks.entries()) {
    expect(mock).toHaveBeenCalledTimes(expected);
  }
  mocks.clear();
}

beforeEach(() => {
  mocks.clear();
});
