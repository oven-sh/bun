import { gc } from "bun";
import { socketFaultInjection } from "bun:internal-for-testing";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tls as certificate, isIPv6, isWindows, nodeExe, normalizeBunSnapshot, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawn } from "node:child_process";
import {
  // @ts-expect-error not in @types/node yet
  boundedChannel,
  channel,
  Channel,
  hasSubscribers,
  subscribe,
  tracingChannel,
  unsubscribe,
} from "node:diagnostics_channel";
import { once } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { DatabaseSync } from "node:sqlite";
import tls from "node:tls";
import { getSystemErrorName, promisify } from "node:util";
import {
  createConnectProxy,
  ignoreAmbientNoProxy,
  startOriginWithCorruptRecord,
  startRenegotiatingWssServer,
  TLS_RECORD,
} from "../../web/websocket/proxy-test-utils";
import { closePayload, createPeer, encodeFrame, OP } from "../../web/websocket/raw-peer";

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
    }).toThrow(/"channel" argument must be one of type string or symbol/);

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
    }).toThrow(/"channel" argument must be one of type/);

    checkCalls();
  });

  test("publish() calls the subscribers there were when it started", () => {
    const dc = channel("changed-during-publish");
    const calls: string[] = [];
    const once = () => {
      calls.push("once");
      dc.unsubscribe(once);
    };
    const second = () => calls.push("second");
    const adds = () => {
      calls.push("adds");
      dc.subscribe(added);
    };
    const added = () => calls.push("added");
    dc.subscribe(once);
    dc.subscribe(second);
    dc.subscribe(adds);

    dc.publish(undefined);
    expect(calls).toEqual(["once", "second", "adds"]);
    dc.unsubscribe(adds);
    calls.length = 0;
    dc.publish(undefined);
    expect(calls).toEqual(["second", "added"]);
  });

  test("unsubscribe() does not modify the array in _subscribers", () => {
    const dc = channel("frozen-subscribers") as Channel & { _subscribers: Function[] };
    const first = () => {};
    const second = () => {};
    dc.subscribe(first);
    dc.subscribe(second);
    const frozen = Object.freeze([first, second]) as Function[];
    dc._subscribers = frozen;
    expect(dc.unsubscribe(first)).toBe(true);
    expect(dc._subscribers).toEqual([second]);
    expect(frozen).toEqual([first, second]);
  });

  test("unsubscribe() from a list too long to pass as arguments", () => {
    const dc = channel("many-subscribers") as Channel & { _subscribers: Function[] };
    const first = () => {};
    const other = () => {};
    dc.subscribe(first);
    dc._subscribers = [first, ...new Array(1_000_000).fill(other)];
    expect(dc.unsubscribe(first)).toBe(true);
    expect(dc._subscribers.length).toBe(1_000_000);
  });

  test("subscribe() after _subscribers was replaced", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { channel } = require("node:diagnostics_channel");
          const values = {
            number: 5, string: "abc", boolean: true, object: {}, null: null, undefined: undefined,
            symbol: Symbol("s"), bigint: 1n, frozen: Object.freeze([]),
            speciesObject: Object.assign([() => {}], { constructor: { [Symbol.species]: function () { return {}; } } }),
          };
          const outcome = {};
          for (const [name, value] of Object.entries(values)) {
            const dc = channel("replaced-" + name);
            dc.subscribe(() => {});
            dc._subscribers = value;
            try {
              dc.subscribe(() => {});
              outcome[name] = name === "speciesObject" ? "length " + dc._subscribers.length : "returned";
            } catch (e) {
              outcome[name] = e.constructor.name;
            }
          }
          console.log(JSON.stringify(outcome));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ outcome: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      outcome: {
        number: "returned",
        string: "returned",
        boolean: "returned",
        object: "returned",
        null: "TypeError",
        undefined: "TypeError",
        symbol: "returned",
        bigint: "returned",
        frozen: "returned",
        speciesObject: "length 2",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // test-diagnostics-channel-memory-leak.js
  //
  // Node's version compares process.memoryUsage().heapUsed before the loop with
  // the value after a collection. In Bun, heapUsed is the size measured by the
  // most recent collection, so the first read dates from some earlier point in
  // this file and the two numbers are not comparable. The entries the module
  // keeps per channel also go away in FinalizationRegistry callbacks, after the
  // collection. So check what the node test is after directly: once
  // unsubscribed, nothing holds the channels.
  test("references are not leaked", () => {
    function noop() {}

    const refs: WeakRef<Channel>[] = [];
    for (let i = 0; i < 1000; i++) {
      const name = `channel7-${i}`;
      const dc = channel(name);
      subscribe(name, noop);
      unsubscribe(name, noop);
      refs.push(new WeakRef(dc));
    }

    // Bun.gc() clears the WeakRef targets this job kept alive before it collects.
    gc(true);

    // Conservative stack scanning can keep the last few channels the loop
    // touched alive, so this checks that the channels are collectable rather
    // than that every one of them was collected. A retained reference keeps
    // all 1000 alive.
    const alive = refs.filter(ref => ref.deref() !== undefined).length;
    expect(alive).toBeLessThan(refs.length / 10);
  });

  // Many of each, so that the outcome does not hang on whether one object is collected.
  const names = (prefix: string) => Array.from({ length: 100 }, (_, i) => `${prefix}-${i}`);

  test.each<[string, (name: string) => void]>([
    ["subscribe()", name => subscribe(name, () => {})],
    ["bindStore()", name => channel(name).bindStore(new AsyncLocalStorage())],
    [
      "one of two subscribers left",
      name => {
        const first = () => {};
        subscribe(name, first);
        subscribe(name, () => {});
        unsubscribe(name, first);
      },
    ],
    // Node loses these two.
    [
      "the name was given to a new channel",
      name => {
        const first = () => {};
        const old = channel(name);
        old.subscribe(first);
        new (Channel as any)(name);
        old.unsubscribe(first);
        subscribe(name, () => {});
      },
    ],
    [
      "the channel was renamed",
      name => {
        const renamed = channel(name);
        (renamed as any).name = "renamed";
        renamed.subscribe(() => {});
      },
    ],
  ])("a channel that nobody holds stays active: %s", async (label, activate) => {
    names(label).forEach(activate);
    await nextTurn();
    gc(true);
    expect(names(label).filter(name => !hasSubscribers(name))).toEqual([]);
  });

  test("the finalizer of a collected channel leaves the next channel of that name alone", async () => {
    const { promise: finalized, resolve } = Promise.withResolvers<void>();
    const registry = new FinalizationRegistry(resolve);
    names("reused").forEach(name => registry.register(channel(name), undefined));
    await nextTurn();
    gc(true);

    const next = names("reused").map(name => channel(name));
    await finalized;
    await nextTurn();
    expect(names("reused").filter((name, i) => channel(name) !== next[i])).toEqual([]);
  });

  test("instanceof takes any value", () => {
    expect([undefined, null, 5, "text", {}].map(value => (value as any) instanceof Channel)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("no store stays entered if publish() throws", () => {
    const dc = channel("publish-throws");
    const store = new AsyncLocalStorage();
    dc.bindStore(store);
    dc.publish = () => {
      throw new Error("publish");
    };
    expect(() => dc.runStores("value", () => {})).toThrow("publish");
    expect(store.getStore()).toBeUndefined();
  });

  test("a store that fails to exit does not hide the error of the function", () => {
    const dc = channel("dispose-throws");
    const left = new AsyncLocalStorage();
    const [mine, ofStore] = [new Error("mine"), new Error("store")];
    dc.bindStore(left);
    dc.bindStore({
      withScope: () => ({
        [Symbol.dispose]() {
          throw ofStore;
        },
      }),
    } as any);
    expect(() =>
      dc.runStores("value", () => {
        throw mine;
      }),
    ).toThrow(expect.objectContaining({ errors: [mine, ofStore] }));
    expect(left.getStore()).toBeUndefined();
  });

  test.each([undefined, "outer"])("a store does not need withScope(), entered from %p", async outer => {
    // The shape of what dd-trace 5.35.0 binds.
    const handles = new AsyncLocalStorage<object>();
    const values = new WeakMap<object, unknown>();
    const store: any = Object.assign(() => {}, {
      getStore: () => values.get(handles.getStore()!),
      enterWith(value: unknown) {
        const handle = {};
        values.set(handle, value);
        handles.enterWith(handle);
      },
      run: (value: unknown, fn: () => unknown) => handles.exit(() => (store.enterWith(value), fn())),
    });
    const tracing = tracingChannel(`no-with-scope-${outer}`);
    tracing.start.bindStore(store, () => "start");
    tracing.asyncStart.bindStore(store, () => "asyncStart");
    using _ = {
      [Symbol.dispose]() {
        tracing.start.unbindStore(store);
        tracing.asyncStart.unbindStore(store);
        handles.disable();
      },
    };

    const seen: unknown[][] = [];
    const see = () => void seen.at(-1)!.push(store.getStore());
    const calls = [
      () => tracing.start.runStores({}, see),
      () => tracing.traceSync(see),
      () => expect(() => tracing.traceSync(() => (see(), JSON.parse("")))).toThrow(SyntaxError),
      () => tracing.traceCallback(done => (see(), done(), see()), 0, {}, undefined, see),
      () => tracing.tracePromise(async () => (see(), await nextTurn(), see())),
      () => boundedChannel(tracing).run({}, see),
      () => {
        using _ = (tracing.start as any).withStoreScope({});
        see();
      },
    ];
    if (outer) store.enterWith(outer);
    for (const call of calls) {
      seen.push([]);
      const result = call();
      see();
      await result;
    }

    expect(seen).toEqual([
      ["start", outer],
      ["start", outer],
      ["start", outer],
      ["start", "asyncStart", "start", outer],
      ["start", outer, "start"],
      ["start", outer],
      ["start", outer],
    ]);
  });

  test("withStoreScope() can be disposed twice", () => {
    const dc = channel("store-scope");
    const store = new AsyncLocalStorage();
    dc.bindStore(store);
    const scope = (dc as any).withStoreScope("first");
    expect(store.getStore()).toBe("first");
    scope[Symbol.dispose]();
    store.run("second", () => {
      scope[Symbol.dispose]();
      expect(store.getStore()).toBe("second");
    });
  });
});

describe("BoundedChannel", () => {
  test("withScope() makes a context for each scope", () => {
    const bounded = boundedChannel("fresh-context");
    const contexts: any[] = [];
    bounded.subscribe({
      start(context) {
        context.span = contexts.push(context);
      },
    });
    bounded.withScope()[Symbol.dispose]();
    bounded.withScope()[Symbol.dispose]();
    expect(contexts).toEqual([{ span: 1 }, { span: 2 }]);
  });

  test("a subscriber of end can dispose the scope", () => {
    const bounded = boundedChannel("reentrant-dispose");
    const end = mock(() => scope[Symbol.dispose]());
    bounded.subscribe({ end });
    const scope = bounded.withScope({});
    scope[Symbol.dispose]();
    expect(end).toHaveBeenCalledTimes(1);
  });

  test("names the channel that is missing", () => {
    expect(() => boundedChannel({ start: channel("bounded-start") })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: 'The "nameOrChannels.end" property must be an instance of Channel. Received undefined',
      }),
    );
  });
});

describe("TracingChannel", () => {
  const events = ["start", "end", "asyncStart", "asyncEnd", "error"] as const;

  function traced(name: string) {
    const tracing = tracingChannel<unknown, any>(name);
    const log: string[] = [];
    tracing.subscribe(Object.fromEntries(events.map(event => [event, () => log.push(event)])) as any);
    return { tracing, log };
  }

  test.each(events)("hasSubscribers with a subscriber of %s", event => {
    const tracing = tracingChannel(`has-subscribers-${event}`);
    const handlers: any = { [event]() {} };
    expect(tracing.hasSubscribers).toBe(false);
    tracing.subscribe(handlers);
    expect(tracing.hasSubscribers).toBe(true);
    tracing.unsubscribe(handlers);
    expect(tracing.hasSubscribers).toBe(false);
  });

  test.each(events)("names %s if it is no channel", event => {
    const channels = Object.fromEntries(events.map(event => [event, channel(`named-${event}`)]));
    expect(() => tracingChannel({ ...channels, [event]: undefined } as any)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "nameOrChannels.${event}" property must be an instance of Channel. Received undefined`,
      }),
    );
  });

  test("refuses null", () => {
    expect(() => tracingChannel(null as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test.each([[null], [5], ["text"], [Object.freeze({})]])(
    "a context of %p does not change the outcome of the call",
    async (context: any) => {
      const { tracing } = traced(`context-${typeof context}-${context}`);
      const mine = new Error("mine");
      const fail = () => {
        throw mine;
      };
      expect(tracing.traceSync(() => 1, context)).toBe(1);
      expect(() => tracing.traceSync(fail, context)).toThrow(mine);
      expect(await tracing.tracePromise(async () => 1, context)).toBe(1);
      expect(await tracing.tracePromise(async () => fail(), context).catch(error => error)).toBe(mine);

      const callback = mock(() => {});
      tracing.traceCallback(done => done(null, 1), 0, context, undefined, callback);
      tracing.traceCallback(done => done(mine), 0, context, undefined, callback);
      expect(callback.mock.calls).toEqual([[null, 1], [mine]] as any);
    },
  );

  test.each(["traceSync", "tracePromise", "traceCallback"] as const)(
    "%s() leaves no store entered if publishing end throws",
    method => {
      const tracing = tracingChannel(`end-throws-${method}`);
      const store = new AsyncLocalStorage();
      tracing.start.bindStore(store, () => "value");
      tracing.end.publish = () => {
        throw new Error("end");
      };
      const fn = async () => {};
      expect(() =>
        method === "traceCallback" ? tracing.traceCallback(fn, 0, {}, undefined, fn) : tracing[method](fn),
      ).toThrow("end");
      expect(store.getStore()).toBeUndefined();
    },
  );

  test("a subscriber that comes during the call gets no end without a start", () => {
    const tracing = tracingChannel("late-subscriber");
    const end = mock(() => {});
    tracing.error.subscribe(() => {});
    tracing.traceSync(() => tracing.end.subscribe(end));
    expect(end).not.toHaveBeenCalled();
  });

  test("tracePromise() returns the promise of the function", async () => {
    const { tracing, log } = traced("same-promise");
    const promise = Object.assign(Promise.resolve(1), { child: {} });
    expect(tracing.tracePromise(() => promise)).toBe(promise);
    await promise;
    expect(log).toEqual(["start", "end", "asyncStart", "asyncEnd"]);
  });

  test("tracePromise() reads then once, and counts the first call back", () => {
    const { tracing, log } = traced("unruly-thenable");
    let reads = 0;
    const thenable: any = {
      get then() {
        reads++;
        return (resolve, reject) => {
          resolve(1);
          resolve(2);
          reject(3);
        };
      },
    };
    const context = {};
    tracing.tracePromise(() => thenable, context);
    expect({ reads, log, context }).toEqual({
      reads: 1,
      log: ["start", "asyncStart", "asyncEnd", "end"],
      context: { result: 1 },
    });
  });

  test("tracePromise() takes a then() that throws for a rejection, as await does", async () => {
    const { tracing, log } = traced("throwing-then");
    const thenable: any = {
      then() {
        throw new Error("then");
      },
    };
    expect(tracing.tracePromise(() => thenable)).toBe(thenable);
    expect(log).toEqual(["start", "error", "asyncStart", "asyncEnd", "end"]);
  });

  test.concurrent.each([
    ["a promise", `Promise.reject(1)`],
    ["a promise of a subclass", `(class extends Promise {}).reject(1)`],
    ["a promise of another realm", `require("node:vm").runInNewContext("Promise.reject(1)")`],
    ["a promise that rejects later", `new Promise((_, reject) => setImmediate(reject, 1))`],
  ])("tracePromise() leaves %s as handled as it was", async (_, promise) => {
    expect(
      await run(`
        const tracing = dc.tracingChannel("rejections");
        tracing.error.subscribe(() => console.log("error"));
        process.on("unhandledRejection", (_, promise) => console.log("unhandled", promise === unhandled));
        const handled = ${promise};
        handled.catch(() => {});
        tracing.tracePromise(() => handled);
        const unhandled = tracing.tracePromise(() => ${promise});
      `),
    ).toEqual(["error", "error", "unhandled true"]);
  });
});

function listen(name: string, subscriber: (message: any) => void): Disposable {
  subscribe(name, subscriber);
  return { [Symbol.dispose]: () => void unsubscribe(name, subscriber) };
}

/** What `describe` makes of the messages on the channels, in order. `until(event)` resolves to the next message. */
function record(prefix: string, events: string[], describe: (event: string, message: any) => unknown = event => event) {
  const log: any[] = [];
  const waiting = new Map<string, (message: any) => void>();
  const subscriptions = events.map(event =>
    listen(prefix + event, message => {
      log.push(describe(event, message));
      waiting.get(event)?.(message);
    }),
  );
  return {
    log,
    until: (event: string) => new Promise<any>(resolve => waiting.set(event, resolve)),
    [Symbol.dispose]: () => subscriptions.forEach(subscription => subscription[Symbol.dispose]()),
  };
}

async function listening<T extends net.Server>(server: T) {
  await once(server.listen(0, "127.0.0.1"), "listening");
  return Object.assign(server, { port: (server.address() as net.AddressInfo).port });
}

test.concurrent("built-in modules do not load node:diagnostics_channel", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const internals = require("bun:internal-for-testing");
        const loaded = () => internals.internalModulesCompiledFromSource() + internals.internalModulesLoadedFromBytecode();
        for (const name of ["child_process", "dgram", "http", "http2", "https", "net", "test", "tls", "worker_threads"])
          require("node:" + name);
        require("undici");
        require("node:http").ClientRequest;
        require("node:dgram").createSocket("udp4").close();
        const before = loaded();
        require("node:diagnostics_channel");
        console.log(loaded() - before);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("1\n");
  expect(exitCode).toBe(0);
});

test.concurrent("a subscribe() that throws leaves the channel as it was", async () => {
  expect(
    await run(`
      const name = "undici:request:create";
      const { Error, Number } = globalThis;
      let threw = false;
      globalThis.Error = globalThis.Number = undefined;
      try { dc.subscribe(name, () => {}); } catch { threw = true; }
      Object.assign(globalThis, { Error, Number });
      console.log(dc.hasSubscribers(name) !== threw);
      dc.subscribe(name, () => console.log("published"));
      const controller = new AbortController();
      fetch("http://127.0.0.1", { signal: controller.signal }).catch(() => {});
      controller.abort();
    `),
  ).toEqual(["true", "published"]);
});

test.concurrent("Map and Set can be replaced before the module is loaded", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const store = new (require("node:async_hooks").AsyncLocalStorage)();
        globalThis.Map = globalThis.Set = class {};
        const channel = require("node:diagnostics_channel").channel("a");
        channel.bindStore(store);
        channel.subscribe(message => console.log(message, store.getStore()));
        channel.runStores(1, () => {});
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("1 1\n");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["before", `subscribe(); const { ChildProcess } = require("node:child_process");`],
  ["after", `const { ChildProcess } = require("node:child_process"); subscribe();`],
])("a subscription %s the module is loaded is heard", async (_, setUp) => {
  expect(
    await run(`
      const subscriber = () => console.log("published");
      const subscribe = () => dc.subscribe("child_process", subscriber);
      ${setUp}
      Bun.gc(true);
      new ChildProcess();
      dc.unsubscribe("child_process", subscriber);
      new ChildProcess();
      subscribe();
      new ChildProcess();
    `),
  ).toEqual(["published", "published"]);
});

describe.concurrent("console.*", () => {
  const instance = `new console.Console(process.stdout, process.stderr)`;

  test.each([
    ["the global console", "console"],
    ["a Console", instance],
  ])("%s publishes what Node does", async (_, target) => {
    const [line] = await run(
      `
        const heard = [];
        for (const name of ["log", "info", "debug", "warn", "error"])
          dc.subscribe("console." + name, args => {
            heard.push([name, ...args].map(arg => typeof arg === "string" ? arg.replace(/^[\\d.]+m?s$/, "<time>").split("\\n")[0] : arg));
            args.length = 0;
          });
        const c = ${target};
        for (const method of ["log", "info", "debug", "warn", "error", "dirxml"]) c[method]("%d", 1, { a: 1 });
        c.log();
        c.group("group");
        c.groupEnd();
        c.assert(true, "unheard");
        c.assert(false);
        c.assert(false, "text %d", 1);
        c.assert(false, { a: 1 });
        c.count();
        c.count("label");
        c.time("timer");
        c.timeLog("timer", 1);
        c.timeEnd("timer");
        c.trace("at %s", "x");
        c.table(5);
        process.on("exit", () => require("node:fs").writeSync(1, JSON.stringify(heard)));
      `,
      { stderr: expect.any(String) },
    ).then(lines => lines.slice(-1));
    expect(JSON.parse(line)).toEqual([
      ["log", "%d", 1, { a: 1 }],
      ["info", "%d", 1, { a: 1 }],
      ["debug", "%d", 1, { a: 1 }],
      ["warn", "%d", 1, { a: 1 }],
      ["error", "%d", 1, { a: 1 }],
      ["log", "%d", 1, { a: 1 }],
      ["log"],
      ["log", "group"],
      ["warn", "Assertion failed"],
      ["warn", "Assertion failed: text %d", 1],
      ["warn", "Assertion failed", { a: 1 }],
      ["log", "default: 1"],
      ["log", "label: 1"],
      ["log", "%s: %s", "timer", "<time>", 1],
      ["log", "%s: %s", "timer", "<time>"],
      ["error", "Trace: at x"],
      ["log", 5],
    ]);
  });

  // test-console-diagnostics-channels.js, which counts on the global console to call process.stdout.write()
  test.each([
    ["the global console", "console"],
    ["a Console", instance],
  ])("a subscriber changes what %s prints", async (_, target) => {
    expect(
      await run(
        `
          for (const name of ["log", "info", "debug", "warn", "error"])
            dc.subscribe("console." + name, args => {
              if (typeof args[1] === "object") args[1].secret = "hidden";
              else args[0] = String(args[0]).replace("secret", "hidden");
            });
          const c = ${target};
          for (const method of ["log", "info", "debug", "warn", "error"]) c[method]("%j", { secret: 1 });
          c.count("secret");
          c.assert(false, "secret");
          c.log(/hidden/.test(require("node:util").inspect(c.table([["secret"]]))));
        `,
        { stderr: `{"secret":"hidden"}\n{"secret":"hidden"}\nAssertion failed: hidden\n` },
      ).then(lines =>
        lines.map(line => (line.includes("─") ? "" : line.replace(/[│' ]|\(index\)/g, ""))).filter(Boolean),
      ),
    ).toEqual([
      `{"secret":"hidden"}`,
      `{"secret":"hidden"}`,
      `{"secret":"hidden"}`,
      "hidden:1",
      "0",
      "0hidden",
      "false",
    ]);
  });

  test.each([
    ["the global console", "console"],
    ["a Console", instance],
  ])("a subscriber that takes the arguments away leaves an empty line of %s", async (_, target) => {
    expect(
      await run(
        `
          for (const name of ["log", "warn", "error"]) dc.subscribe("console." + name, args => (args.length = 0));
          const c = ${target};
          for (const method of ["log", "dirxml", "table", "count", "warn", "error", "group"]) c[method]("secret");
          c.count();
          c.table(["secret"]);
          c.groupEnd();
          c.assert(false);
          c.info("end");
        `,
        { stderr: "\n\n\n" },
      ),
    ).toEqual(["", "", "", "", "", "  ", "  ", "end"]);
  });

  test("what a subscriber changes stays on the stream that the global console prints it on", async () => {
    expect(
      await run(
        `
          dc.subscribe("console.log", args => (args.length > 3 ? (args[2] = "changed") : (args.length = 0)));
          dc.subscribe("console.error", args => (args[0] = "trace"));
          console.time();
          console.timeLog("default", 1);
          console.timeEnd();
          console.trace();
        `,
        { stderr: "default: changed 1\n\n" },
      ),
    ).toEqual(["trace"]);
  });

  test.each(["timeLog('default', error)", "assert(false, error)"])(
    "an error in %s is printed as one if a subscriber changes another argument",
    async call => {
      await run(
        `
          for (const name of ["log", "warn"]) dc.subscribe("console." + name, args => args.push("added"));
          const error = new Error("message");
          console.time();
          console.${call};
        `,
        { stderr: expect.stringMatching(/error: message[^]*added/) },
      );
    },
  );

  test.each(["log", "count"])("console.%s() prints a part of a list that is too long", async method => {
    const [line] = await run(`
      dc.subscribe("console.log", args => (args.length = 2 ** 32 - 1));
      console.${method}("a");
    `);
    expect(line.split(" undefined")).toHaveLength(255);
  });

  test("a subscriber can wait for a thread that prints while console.table() publishes", async () => {
    expect(
      await run(`
        const turn = new Int32Array(new SharedArrayBuffer(4));
        const give = (turn, to) => (Atomics.store(turn, 0, to), Atomics.notify(turn, 0));
        const worker = new Worker("data:text/javascript," + encodeURIComponent(\`
          onmessage = ({ data: turn }) => {
            postMessage(0);
            Atomics.wait(turn, 0, 0);
            console.log("worker");
            (\${give})(turn, 2);
          };
        \`));
        dc.subscribe("console.log", args => {
          give(turn, 1);
          Atomics.wait(turn, 0, 1);
          args[0] = "table";
        });
        worker.onmessage = () => {
          console.table([1]);
          worker.terminate();
        };
        worker.postMessage(turn);
      `),
    ).toEqual(["worker", "table"]);
  });

  test("a subscriber that changes nothing leaves the output as it is", async () => {
    const script = `
      console.log("%s", "text", { a: 1 }, [1n]);
      console.group("group");
      console.count();
      console.table([{ a: 1 }]);
      console.table(5);
      console.table(5, ["a"]);
      console.table();
      console.groupEnd();
      console.dirxml(new Map([[1, 2]]));
    `;
    const [heard, unheard] = await Promise.all([run(`dc.subscribe("console.log", () => {});${script}`), run(script)]);
    expect(heard).toEqual(unheard);
  });

  test("a process warning is published on console.error", async () => {
    expect(
      await run(
        `
          dc.subscribe("console.error", args => {
            console.log(args.length, args[0].replace(process.pid, "pid").split("\\n")[0]);
            args[0] = "changed";
          });
          process.emitWarning("text");
        `,
        { stderr: "changed\n" },
      ),
    ).toEqual(["1 (node:pid) Warning: text"]);
  });
});

describe.concurrent("module.*", () => {
  const trace = (name: string, fields: string) => `
    const short = value => typeof value === "string" ? decodeURIComponent(value).split(/[\\\\/]/).at(-1) : value;
    for (const event of ["start", "end", "asyncStart", "asyncEnd", "error"])
      dc.subscribe("tracing:${name}:" + event, message => console.log(event, ...${fields}.map(short), message.error?.code ?? ""));
  `;

  test("require()", async () => {
    using dir = tempDir("dc-require", {
      "outer.cjs": `require("./inner.cjs"); require("fs"); require("node:path");`,
      "inner.cjs": `exports.inner = true;`,
      "imported.cjs": `exports.imported = true;`,
    });
    expect(
      await run(
        `
          ${trace("module.require", "[message.parentFilename, message.id]")}
          require("./outer.cjs");
          require("./inner.cjs");
          try { require("./missing.cjs"); } catch {}
          try { require(""); } catch {}
          require("node:module").createRequire(__dirname + "/made.cjs")("./inner.cjs");
          import("./imported.cjs");
        `,
        { cwd: String(dir) },
      ).then(lines => lines.map(line => line.trimEnd())),
    ).toEqual([
      "start [eval] outer.cjs",
      "start outer.cjs inner.cjs",
      "end outer.cjs inner.cjs",
      "start outer.cjs fs",
      "end outer.cjs fs",
      "start outer.cjs node:path",
      "end outer.cjs node:path",
      "end [eval] outer.cjs",
      "start [eval] inner.cjs",
      "end [eval] inner.cjs",
      "start [eval] missing.cjs",
      "error [eval] missing.cjs MODULE_NOT_FOUND",
      "end [eval] missing.cjs MODULE_NOT_FOUND",
      "start [eval] node:module",
      "end [eval] node:module",
      "start made.cjs inner.cjs",
      "end made.cjs inner.cjs",
      "start undefined imported.cjs",
      "end undefined imported.cjs",
    ]);
  });

  test("require() under a replaced Module.prototype.require", async () => {
    expect(
      await run(`
        const { prototype } = require("node:module");
        const original = prototype.require;
        ${trace("module.require", "[message.id]")}
        prototype.require = function (id) {
          console.log("replaced");
          return original.call(this, id);
        };
        require("node:os");
      `).then(lines => lines.map(line => line.trimEnd())),
    ).toEqual(["replaced", "start node:os", "end node:os"]);
  });

  test("the stores of module.require are entered while the module is evaluated", async () => {
    using dir = tempDir("dc-require-store", { "reads.cjs": `console.log(store.getStore());` });
    expect(
      await run(
        `
          globalThis.store = new (require("node:async_hooks").AsyncLocalStorage)();
          dc.channel("tracing:module.require:start").bindStore(store, ({ id }) => id);
          require("./reads.cjs");
          console.log(store.getStore());
        `,
        { cwd: String(dir) },
      ),
    ).toEqual(["./reads.cjs", "undefined"]);
  });

  test("import() ends and leaves its stores if Promise.prototype.then throws", async () => {
    expect(
      await run(`
        const store = new (require("node:async_hooks").AsyncLocalStorage)();
        dc.channel("tracing:module.import:start").bindStore(store);
        dc.subscribe("tracing:module.import:end", () => console.log("end"));
        process.on("unhandledRejection", () => {});
        Object.defineProperty(Promise.prototype, "then", { get() { throw new Error("read"); } });
        import("node:os");
        console.log(store.getStore());
      `),
    ).toEqual(["end", "undefined"]);
  });

  test("import()", async () => {
    using dir = tempDir("dc-import", {
      "outer.mjs": `import "./static.mjs"; await import("fs");`,
      "static.mjs": ``,
    });
    expect(
      await run(
        `
          ${trace("module.import", "[message.parentURL, message.url]")}
          import("./outer.mjs").then(() => import("./missing.mjs")).catch(() => console.log("caught"));
        `,
        { cwd: String(dir) },
      ).then(lines => lines.map(line => line.trimEnd())),
    ).toEqual([
      "start [eval] outer.mjs",
      "end [eval] outer.mjs",
      "start outer.mjs fs",
      "end outer.mjs fs",
      "asyncStart outer.mjs fs",
      "asyncEnd outer.mjs fs",
      "asyncStart [eval] outer.mjs",
      "asyncEnd [eval] outer.mjs",
      "start [eval] missing.mjs",
      "end [eval] missing.mjs",
      "error [eval] missing.mjs ERR_MODULE_NOT_FOUND",
      "asyncStart [eval] missing.mjs ERR_MODULE_NOT_FOUND",
      "asyncEnd [eval] missing.mjs ERR_MODULE_NOT_FOUND",
      "caught",
    ]);
  });

  test("an import() that fails is as unhandled as without a subscriber", async () => {
    expect(
      await run(`
        dc.subscribe("tracing:module.import:error", () => console.log("error"));
        process.on("unhandledRejection", error => console.log("unhandled", error.code));
        import("./missing.mjs");
      `),
    ).toEqual(["error", "unhandled ERR_MODULE_NOT_FOUND"]);
  });
});

describe.concurrent.skipIf(isWindows)("process.execve", () => {
  test("a subscriber can change the arguments and the environment", async () => {
    expect(
      await run(`
        dc.subscribe("process.execve", ({ execPath, args, env }) => {
          require("node:fs").writeSync(1, JSON.stringify({ execPath, args, env }) + "\\n");
          args[2] = "echo $A $B";
          env.push("B=2");
        });
        process.execve("/bin/sh", ["sh", "-c", "exit 1"], { A: "1" });
      `),
    ).toEqual([`{"execPath":"/bin/sh","args":["sh","-c","exit 1"],"env":["A=1"]}`, "1 2"]);
  });

  test("what a subscriber leaves behind is validated", async () => {
    expect(
      await run(`
        process.removeAllListeners("warning");
        dc.subscribe("process.execve", ({ args }) => args.push("a\\0b"));
        try {
          process.execve("/bin/sh", ["sh", "-c", "exit 1"], {});
        } catch (error) {
          console.log(error.code);
        }
      `),
    ).toEqual(["ERR_INVALID_ARG_VALUE"]);
  });
});

describe("child_process", () => {
  const recordSpawn = () =>
    record("tracing:child_process.spawn:", ["start", "end", "error"], (event, { process, error }) => [
      event,
      typeof process.pid,
      error?.code,
    ]);

  test("end has the pid", async () => {
    using published = recordSpawn();
    await once(spawn(bunExe(), ["--version"], { env: bunEnv }), "close");
    expect(published.log).toEqual([
      ["start", "undefined", undefined],
      ["end", "number", undefined],
    ]);
  });

  test("error has the error that is emitted", async () => {
    using published = recordSpawn();
    const message = published.until("error");
    const [error] = await once(spawn("/does/not/exist"), "error");
    expect((await message).error).toBe(error);
    expect(published.log).toEqual([
      ["start", "undefined", undefined],
      ["error", "undefined", "ENOENT"],
    ]);
  });

  test("a subscriber of start can change the arguments and the environment", async () => {
    using _ = listen("tracing:child_process.spawn:start", ({ options }) => {
      options.args.push("added");
      options.envPairs.push("ADDED=a=b");
    });
    const script = `console.log(process.argv.at(-1), process.env.ADDED, process.env.OWN)`;
    const { stdout } = await promisify(execFile)(bunExe(), ["-e", script], { env: { ...bunEnv, OWN: "c=d" } });
    expect(stdout).toBe("added a=b c=d\n");
  });

  test("a subscriber can look at a process that has not been spawned", async () => {
    using published = record("", ["child_process"], (_, { process }) => {
      const { connected, spawnfile, stdin, stdout, stderr, stdio } = process;
      return { connected, spawnfile, stdin, stdout, stderr, stdio };
    });
    const { stdout } = await promisify(execFile)(bunExe(), ["-p", "1"], { env: bunEnv });
    expect(stdout).toBe("1\n");
    expect(published.log).toEqual([{ connected: false, spawnfile: null }]);
  });
});

describe.each<[string, () => net.Server]>([
  ["net", () => net.createServer()],
  ["tls", () => tls.createServer(certificate)],
  ["http", () => http.createServer()],
  ["https", () => https.createServer(certificate)],
  ["http2", () => http2.createServer()],
])("net.server.listen of %s", (_, createServer) => {
  const recordListen = () =>
    record("tracing:net.server.listen:", ["asyncStart", "asyncEnd", "error"], (event, { options, error }) => [
      event,
      options ? { ...options } : error?.code,
    ]);

  test.each<[unknown[], object]>([
    [[], {}],
    [[() => {}], {}],
    [[0], { port: 0 }],
    [[0, "127.0.0.1", 5, () => {}], { port: 0, host: "127.0.0.1" }],
    [[{ port: 0, own: 1 }], { port: 0, own: 1 }],
  ])("listen(...%p)", async (args, options) => {
    using published = recordListen();
    await using server = createServer();
    await once((server as any).listen(...args), "listening");
    expect(published.log).toStrictEqual([
      ["asyncStart", options],
      ["asyncEnd", undefined],
    ]);
  });

  test("a subscriber can change the options", async () => {
    await using taken = await listening(net.createServer());
    using _ = listen("tracing:net.server.listen:asyncStart", ({ options }) => (options.port = 0));
    await using server = createServer();
    await once(server.listen(taken.port, "127.0.0.1"), "listening");
    expect((server.address() as net.AddressInfo).port).not.toBe(taken.port);
  });

  test("the port is taken", async () => {
    await using taken = await listening(net.createServer());
    using published = recordListen();
    await once(createServer().listen(taken.port, "127.0.0.1"), "error");
    expect(published.log.slice(1)).toEqual([["error", "EADDRINUSE"]]);
  });

  test("listen() throws", () => {
    using published = recordListen();
    expect(() => createServer().listen({ port: 0, signal: 1 as any })).toThrow();
    expect(published.log.slice(1)).toEqual([["error", "ERR_INVALID_ARG_TYPE"]]);
  });
});

test.concurrent.each(["net", "http"])("listen(port) of %s takes no option from Object.prototype", async name => {
  expect(
    await run(`
      const server = require("node:${name}").createServer();
      const added = { host: "192.0.2.1", path: "polluted.sock", fd: 0, signal: 1 };
      Object.assign(Object.prototype, added);
      server.listen(0);
      for (const key of Object.keys(added)) delete Object.prototype[key];
      server.once("listening", () => {
        console.log(typeof server.address().port);
        server.close();
      });
    `),
  ).toEqual(["number"]);
});

test.concurrent.each(["net", "http"])("net.server.socket of %s if a 'connection' listener throws", async name => {
  expect(
    await run(`
      dc.subscribe("net.server.socket", ({ socket }) => {
        console.log("published");
        socket.destroy();
        server.close();
      });
      process.on("uncaughtException", () => {});
      const server = require("node:${name}").createServer().on("connection", () => {
        console.log("connection");
        throw new Error("listener");
      });
      server.listen(0, "127.0.0.1", () => {
        require("node:net").connect(server.address().port, "127.0.0.1").on("error", () => {}).end("GET / HTTP/1.1\\r\\n");
      });
    `),
  ).toEqual(["connection", "published"]);
});

describe.each<[string, (server: http.Server) => net.Server]>([
  ["its own", server => server],
  ["handed to it", server => net.createServer(socket => server.emit("connection", socket))],
])("http.server.* on connections %s", (_, front) => {
  const get = (path: string, fields = "Host: a\r\n") => `GET ${path} HTTP/1.1\r\n${fields}\r\n`;
  const last = get("/last", "Host: a\r\nConnection: close\r\n");

  const recordServer = () =>
    record(
      "http.server.",
      ["response.created", "request.start", "response.finish"],
      (event, { request, response }) => `${event} ${request.url} ${response.statusCode}`,
    );

  /** The status codes and bodies of the responses to `requests`, the last of which closes the connection. */
  async function exchange(server: http.Server, requests: string) {
    await using listener = await listening(front(server));
    const socket = net.connect(listener.port, "127.0.0.1");
    socket.write(requests);
    const text = Buffer.concat(await socket.toArray()).toString();
    return text
      .split("HTTP/1.1 ")
      .slice(1)
      .map(response => `${response.slice(0, 3)} ${response.split("\r\n\r\n")[1]}`);
  }

  /** Answers /first when /last has arrived, so that the responses in between have to wait. */
  function pipelining(onRequest = (req: http.IncomingMessage) => {}) {
    let first: http.ServerResponse;
    return http.createServer((req, res) => {
      onRequest(req);
      if (req.url === "/first") return void (first = res);
      if (!res.writableEnded) res.end(req.url);
      if (req.url === "/last") first.end("/first");
    });
  }

  test("messages", async () => {
    const server = http.createServer((req, res) => res.end());
    using published = record(
      "http.server.",
      ["response.created", "request.start", "response.finish"],
      (event, { request, response, socket, ...rest }) => ({
        event,
        response: response.req === request,
        socket: socket && socket === request.socket,
        hasSocket: event === "response.finish" && response.socket === socket,
        rest,
      }),
    );
    await exchange(server, last);
    expect(published.log).toEqual([
      { event: "response.created", response: true, socket: undefined, hasSocket: false, rest: {} },
      { event: "request.start", response: true, socket: true, hasSocket: false, rest: { server } },
      { event: "response.finish", response: true, socket: true, hasSocket: true, rest: { server } },
    ]);
  });

  test.each([
    ["no Host", get("/", ""), 400],
    ["an expectation that is not met", get("/", "Host: a\r\nExpect: nothing\r\nConnection: close\r\n"), 417],
  ])("what the server answers by itself: %s", async (_, request, status) => {
    using published = recordServer();
    const onRequest = mock(() => {});
    expect(await exchange(http.createServer(onRequest), request)).toEqual([`${status} 0`]);
    expect(onRequest).not.toHaveBeenCalled();
    expect(published.log).toEqual(["response.created / 200", "request.start / 200", `response.finish / ${status}`]);
  });

  test("the answer to a request without Host waits for its turn", async () => {
    using _ = listen("http.server.request.start", ({ request }) => {
      if (request.url === "/no-host") setImmediate(() => first.end("/first"));
    });
    let first: http.ServerResponse;
    const server = http.createServer((req, res) => void (first = res));
    expect(await exchange(server, get("/first") + get("/no-host", ""))).toEqual(["200 /first", "400 0"]);
  });

  test.each([
    ["upgrade", get("/", "Host: a\r\nConnection: upgrade\r\nUpgrade: b\r\n")],
    ["connect", "CONNECT a:1 HTTP/1.1\r\nHost: a:1\r\n\r\n"],
  ])("nothing is published for '%s'", async (event, request) => {
    using published = recordServer();
    const server = http.createServer().on(event, (req, socket) => socket.end("HTTP/1.1 200 OK\r\n\r\nraw"));
    expect(await exchange(server, request)).toEqual(["200 raw"]);
    expect(published.log).toEqual([]);
  });

  test.each(["response.created", "request.start"])(
    "a subscriber of %s can end a response that has to wait",
    async event => {
      using _ = listen(`http.server.${event}`, ({ request, response }) => {
        if (request.url === "/early") response.end("early");
      });
      using published = recordServer();
      expect(await exchange(pipelining(), get("/first") + get("/early") + last)).toEqual([
        "200 /first",
        "200 early",
        "200 /last",
      ]);
      expect(published.log.filter(line => line.startsWith("response.finish"))).toEqual([
        "response.finish /first 200",
        "response.finish /early 200",
        "response.finish /last 200",
      ]);
    },
  );

  test("what a subscriber of request.start enters lasts for that request", async () => {
    const store = new AsyncLocalStorage();
    using _ = listen("http.server.request.start", ({ request }) => {
      if (request.url === "/first") store.enterWith("first");
    });
    const seen: unknown[] = [];
    await exchange(
      pipelining(() => seen.push(store.getStore())),
      get("/first") + last,
    );
    expect(seen).toEqual(["first", undefined]);
  });
});

test.concurrent.each([
  ["its own", `server`],
  ["handed to it", `net.createServer({ allowHalfOpen: true }, socket => server.emit("connection", socket))`],
])("a response whose constructor throws after it was published is not sent, on connections %s", async (_, front) => {
  expect(
    await run(`
      const http = require("node:http");
      const net = require("node:net");
      let first;
      process.on("uncaughtException", () => setImmediate(() => first.end("first")));
      dc.subscribe("http.server.response.created", ({ request, response }) => {
        if (request.url === "/throws") response.end("early");
      });
      class ServerResponse extends http.ServerResponse {
        constructor(request, options) {
          super(request, options);
          if (request.url === "/throws") throw new Error("constructor");
        }
      }
      const server = http.createServer({ ServerResponse }, (request, response) => (first = response));
      server.httpAllowHalfOpen = true;
      const listener = ${front}.listen(0, "127.0.0.1", async () => {
        const socket = net.connect(listener.address().port, "127.0.0.1");
        socket.end("GET /first HTTP/1.1\\r\\nHost: a\\r\\n\\r\\nGET /throws HTTP/1.1\\r\\nHost: a\\r\\n\\r\\n");
        console.log(Buffer.concat(await socket.toArray()).toString().split("\\r\\n\\r\\n").slice(1).join());
        listener.close();
      });
    `),
  ).toEqual(["first"]);
});

test("http.server.* on the HTTP/1.1 connections of an HTTP/2 server", async () => {
  using published = record(
    "http.server.",
    ["response.created", "request.start", "response.finish"],
    (event, { response }) => `${event} ${response.statusCode}`,
  );
  await using server = await listening(http2.createSecureServer({ ...certificate, allowHTTP1: true }, () => {}));
  const socket = tls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false });
  socket.write("GET / HTTP/1.1\r\n\r\n");
  await socket.toArray();
  expect(published.log).toEqual(["response.created 200", "request.start 200", "response.finish 400"]);
});

test("http.client.request.error if a proxy refuses the tunnel", async () => {
  await using proxy = await listening(
    net.createServer(socket => socket.once("data", () => socket.end("HTTP/1.1 403 No\r\n\r\n"))),
  );
  using published = record("http.client.request.", ["error"], (_, { error }) => error);
  const agent = new https.Agent({ proxyEnv: { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` } } as any);
  const [error] = await once(https.get({ host: "127.0.0.1", port: 1, agent }), "error");
  expect(error.code).toBe("ERR_PROXY_TUNNEL");
  expect(published.log).toEqual([error]);
});

describe("http2.*", () => {
  const recordStreams = (
    side: "client" | "server",
    describe = (event: string, { stream }) => `${event} ${stream.id}`,
  ) =>
    record(
      `http2.${side}.stream.`,
      ["created", "start", "bodyChunkSent", "bodySent", "finish", "error", "close"],
      describe,
    );

  async function connect(onStream: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void) {
    const server = await listening(http2.createServer().on("stream", onStream));
    const session = http2.connect(`http://127.0.0.1:${server.port}`);
    return Object.assign(session, {
      async [Symbol.asyncDispose]() {
        session.destroy();
        await server[Symbol.asyncDispose]();
      },
    });
  }

  const respond = (stream: http2.ServerHttp2Stream) => {
    stream.respond();
    stream.end();
  };
  const closed = (stream: http2.Http2Stream) => new Promise(resolve => stream.resume().on("close", resolve));

  test.each(["connecting", "connected"])("a request on a session that is %s", async state => {
    await using session = await connect(respond);
    if (state === "connected") await once(session, "remoteSettings");
    const store = new AsyncLocalStorage();
    using published = recordStreams("client", event => `${event} ${store.getStore()}`);
    await closed(store.run("store", () => session.request({ ":method": "POST" }).end("body")));
    expect(published.log).toEqual([
      "created store",
      "start store",
      "bodyChunkSent store",
      "bodySent store",
      "finish store",
      "close store",
    ]);
  });

  test.each(["connecting", "connected"])("a subscriber can make a request on a session that is %s", async state => {
    const paths: unknown[] = [];
    await using session = await connect((stream, headers) => {
      paths.push(headers[":path"]);
      respond(stream);
    });
    if (state === "connected") await once(session, "remoteSettings");
    let inner!: http2.ClientHttp2Stream;
    using _ = listen("http2.client.stream.created", ({ headers }) => {
      if (headers[":path"] === "/outer") inner = session.request({ ":path": "/inner" });
    });
    await Promise.all([closed(session.request({ ":path": "/outer" })), closed(inner)]);
    expect(paths).toEqual(["/outer", "/inner"]);
  });

  test.each<[string, (session: http2.ClientHttp2Session) => http2.ClientHttp2Stream]>([
    ["its signal is aborted", session => session.request({}, { signal: AbortSignal.abort() })],
    ["the session is destroyed", session => (session.destroy(), session.request())],
    ["its path is invalid", session => session.request({ ":path": "/a b" })],
    ["it announces a body that it cannot have", session => session.request({ "content-length": 1 })],
    [
      "there is no id left",
      session => {
        (session as any).setNextStreamID(2 ** 31 - 1);
        session.request().on("error", () => {});
        return session.request();
      },
    ],
  ])("a request that is not sent because %s", async (_, request) => {
    await using session = await connect(respond);
    await once(session, "remoteSettings");
    using published = recordStreams("client");
    await closed(request(session).on("error", () => {}));
    expect(published.log.filter(line => line.endsWith("undefined"))).toEqual([
      "created undefined",
      "close undefined",
      "error undefined",
    ]);
  });

  test("nothing is published for a request() that throws", async () => {
    await using session = await connect(respond);
    await once(session, "remoteSettings");
    session.on("error", () => {});
    using published = recordStreams("client");
    expect(() => session.request({ ":path": "/", ":status": 200 })).toThrow();
    expect(published.log).toEqual([]);
  });

  test("a subscriber of created can destroy the session", async () => {
    await using session = await connect(stream => stream.on("error", () => {}));
    await once(session, "remoteSettings");
    using published = recordStreams("client");
    using _ = listen("http2.client.stream.created", ({ stream }) => stream.session.destroy());
    await closed(session.request().on("error", () => {}));
    expect(published.log.slice(-2)).toEqual(["close 1", "error 1"]);
  });

  test.each<[string, number, http2.OutgoingHttpHeaders, (stream: http2.ServerHttp2Stream) => void]>([
    ["respond()", 5, {}, respond],
    ["respond() to HEAD", 13, { ":method": "HEAD" }, stream => stream.respond()],
    ["respond() with a list", 5, {}, stream => stream.respond([":status", "200"] as any, { endStream: true })],
    [
      "respond() with trailers",
      37,
      {},
      stream => {
        stream.respond({}, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ a: "b" })).end();
      },
    ],
    ["respondWithFile()", 5, {}, stream => stream.respondWithFile(import.meta.path)],
  ])("finish of %s", async (_, flags, headers, onStream) => {
    await using session = await connect(onStream);
    using published = record("http2.server.stream.", ["finish"], (_, { stream, headers, flags }) => ({
      status: +headers[":status"],
      areSent: headers === stream.sentHeaders,
      flags,
    }));
    await closed(session.request(headers));
    expect(published.log).toEqual([{ status: 200, areSent: true, flags }]);
  });

  test("a response without a body that is sent after the request has ended", async () => {
    const emitted: string[] = [];
    await using session = await connect(stream => {
      for (const event of ["aborted", "finish"]) stream.on(event, () => emitted.push(event));
      stream.resume().on("end", () => setImmediate(() => stream.respond({ ":status": 204 })));
    });
    using published = recordStreams("server", (event, { stream }) => `${event} ${stream.closed} ${stream.destroyed}`);
    await closed(session.request());
    expect(published.log).toEqual([
      "created false false",
      "start false false",
      "finish false false",
      "close true false",
    ]);
    expect(emitted).toEqual(["finish"]);
  });

  test("a pushed stream", async () => {
    using onServer = recordStreams("server");
    using onClient = recordStreams("client");
    await using session = await connect(stream => {
      stream.pushStream({}, (error, pushed) => {
        onServer.log.push("callback 2");
        respond(pushed);
      });
      onServer.log.push("returned 2");
      respond(stream);
    });
    const pushed = once(session, "stream").then(([stream]) => closed(stream));
    await Promise.all([closed(session.request()), pushed]);
    const ofPushed = ({ log }) => log.filter(line => line.endsWith("2"));
    expect(ofPushed(onServer)).toEqual(["created 2", "returned 2", "start 2", "callback 2", "finish 2", "close 2"]);
    expect(ofPushed(onClient)).toEqual(["created 2", "start 2", "bodySent 2", "finish 2", "close 2"]);
  });

  test("nothing is published for a push that fails", async () => {
    using published = recordStreams("server");
    await using session = await connect(stream => stream.pushStream({ ":invalid": 1 }, () => respond(stream)));
    await closed(session.request());
    expect(published.log.filter(line => line.endsWith("2"))).toEqual([]);
  });

  test("a push that the client refuses", async () => {
    using published = recordStreams("client", (event, { stream }) => `${event} ${stream.id} ${stream.rstCode ?? 0}`);
    await using session = await connect(stream => {
      stream.pushStream({}, (error, pushed) => pushed.on("error", () => {}));
      respond(stream);
    });
    const { promise, resolve } = Promise.withResolvers<any>();
    session.on("stream", pushed => pushed.on("error", resolve).close(http2.constants.NGHTTP2_REFUSED_STREAM));
    session.request().resume();
    expect((await promise).code).toBe("ERR_HTTP2_STREAM_ERROR");
    expect(published.log.filter(line => line.includes(" 2 "))).toEqual([
      "created 2 0",
      "start 2 0",
      "bodySent 2 0",
      "close 2 7",
      "error 2 7",
    ]);
  });
});

describe("sqlite.db.query", () => {
  const recordQueries = () => record("", ["sqlite.db.query"], (_, { sql }) => sql);

  function open() {
    const db = new DatabaseSync(":memory:");
    db.exec("create table t(id integer primary key, x); create table log(id integer primary key)");
    return db;
  }

  test("message", () => {
    using db = open();
    using published = record("", ["sqlite.db.query"], (_, message) => message);
    db.prepare("select ?, ?").get("it's", 1);
    expect(published.log).toEqual([{ sql: "select 'it''s', 1.0", database: db, duration: expect.any(Number) }]);
    expect(published.log[0].database).toBe(db);
  });

  test("every way to finish a statement", () => {
    using db = open();
    db.exec("insert into t(x) values (1), (2)");
    const unfinished = db.prepare("select 5 from t");
    using published = recordQueries();
    db.exec("select 1; select 2");
    db.prepare("select 3").all();
    for (const _ of db.prepare("select 4 from t").iterate()) break;
    unfinished.iterate().next();
    expect(published.log).toEqual(["select 1;", "select 2", "select 3", "select 4 from t"]);
    unfinished.run();
    expect(published.log.slice(4)).toEqual(["select 5 from t", "select 5 from t"]);
  });

  test("a subscriber that writes to the database does not change the result of run()", () => {
    using db = open();
    using _ = listen("sqlite.db.query", ({ sql }) => {
      if (!sql.includes("log")) db.exec("insert into log values (100), (101), (102)");
    });
    expect(db.prepare("insert into t(x) values (?)").run(1)).toEqual({ changes: 1, lastInsertRowid: 1 });
  });

  test("a statement throws what it throws without a subscriber", () => {
    using db = open();
    db.function("fails", () => {
      throw new Error("function");
    });
    using published = recordQueries();
    expect(() => db.prepare("select fails()").get()).toThrow("function");
    expect(() => db.prepare("select 9007199254740993").get()).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    expect(published.log).toEqual(["select fails()", "select 9007199254740993"]);
  });

  test("a statement that a function runs is published before the function goes on", () => {
    using db = open();
    const store = new AsyncLocalStorage();
    using published = record("", ["sqlite.db.query"], (_, { sql }) => `${sql} ${store.getStore()}`);
    db.function("nested", () => store.run("inner", () => db.prepare("select 2").get()![2]));
    db.exec("select nested(); select 3");
    expect(published.log).toEqual(["select 2 inner", "select nested(); undefined", "select 3 undefined"]);
  });

  test("a subscriber cannot close the database", () => {
    using db = open();
    using published = record("", ["sqlite.db.query"], () => {
      try {
        db.close();
      } catch (error: any) {
        return error.code;
      }
    });
    db.exec("select 1");
    expect(published.log).toEqual(["ERR_INVALID_STATE"]);
    expect(db.isOpen).toBe(true);
  });
});

test.concurrent("node.test", async () => {
  using dir = tempDir("dc-node-test", {
    "traced.test.js": `
      const dc = require("node:diagnostics_channel");
      const { test, describe, it, before, beforeEach, afterEach } = require("node:test");
      const store = new (require("node:async_hooks").AsyncLocalStorage)();
      const tracing = dc.tracingChannel("node.test");
      tracing.start.bindStore(store, ({ name }) => name);
      for (const event of ["start", "end", "error"])
        tracing[event].subscribe(({ name, type, nesting, error }) =>
          console.log(event, type, nesting, name, "in", store.getStore(), ...(error ? [error.message, error.cause?.message] : [])));

      test("passes", async t => {
        await t.test("subtest", () => console.log("body in", store.getStore()));
      });
      test("throws", () => { throw new Error("thrown"); });
      describe("beforeEach fails", () => {
        beforeEach(() => { throw new Error("hook"); });
        it("child", () => {});
      });
      describe("afterEach fails", () => {
        afterEach(() => { throw new Error("hook"); });
        it("child", () => {});
      });
      describe("before fails", () => {
        before(() => { throw new Error("hook"); });
        it("child", () => {});
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "traced.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    start suite 0 beforeEach fails in beforeEach fails
    start suite 0 afterEach fails in afterEach fails
    start suite 0 before fails in before fails
    start test 0 passes in passes
    start test 1 subtest in subtest
    body in subtest
    end test 1 subtest in subtest
    end test 0 passes in passes
    start test 0 throws in throws
    error test 0 throws in throws thrown undefined
    end test 0 throws in throws
    start test 1 child in child
    error test 1 child in child failed running beforeEach hook hook
    end test 1 child in child
    end suite 0 beforeEach fails in beforeEach fails
    start test 1 child in child
    error test 1 child in child failed running afterEach hook hook
    end test 1 child in child
    end suite 0 afterEach fails in afterEach fails
    error suite 0 before fails in before fails failed running before hook hook
    start test 1 child in child
    end test 1 child in child
    end suite 0 before fails in before fails
    start test 0 <root> in <root>
    end test 0 <root> in <root>"
  `);
  expect(exitCode).toBe(1);
});

test.concurrent("node.test: a subscriber that comes during a test hears the rest of it", async () => {
  using dir = tempDir("dc-node-test-late", {
    "traced.test.js": `
      const dc = require("node:diagnostics_channel");
      const { test } = require("node:test");
      test("over before", () => {});
      test("outer", async t => {
        t.afterEach(() => { throw new Error("hook"); });
        await t.test("inner", () => {
          for (const event of ["start", "end", "error"])
            dc.subscribe("tracing:node.test:" + event, ({ name, nesting, error }) => console.log(event, nesting, name, error?.message));
        });
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "traced.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    error 1 inner failed running afterEach hook
    end 1 inner undefined
    end 0 outer undefined"
  `);
  expect(exitCode).toBe(1);
});

const recordRequests = (describe = (event: string, message: any): unknown => event) =>
  record(
    "undici:",
    [
      "client:beforeConnect",
      "client:connected",
      "client:connectError",
      "client:sendHeaders",
      "request:create",
      "request:bodyChunkSent",
      "request:bodySent",
      "request:headers",
      "request:bodyChunkReceived",
      "request:trailers",
      "request:error",
    ],
    describe,
  );

/** A port that nothing listens on. */
async function closedPort() {
  await using server = await listening(net.createServer());
  return server.port;
}

describe("undici:* of fetch()", () => {
  /** `/to?<url>` redirects there, `/hang` sends a part of a body, and anything else gets the headers it was sent. */
  const serve = (options = {}) =>
    Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const { pathname, search } = new URL(request.url);
        await request.bytes();
        if (pathname === "/to") return new Response(null, { status: 302, headers: { location: search.slice(1) } });
        if (pathname === "/hang") return new Response(new ReadableStream({ start: body => body.enqueue("part") }));
        return Response.json(request.headers);
      },
      ...options,
    });

  test("messages", async () => {
    using server = serve({ fetch: () => new Response("pong", { status: 201, headers: { a: "b", date: "now" } }) });
    const { host, origin, port } = server.url;
    let created: unknown;
    using published = recordRequests((event, { request, socket, chunk, response, ...rest }) => {
      if (event === "request:create") created = request;
      return {
        event,
        request:
          event === "request:create" ? { ...request, body: typeof request.body } : request && request === created,
        socket: socket && [socket.remoteAddress, socket.remotePort],
        chunk: chunk && Buffer.from(chunk).toString(),
        response: response && { ...response, headers: response.headers.map(String) },
        ...rest,
      };
    });

    const headers = { "accept": "x", "accept-encoding": "y", "content-type": "z", "user-agent": "w" };
    await (await fetch(`${origin}/path?query#hash`, { method: "POST", body: "ping", headers })).text();

    const connectParams = {
      host,
      hostname: "127.0.0.1",
      protocol: "http:",
      port,
      servername: null,
      localAddress: null,
    };
    const socket = ["127.0.0.1", server.port];
    expect(published.log).toEqual([
      {
        event: "request:create",
        request: {
          method: "POST",
          abort: null,
          body: "object",
          completed: false,
          aborted: false,
          upgrade: null,
          path: "/path?query",
          origin,
          protocol: "http:",
          idempotent: false,
          blocking: true,
          reset: null,
          host: null,
          contentLength: 4,
          contentType: "z",
          headers: ["Accept", "x", "Accept-Encoding", "y", "Content-Type", "z", "User-Agent", "w"],
          expectContinue: false,
          servername: null,
        },
      },
      { event: "client:beforeConnect", connectParams },
      { event: "client:connected", connectParams: { ...connectParams, version: "h1" }, socket },
      {
        event: "client:sendHeaders",
        request: true,
        socket,
        headers:
          "POST /path?query HTTP/1.1\r\nAccept: x\r\nAccept-Encoding: y\r\nContent-Type: z\r\nUser-Agent: w\r\n" +
          `Connection: keep-alive\r\nHost: ${host}\r\nContent-Length: 4\r\n`,
      },
      { event: "request:bodyChunkSent", request: true, chunk: "ping" },
      { event: "request:bodySent", request: true },
      {
        event: "request:headers",
        request: true,
        response: {
          statusCode: 201,
          statusText: "Created",
          headers: ["Date", "now", "a", "b", "content-type", "text/plain;charset=utf-8", "Content-Length", "4"],
        },
      },
      { event: "request:bodyChunkReceived", request: true, chunk: "pong" },
      { event: "request:trailers", request: true, trailers: [] },
    ]);
  });

  test("create is published before fetch() returns, the rest before the body is read", async () => {
    using server = serve();
    using published = recordRequests();
    const response = fetch(server.url);
    expect(published.log).toEqual(["request:create"]);
    await (await response).text();
    expect(published.log.at(-1)).toBe("request:trailers");
  });

  test("a connection that is used again is not announced", async () => {
    using server = serve();
    await (await fetch(server.url)).text();
    using published = recordRequests();
    await (await fetch(server.url)).text();
    expect(published.log).toEqual([
      "request:create",
      "client:sendHeaders",
      "request:bodySent",
      "request:headers",
      "request:bodyChunkReceived",
      "request:trailers",
    ]);
  });

  describe("socket has the addresses of the connection that carries the request", () => {
    const recordPorts = () =>
      record("undici:client:", ["sendHeaders"], (_, { socket }) => `${socket.localPort} ${socket.remotePort}`);

    test.each<[string, (listener: http.RequestListener) => net.Server]>([
      ["http", listener => http.createServer(listener)],
      ["https", listener => https.createServer(certificate, listener)],
      ["http2", listener => http2.createSecureServer(certificate, listener as any)],
    ])("%s", async (kind, createServer) => {
      const seen: string[] = [];
      const sockets = new Set<net.Socket>();
      const start = () =>
        listening(
          createServer(({ socket, url }, res) => {
            seen.push(`${socket.remotePort} ${socket.localPort}`);
            if (url !== "/") res.writeHead(302, { "location": url!.slice(2), "content-length": 0 });
            res.end();
          }).on("connection", socket => sockets.add(socket)),
        );
      await using first = await start();
      await using second = await start();
      using _ = { [Symbol.dispose]: () => sockets.forEach(socket => socket.destroy()) };
      const [a, b] = [first, second].map(({ port }) => `${kind === "http" ? "http" : "https"}://127.0.0.1:${port}/`);
      const load = async (url: string) => {
        const options = { tls: { rejectUnauthorized: false }, protocol: kind === "http2" ? kind : undefined };
        await (await fetch(url, options as any)).text();
      };

      // Nobody has asked for the addresses of this connection.
      await load(a);
      using published = recordPorts();
      for (const url of [a, a, `${a}?${b}`, b, `${b}?${a}`]) await load(url);

      expect(published.log).toEqual(seen.slice(1));
      expect(seen).toHaveLength(8);
      expect(new Set(seen).size).toBe(2);
    });

    test("several connections to the same server", async () => {
      const seen: Record<string, number> = {};
      const waiting: http.ServerResponse[] = [];
      await using server = await listening(
        http.createServer(({ socket, url }, res) => {
          seen[url!] = socket.remotePort!;
          if (waiting.push(res) === 3) waiting.splice(0).forEach(res => res.end());
        }),
      );
      using _ = { [Symbol.dispose]: () => server.closeAllConnections() };
      using published = record("undici:client:", ["sendHeaders"], (_, { request, socket }) => [
        request.path,
        socket.localPort,
      ]);
      for (const round of [1, 2, 3]) {
        await Promise.all(
          [1, 2, 3].map(async i => (await fetch(`http://127.0.0.1:${server.port}/${round}/${i}`)).text()),
        );
      }
      expect(Object.fromEntries(published.log)).toEqual(seen);
      expect(new Set(Object.values(seen)).size).toBe(3);
    });

    describe("through a proxy", () => {
      ignoreAmbientNoProxy();

      test("those of the tunnel", async () => {
        const seen: string[] = [];
        const sockets = new Set<net.Socket>();
        using server = serve({ tls: certificate });
        await using proxy = await listening(
          createConnectProxy().on("connection", socket => {
            sockets.add(socket);
            seen.push(`${socket.remotePort} ${socket.localPort}`);
          }),
        );
        using _ = { [Symbol.dispose]: () => sockets.forEach(socket => socket.destroy()) };
        using published = recordPorts();
        const options = { proxy: `http://127.0.0.1:${proxy.port}`, tls: { rejectUnauthorized: false } };
        await (await fetch(server.url, options)).text();
        await (await fetch(server.url, options)).text();
        expect(published.log).toEqual([seen[0], seen[0]]);
        expect(seen).toHaveLength(1);
      });
    });

    test.skipIf(!isIPv6())("IPv6", async () => {
      using server = serve({ hostname: "::1" });
      using published = record("undici:client:", ["sendHeaders"], (_, { socket }) => ({ ...socket, localPort: 0 }));
      await (await fetch(`http://[::1]:${server.port}`)).text();
      await (await fetch(`http://[::1]:${server.port}`)).text();
      const socket = {
        remoteAddress: "::1",
        remoteFamily: "IPv6",
        remotePort: server.port,
        localAddress: "::1",
        localFamily: "IPv6",
        localPort: 0,
        _host: null,
      };
      expect(published.log).toEqual([socket, socket]);
    });

    test.skipIf(isWindows)("a Unix socket has none", async () => {
      using dir = tempDir("dc-unix", {});
      const unix = `${dir}/socket`;
      using _ = serve({ unix, port: undefined, hostname: undefined });
      using published = recordPorts();
      await (await fetch("http://localhost", { unix })).text();
      await (await fetch("http://localhost", { unix })).text();
      expect(published.log).toEqual(["undefined undefined", "undefined undefined"]);
    });

    test("the connection is lost, and the request sent again", async () => {
      const seen: string[] = [];
      await using server = await listening(
        net.createServer(socket =>
          socket
            .on("error", () => {})
            .on("data", () => {
              if (seen.push(`${socket.remotePort} ${socket.localPort}`) === 2) socket.destroy();
              else socket.write(`HTTP/1.1 204 OK\r\nConnection: ${seen.length > 1 ? "close" : "keep-alive"}\r\n\r\n`);
            }),
        ),
      );
      using published = recordPorts();
      await fetch(`http://127.0.0.1:${server.port}`);
      await fetch(`http://127.0.0.1:${server.port}`);
      expect(published.log).toEqual(seen);
      expect(seen).toEqual([seen[0], seen[0], expect.any(String)]);
    });

    test.concurrent("HTTP/3 does not get those of the request that redirected to it", async () => {
      using target = serve({ tls: certificate, http3: true });
      using origin = serve();
      expect(
        await run(
          `
            const load = async url => (await fetch(url, { tls: { rejectUnauthorized: false } })).text();
            load("${target.url}").then(() => {
              dc.subscribe("undici:client:sendHeaders", ({ socket }) => console.log(socket.alpnProtocol, socket.remotePort));
              return load("${origin.url}to?${target.url}");
            });
          `,
          { env: { BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT: "1" } },
        ),
      ).toEqual([`undefined ${origin.port}`, "h3 undefined"]);
    });
  });

  test("the headers of the response are buffers with the bytes that were sent", async () => {
    await using server = await listening(
      net.createServer(socket =>
        socket
          .on("error", () => {})
          .once("data", () => socket.end("HTTP/1.1 404 No\r\nA: \xe9\r\nb:\r\nContent-Length: 0\r\n\r\n", "latin1")),
      ),
    );
    using published = record("undici:request:", ["headers"], (_, { response }) => response.headers);
    await fetch(`http://127.0.0.1:${server.port}`);
    await new Promise(resolve => (new WebSocket(`ws://127.0.0.1:${server.port}`).onclose = resolve));
    const headers = ["A", "\xe9", "b", "", "Content-Length", "0"].map(text => Buffer.from(text, "latin1"));
    expect(published.log).toStrictEqual([headers, headers]);
  });

  test("a subscriber that comes in the turn of the call misses create and the chunks", async () => {
    using server = serve();
    using _ = listen("undici:request:error", () => {});
    const response = fetch(server.url);
    using published = recordRequests((event, { socket, headers, response }) => [
      event,
      socket?.remotePort,
      headers?.slice(0, 5),
      response?.statusCode,
    ]);
    await (await response).text();
    expect(published.log.map(line => line.filter(Boolean))).toEqual([
      ["client:beforeConnect"],
      ["client:connected", server.port],
      ["client:sendHeaders", server.port, "GET /"],
      ["request:bodySent"],
      ["request:headers", 200],
      ["request:trailers"],
    ]);
  });

  test("everything is published in the async context of the call", async () => {
    using server = serve();
    const store = new AsyncLocalStorage();
    using published = recordRequests((_, { request }) => request && `${request.path.slice(-1)} ${store.getStore()}`);
    await Promise.all(
      ["a", "b"].map(name => store.run(name, async () => (await fetch(`${server.url}to?/${name}`)).text())),
    );
    expect(new Set(published.log)).toEqual(new Set(["a a", "b b", undefined]));
  });

  test.each<[string, (request: any) => void, object]>([
    [
      "addHeader()",
      request => request.addHeader("added", 1).addHeader("list", ["a", "b"]),
      { added: "1", list: "a, b" },
    ],
    ["push()", request => request.headers.push("added", "é"), { added: "é", own: "own" }],
    ["a string of two-byte characters", request => request.headers.push("added", "é€".slice(0, 1)), { added: "é" }],
    ["a new list", request => (request.headers = ["added", "1"]), { added: "1", own: undefined, accept: "*/*" }],
    ["host", request => request.addHeader("host", "example.com"), { host: "example.com" }],
    ["connection", request => request.addHeader("connection", "close"), { connection: "close" }],
  ])("a subscriber of create changes the headers: %s", async (_, change, expected) => {
    using server = serve();
    using __ = listen("undici:request:create", ({ request }) => change(request));
    const received: any = await (await fetch(server.url, { headers: { own: "own" } })).json();
    expect(Object.fromEntries(Object.keys(expected).map(name => [name, received[name]]))).toEqual(expected);
  });

  test("a subscriber of create closes the connection of one request", async () => {
    using server = serve();
    using _ = listen("undici:request:create", ({ request }) => (request.reset = request.path !== "/"));
    using published = record("undici:client:", ["sendHeaders"], (_, { headers }) => headers.match(/^connection.*/gim));
    await (await fetch(`${server.url}to?/`)).text();
    await (await fetch(`${server.url}own`, { headers: { connection: "keep-alive" } })).text();
    expect(published.log).toEqual([["Connection: close"], ["Connection: keep-alive"], ["Connection: close"]]);
  });

  test.each<[unknown, unknown, string]>([
    ["a b", "1", "UND_ERR_INVALID_ARG"],
    ["a", "1\r\nb: 2", "UND_ERR_INVALID_ARG"],
    ["a", {}, "UND_ERR_INVALID_ARG"],
    ["transfer-encoding", "chunked", "UND_ERR_INVALID_ARG"],
    ["content-length", "1", "UND_ERR_INVALID_ARG"],
    ["expect", "100-continue", "UND_ERR_NOT_SUPPORTED"],
  ])("addHeader(%p, %p) throws", async (name, value, code) => {
    using server = serve();
    using published = record("undici:request:", ["create"], (_, { request }) => {
      try {
        request.addHeader(name, value);
      } catch (error: any) {
        return error.code;
      }
    });
    await (await fetch(server.url, { method: "POST", body: "body" })).text();
    expect(published.log).toEqual([code]);
  });

  test.concurrent("an invalid header in request.headers is reported and not sent", async () => {
    expect(
      await run(`
        process.on("uncaughtException", error => console.log(error.code));
        dc.subscribe("undici:request:create", ({ request }) =>
          request.headers.push("a", "1\\r\\nsmuggled: 1", "content-length", "9", "valid", "1"));
        const server = Bun.serve({ port: 0, fetch: ({ headers }) => Response.json(["a", "smuggled", "content-length", "valid"].map(name => headers.get(name))) });
        fetch(server.url).then(response => response.text()).then(console.log).then(() => server.stop(true));
      `),
    ).toEqual(["UND_ERR_INVALID_ARG", "UND_ERR_INVALID_ARG", `[null,null,null,"1"]`]);
  });

  test("each redirect is a request of its own, and starts from the headers of the caller", async () => {
    using first = serve();
    using second = serve();
    using published = record(
      "undici:request:",
      ["create", "headers", "trailers"],
      (event, { request, response }) => `${event} ${request.method} ${request.origin} ${response?.statusCode}`,
    );
    using _ = listen("undici:request:create", ({ request }) =>
      request.addHeader(request.origin === first.url.origin ? "for-first" : "for-second", "1"),
    );
    const response = await fetch(`${first.url}to?${second.url}`, {
      method: "POST",
      body: "body",
      headers: { authorization: "secret", own: "own" },
    });
    const received: any = await response.json();
    expect(["for-first", "for-second", "authorization", "own"].map(name => received[name])).toEqual([
      undefined,
      "1",
      undefined,
      "own",
    ]);
    expect(published.log).toEqual([
      `create POST ${first.url.origin} undefined`,
      `headers POST ${first.url.origin} 302`,
      `trailers POST ${first.url.origin} undefined`,
      `create GET ${second.url.origin} undefined`,
      `headers GET ${second.url.origin} 200`,
      `trailers GET ${second.url.origin} undefined`,
    ]);
  });

  test("origin has no credentials", async () => {
    using server = serve();
    using published = record("undici:request:", ["create"], (_, { request }) => request.origin + request.path);
    await (await fetch(`http://user:password@${server.url.host}/`)).text();
    expect(published.log).toEqual([server.url.href]);
  });

  test.each([[{}], [{ "content-length": "2" }]])("a body that is a stream, with the headers %p", async headers => {
    using server = serve();
    using published = record("undici:request:", ["bodyChunkSent", "bodySent", "trailers"], (event, { chunk }) =>
      chunk ? Buffer.from(chunk).toString() : event,
    );
    async function* body() {
      yield "a";
      yield "b";
    }
    await (await fetch(server.url, { method: "POST", body: new Response(body() as any).body, headers })).text();
    expect(published.log.join(" ").replace("a b", "ab")).toBe("ab bodySent trailers");
  });

  test("a body that is complete by its Content-Length is sent, whether or not its stream has ended", async () => {
    using server = serve();
    using published = record("undici:request:", ["bodySent", "trailers"]);
    const body = new ReadableStream({ start: body => body.enqueue("a") });
    await (await fetch(server.url, { method: "POST", body, headers: { "content-length": "1" } })).text();
    expect(published.log).toEqual(["bodySent", "trailers"]);
  });

  test("the chunks that are received are not decompressed", async () => {
    const compressed = Bun.gzipSync("text");
    using server = serve({ fetch: () => new Response(compressed, { headers: { "content-encoding": "gzip" } }) });
    using published = record("undici:request:", ["bodyChunkReceived"], (_, { chunk }) => chunk);
    expect(await (await fetch(server.url)).text()).toBe("text");
    expect(Buffer.concat(published.log)).toEqual(Buffer.from(compressed));
    expect(published.log.every(Buffer.isBuffer)).toBe(true);
  });

  test.each<[string, () => Promise<[string, object?, Disposable?]>]>([
    ["is refused", async () => [`http://127.0.0.1:${await closedPort()}/`]],
    [
      "has a certificate that is not trusted",
      async () => {
        const server = serve({ tls: certificate });
        return [server.url.href, {}, server];
      },
    ],
    [
      "fails checkServerIdentity()",
      async () => {
        const server = serve({ tls: certificate });
        return [server.url.href, { tls: { ca: certificate.cert, checkServerIdentity: () => new Error("no") } }, server];
      },
    ],
  ])("the connection %s", async (_, setUp) => {
    const [url, options, server] = await setUp();
    using __ = server;
    using published = recordRequests((event, { error }) => [event, error]);
    const error = await fetch(url, options).catch(error => error);
    expect(published.log).toEqual([
      ["request:create", undefined],
      ["client:beforeConnect", undefined],
      ["client:connectError", error],
      ["request:error", error],
    ]);
    expect(published.log[3][1]).toBe(error);
  });

  test.each([
    ["request:create", "/"],
    ["client:sendHeaders", "/hang"],
    ["request:headers", "/hang"],
    ["request:bodyChunkReceived", "/hang"],
    ["request:create", "/to?/redirected"],
  ])("a subscriber of %s aborts the request for %s", async (event, path) => {
    using server = serve();
    const controller = new AbortController();
    const reason = new Error("reason");
    using _ = listen(`undici:${event}`, ({ request }) => {
      if (!request.path.startsWith("/to")) controller.abort(reason);
    });
    using published = recordRequests();
    const message = published.until("request:error");
    const outcome = await fetch(new URL(path, server.url), { signal: controller.signal })
      .then(response => response.text())
      .catch(error => error);
    expect(outcome).toBe(reason);
    expect(published.log.slice(-2)).toEqual([event, "request:error"]);
    expect((await message).error).toBe(reason);
  });

  test("an abort between two requests starts no second one", async () => {
    using server = serve();
    const controller = new AbortController();
    using _ = listen("undici:request:trailers", () => controller.abort());
    using published = record("undici:request:", ["create", "trailers", "error"]);
    await expect(fetch(`${server.url}to?/`, { signal: controller.signal })).rejects.toThrow("aborted");
    expect(published.log).toEqual(["create", "trailers"]);
  });

  test("the body of the response is cancelled", async () => {
    using server = serve();
    using published = record("undici:request:", ["trailers", "error"], (event, { error }) => error?.name ?? event);
    const failed = published.until("error");
    await (await fetch(`${server.url}hang`)).body!.cancel();
    await failed;
    expect(published.log).toEqual(["AbortError"]);
  });

  test("a body that is cancelled when nothing else is left to do", async () => {
    using server = serve({
      fetch: () => new Response(new ReadableStream({ pull: body => body.enqueue(new Uint8Array(65536)) })),
    });
    expect(
      await run(`
        dc.subscribe("undici:request:error", ({ error }) => console.log(error.name));
        fetch("${server.url}").then(({ body }) => process.once("beforeExit", () => body.cancel()));
      `),
    ).toEqual(["AbortError"]);
  });

  test.each(["response", "response.body"])("a %s that only the async context leads to is collected", async kept => {
    using server = serve();
    expect(
      await run(`
        const store = new (require("node:async_hooks").AsyncLocalStorage)();
        dc.subscribe("undici:request:error", ({ error }) => {
          console.log(error.name);
          process.exit(0);
        });
        for (let i = 0; i < 10; i++) {
          store.run([], async () => {
            const response = await fetch("${server.url}hang");
            store.getStore().push(${kept});
          });
        }
        setInterval(() => Bun.gc(true), 5);
      `),
    ).toEqual(["AbortError"]);
  });

  test.each<[string, (response: Response) => () => Promise<unknown>]>([
    ["the response", response => () => response.text()],
    [
      "a clone",
      response =>
        (
          clone => () =>
            clone.text()
        )(response.clone()),
    ],
    [
      "the body",
      response =>
        (
          body => () =>
            Array.fromAsync(body)
        )(response.body!),
    ],
    [
      "a promise",
      response =>
        (
          text => () =>
            text
        )(response.text()),
    ],
    [
      "a promise of the body",
      response =>
        (
          text => () =>
            text
        )(Bun.readableStreamToText(response.body!)),
    ],
  ])("the async context lasts while %s is left", async (_, keep) => {
    let end!: () => void;
    using server = serve({
      fetch: () => new Response(new ReadableStream({ start: body => (body.enqueue("a"), (end = () => body.close())) })),
    });
    const store = new AsyncLocalStorage();
    using published = record("undici:request:", ["trailers", "error"], event => `${event} ${store.getStore()}`);
    const read = await new Promise<Response>(resolve => store.run("a", () => fetch(server.url)).then(resolve)).then(
      keep,
    );
    await nextTurn();
    gc(true);
    end();
    await read();
    expect(published.log).toEqual(["trailers a"]);
  });

  test("a 205 announces a body that is still to come", async () => {
    await using server = await listening(
      net.createServer(socket =>
        socket.on("error", () => {}).once("data", () => socket.write("HTTP/1.1 205 OK\r\nContent-Length: 4\r\n\r\n")),
      ),
    );
    using published = record("undici:request:", ["headers", "trailers", "error"]);
    const over = Promise.race([published.until("trailers"), published.until("error")]);
    expect((await fetch(`http://127.0.0.1:${server.port}`)).body).toBeNull();
    await over;
    expect(published.log).toEqual(["headers", "trailers"]);
  });

  test("the body of the request fails", async () => {
    using server = serve();
    using published = record(
      "undici:request:",
      ["bodySent", "trailers", "error"],
      (event, { error }) => error ?? event,
    );
    const error = new Error("source");
    const body = new ReadableStream({ pull: body => body.error(error) });
    expect(await fetch(server.url, { method: "POST", body }).catch(error => error)).toBe(error);
    expect(published.log).toEqual([error]);
  });

  test("HTTP/2", async () => {
    await using server = await listening(
      http2.createSecureServer(certificate, (req, res) => {
        if (req.url === "/to") res.writeHead(307, { location: "/" });
        res.end(req.headers.added as string);
      }),
    );
    using _ = listen("undici:request:create", ({ request }) => request.addHeader("added", request.path));
    using published = recordRequests(
      (event, { connectParams, headers }) => connectParams?.version ?? headers?.split("\r\n")[2] ?? event,
    );
    const response = await fetch(`https://127.0.0.1:${server.port}/to`, {
      protocol: "http2",
      tls: { rejectUnauthorized: false },
      keepalive: false,
    } as any);
    expect(await response.text()).toBe("/");
    expect(published.log.slice(0, 8)).toEqual([
      "request:create",
      "client:beforeConnect",
      "h2",
      ":path: /to",
      "request:bodySent",
      "request:headers",
      "request:trailers",
      "request:create",
    ]);
    expect(published.log.slice(-5)).toEqual([
      ":path: /",
      "request:bodySent",
      "request:headers",
      "request:bodyChunkReceived",
      "request:trailers",
    ]);
  });

  test("what only a proxy is to read is left out", async () => {
    using proxy = serve();
    using published = record("undici:client:", ["sendHeaders"], (_, { headers }) => headers);
    const response = await fetch("http://example.invalid/path", { proxy: `http://user:password@${proxy.url.host}` });
    expect(await response.json()).toHaveProperty("proxy-authorization");
    expect(published.log).toEqual([expect.stringMatching(/^GET \/path HTTP\/1.1\r\n/)]);
    expect(published.log[0]).not.toMatch(/proxy-/i);
  });

  test("URLs that take no request publish nothing", async () => {
    using published = recordRequests();
    await fetch("data:,text");
    await fetch(Bun.pathToFileURL(import.meta.path));
    await fetch("http://127.0.0.1:1/", { signal: AbortSignal.abort() }).catch(() => {});
    expect(published.log).toEqual([]);
  });

  test.concurrent.each([
    ["process.exit()", `dc.subscribe("undici:request:trailers", () => process.exit(0)); load(server.url);`],
    [
      "worker.terminate()",
      `
        const worker = new Worker("data:text/javascript," + encodeURIComponent(\`
          require("node:diagnostics_channel").subscribe("undici:request:trailers", () => postMessage(1));
          (\${load})("\${server.url}");
        \`));
        worker.onmessage = () => worker.terminate();
        worker.addEventListener("close", () => server.stop(true));
      `,
    ],
  ])("%s while requests wait to follow a redirect", async (_, script) => {
    expect(
      await run(`
        process.on("exit", () => console.log("exit"));
        const server = Bun.serve({ port: 0, fetch: () => Response.redirect("/") });
        const load = url => { for (let i = 0; i < 20; i++) fetch(url).catch(() => {}); };
        ${script}
      `),
    ).toEqual(["exit"]);
  });
});

describe("undici:* of WebSocket", () => {
  const serve = (websocket: Partial<Bun.WebSocketHandler<undefined>> = {}, tls?: Bun.TLSOptions) =>
    Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch(request, server) {
        const headers = { added: request.headers.get("added") ?? "", date: "now" };
        if (!request.url.endsWith("/404") && server.upgrade(request, { headers })) return;
        return new Response(null, { status: 404 });
      },
      websocket: { message() {}, perMessageDeflate: false, ...websocket },
    });
  const recordWebSocket = (describe?: (event: string, message: any) => unknown) =>
    record("undici:websocket:", ["open", "ping", "pong", "close", "socket_error"], describe);
  const closed = (ws: WebSocket) => new Promise(resolve => ws.addEventListener("close", resolve));

  test("messages", async () => {
    using server = serve({
      open(ws) {
        ws.ping("ping");
        ws.pong("pong");
        ws.close(3000, "reason");
      },
    });
    using published = recordWebSocket((event, { websocket, ...rest }) => ({ event, ws: websocket === ws, ...rest }));
    const ws = new WebSocket(server.url, "protocol");
    await closed(ws);
    expect(published.log).toEqual([
      {
        event: "open",
        ws: true,
        address: expect.objectContaining({ address: "127.0.0.1", family: "IPv4" }),
        protocol: "protocol",
        extensions: "",
        handshakeResponse: {
          status: 101,
          statusText: "Switching Protocols",
          headers: expect.objectContaining({ "upgrade": "websocket", "sec-websocket-protocol": "protocol" }),
        },
      },
      { event: "ping", ws: true, payload: Buffer.from("ping") },
      { event: "pong", ws: true, payload: Buffer.from("pong") },
      { event: "close", ws: true, code: 3000, reason: "reason" },
    ]);
  });

  test("the handshake is a request", async () => {
    using server = serve({ open: ws => ws.close() });
    using requests = recordRequests((event, { request }) => `${event} ${request?.origin} ${request?.upgrade}`);
    using _ = listen("undici:request:create", ({ request }) => request.addHeader("added", "1"));
    using published = recordWebSocket((_, { handshakeResponse }) => handshakeResponse?.headers.added);
    await closed(new WebSocket(server.url));
    expect(published.log).toEqual(["1", undefined]);
    expect(requests.log).toEqual([
      `request:create ${server.url.origin} websocket`,
      "client:beforeConnect undefined undefined",
      "client:connected undefined undefined",
      `client:sendHeaders ${server.url.origin} websocket`,
      `request:bodySent ${server.url.origin} websocket`,
      `request:headers ${server.url.origin} websocket`,
      `request:trailers ${server.url.origin} websocket`,
    ]);
  });

  test("the server refuses the handshake", async () => {
    using server = serve();
    using requests = record("undici:request:", ["create", "headers", "trailers", "error"]);
    using published = recordWebSocket();
    await closed(new WebSocket(`${server.url}404`));
    expect(requests.log).toEqual(["create", "headers", "trailers"]);
    expect(published.log).toEqual(["close"]);
  });

  test("the response comes with the end of the TLS handshake", async () => {
    await using server = await listening(
      tls.createServer({ ...certificate, maxVersion: "TLSv1.2" }, socket =>
        socket.on("error", () => {}).end("HTTP/1.1 503 Busy\r\nContent-Length: 0\r\n\r\n"),
      ),
    );
    using requests = recordRequests();
    await closed(new WebSocket(`wss://127.0.0.1:${server.port}`, { tls: { rejectUnauthorized: false } } as any));
    expect(requests.log).toEqual([
      "request:create",
      "client:beforeConnect",
      "client:connected",
      "client:sendHeaders",
      "request:bodySent",
      "request:headers",
      "request:trailers",
    ]);
  });

  test.skipIf(!nodeExe())("the server renegotiates before it answers", async () => {
    await using server = await startRenegotiatingWssServer("before the 101");
    using requests = recordRequests();
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}`, { tls: { ca: certificate.cert } } as any);
    ws.onopen = () => ws.terminate();
    await closed(ws);
    expect(requests.log).toEqual([
      "request:create",
      "client:beforeConnect",
      "client:connected",
      "client:sendHeaders",
      "request:bodySent",
      "request:headers",
      "request:trailers",
    ]);
  });

  describe("socket_error", () => {
    ignoreAmbientNoProxy();

    const recordErrors = () =>
      record("undici:websocket:", ["socket_error", "close"], (event, { message, code, syscall, errno }) =>
        event === "close" ? code : { message, code, syscall, errno: errno && getSystemErrorName(errno) },
      );
    const reset = (syscall: string) => ({
      message: `${syscall} ECONNRESET`,
      code: "ECONNRESET",
      syscall,
      errno: "ECONNRESET",
    });
    const badRecord = {
      message: expect.stringContaining("DECRYPTION_FAILED_OR_BAD_RECORD_MAC"),
      code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
    };

    describe.each([
      ["ws", "no"],
      ["wss", "no"],
      ["ws", "http"],
      ["wss", "http"],
      ["ws", "https"],
      ["wss", "https"],
    ])("%s:// with %s proxy", (scheme, proxyScheme) => {
      /** `harm` gets the other end of the TCP connection of an open WebSocket. */
      async function publishedAfter(harm: (peer: net.Socket, ws: WebSocket) => void) {
        using origin = serve({}, scheme === "wss" ? certificate : undefined);
        await using proxy = await listening(createConnectProxy({ tls: proxyScheme === "https" }));
        let peer: net.Socket;
        await using hop = await listening(
          net.createServer(socket => {
            const next = net.connect(proxyScheme === "no" ? origin.port! : proxy.port, "127.0.0.1");
            peer = socket.on("error", () => {}).on("close", () => next.destroy());
            next.on("error", () => {}).on("close", () => socket.destroy());
            socket.pipe(next).pipe(socket);
          }),
        );
        using published = recordErrors();
        const ws = new WebSocket(`${scheme}://127.0.0.1:${proxyScheme === "no" ? hop.port : origin.port}`, {
          proxy: proxyScheme === "no" ? undefined : `${proxyScheme}://127.0.0.1:${hop.port}`,
          tls: { ca: certificate.cert },
        } as any);
        await once(ws, "open");
        harm(peer!, ws);
        await closed(ws);
        return published.log;
      }

      test("the peer resets the connection", async () => {
        expect(await publishedAfter(peer => peer.resetAndDestroy())).toEqual([reset("read"), 1006]);
      });

      test("the peer ends the connection", async () => {
        expect(await publishedAfter(peer => peer.end())).toEqual([1006]);
      });

      test("terminate()", async () => {
        expect(await publishedAfter((_, ws) => ws.terminate())).toEqual([1006]);
      });

      test.skipIf(scheme === "ws" && proxyScheme !== "https")("a TLS record is corrupt", async () => {
        const record = Buffer.from([TLS_RECORD.applicationData, 3, 3, 0, 40, ...Buffer.alloc(40, 7)]);
        expect(await publishedAfter(peer => peer.write(record))).toEqual([badRecord, 1006]);
      });
    });

    describe.skipIf(!socketFaultInjection.available() || isWindows).each(["no", "https"])(
      "wss:// with %s proxy, the kernel refuses the second write",
      proxyScheme => {
        test.each([
          ["a message, after the Pong", encodeFrame(OP.ping), ["write ECONNRESET", "1006 false"]],
          ["the close_notify, after the Close frame", encodeFrame(OP.close, closePayload(1000)), ["1000 true"]],
        ])("%s", async (_, afterUpgrade, expected) => {
          // Neither answers a FIN, as a peer that is gone.
          await using proxy = await listening(createConnectProxy({ tls: true, tlsOptions: { allowHalfOpen: true } }));
          await using origin = await createPeer({ secure: true, afterUpgrade });
          expect(
            await run(`
              const { socketFaultInjection } = require("bun:internal-for-testing");
              process.env.NO_PROXY = process.env.no_proxy = "";
              dc.subscribe("undici:websocket:socket_error", error => console.log(error.message));
              dc.subscribe("undici:websocket:ping", () => ws.send("message"));
              const ws = new WebSocket("${origin.url}", {
                proxy: ${proxyScheme === "no" ? undefined : `"https://127.0.0.1:${proxy.port}"`},
                tls: { rejectUnauthorized: false },
              });
              ws.onopen = () => socketFaultInjection.set({ syscall: "send", action: "errno", errno: "ECONNRESET", after: 1 });
              ws.onclose = ({ code, wasClean }) => console.log(code, wasClean);
            `),
          ).toEqual(expected);
        });
      },
    );

    test.skipIf(!nodeExe())("the peer ends the connection during a renegotiation", async () => {
      await using server = await startRenegotiatingWssServer("and ends");
      using published = recordErrors();
      const ws = new WebSocket(`wss://127.0.0.1:${server.port}`, { tls: { ca: certificate.cert } } as any);
      ws.onopen = () => ws.send("message");
      await closed(ws);
      expect(published.log).toEqual([1006]);
    });

    test.each(["direct", "http", "https"] as const)("a corrupt TLS record comes with the 101: %s", async route => {
      await using origin = await startOriginWithCorruptRecord(route, []);
      using published = recordErrors();
      await closed(new WebSocket(origin.url, { proxy: origin.proxy, tls: { ca: certificate.cert } } as any));
      expect(published.log).toEqual([expect.objectContaining({ code: expect.stringMatching(/^ERR_SSL_/) }), 1006]);
    });
  });

  test("the connection is refused", async () => {
    using requests = recordRequests();
    await closed(new WebSocket(`ws://127.0.0.1:${await closedPort()}`));
    expect(requests.log).toEqual(["request:create", "client:beforeConnect", "client:connectError", "request:error"]);
  });

  test.each(["open", "ping", "pong"])("a subscriber of %s can close the WebSocket", async event => {
    using server = serve({
      open(ws) {
        ws.ping();
        ws.pong();
      },
    });
    using _ = listen(`undici:websocket:${event}`, ({ websocket }) => websocket.terminate());
    using published = recordWebSocket();
    await closed(new WebSocket(server.url));
    expect(published.log.filter(name => name === event || name === "close").sort()).toEqual(["close", event]);
  });
});

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

/** The lines that `script` prints. It has the module as `dc`. */
async function run(script: string, options: { cwd?: string; env?: object; stderr?: string } = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const dc = require("node:diagnostics_channel");\n${script}`],
    env: { ...bunEnv, ...options.env },
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: expect.any(String),
    stderr: options.stderr ?? "",
    exitCode: 0,
  });
  return stdout.trimEnd().split("\n");
}

const mocks = new Map();

function mustCall<T>(fn: (...args: any[]) => T, expected?: number) {
  const instance = mock(fn);
  mocks.set(instance, expected ?? 1);
  return instance;
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
