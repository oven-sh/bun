import { gc } from "bun";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel, Channel, hasSubscribers, subscribe, tracingChannel, unsubscribe } from "node:diagnostics_channel";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { connect as netConnect, createServer as netCreateServer } from "node:net";

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
});

describe("TracingChannel", () => {
  // Port tests from:
  // https://github.com/search?q=repo%3Anodejs%2Fnode+test-diagnostics-channel+AND+%2Ftracing%2F&type=code
  test.todo("TODO");

  test("tracingChannel(null) throws ERR_INVALID_ARG_TYPE like Node", () => {
    for (const bad of [null, 0, Symbol("x")]) {
      expect(() => tracingChannel(bad as any)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    }
  });
});

describe("node:http server channels", () => {
  test("http.server.response.created publishes the request and response", async () => {
    const events: Array<{ request: unknown; response: unknown }> = [];
    const onCreated = (message: any) => events.push(message);
    subscribe("http.server.response.created", onCreated);

    const server = createServer((req, res) => res.end("ok"));
    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
      await promise;

      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe("ok");
    } finally {
      unsubscribe("http.server.response.created", onCreated);
      server.close();
    }

    expect(events).toHaveLength(1);
    expect(events[0].request).toBeInstanceOf(IncomingMessage);
    expect(events[0].response).toBeInstanceOf(ServerResponse);
    expect((events[0].response as ServerResponse).req).toBe(events[0].request);
  });

  test("http.server.* channels do not publish for accepted upgrades", async () => {
    const counts = { created: 0, start: 0, finish: 0 };
    let upgradeSeen = false;
    const onCreated = () => counts.created++;
    const onStart = () => counts.start++;
    const onFinish = () => counts.finish++;
    subscribe("http.server.response.created", onCreated);
    subscribe("http.server.request.start", onStart);
    subscribe("http.server.response.finish", onFinish);

    const server = createServer((req, res) => res.end("ok"));
    server.on("upgrade", (req, socket) => {
      upgradeSeen = true;
      socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
    });
    try {
      const { promise: listening, resolve: onListening, reject } = Promise.withResolvers<void>();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", onListening);
      await listening;
      const { port } = server.address() as AddressInfo;

      const { promise: upgraded, resolve: onUpgraded, reject: onSockErr } = Promise.withResolvers<void>();
      const sock = netConnect(port, "127.0.0.1", () => {
        sock.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
      });
      sock.on("data", () => {});
      sock.on("error", onSockErr);
      sock.on("close", onUpgraded);
      await upgraded;
      expect(upgradeSeen).toBe(true);
      expect(counts).toEqual({ created: 0, start: 0, finish: 0 });

      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe("ok");
    } finally {
      unsubscribe("http.server.response.created", onCreated);
      unsubscribe("http.server.request.start", onStart);
      unsubscribe("http.server.response.finish", onFinish);
      server.close();
    }

    expect(counts).toEqual({ created: 1, start: 1, finish: 1 });
  });

  test("http.server.* channels publish on the emit('connection') fallback path", async () => {
    // server.emit('connection', foreignSocket) routes through the llhttp-based
    // fallback (internal/http1_server_fallback), which in Node converges on the
    // same parserOnIncoming publishes as the native dispatch path.
    const events: Array<{ name: string; message: any }> = [];
    const onCreated = (message: any) => events.push({ name: "created", message });
    const onStart = (message: any) => events.push({ name: "start", message });
    const onFinish = (message: any) => events.push({ name: "finish", message });
    subscribe("http.server.response.created", onCreated);
    subscribe("http.server.request.start", onStart);
    subscribe("http.server.response.finish", onFinish);

    const httpServer = createServer((req, res) => res.end("ok"));
    const tcp = netCreateServer(socket => httpServer.emit("connection", socket));
    try {
      const { promise: listening, resolve: onListening, reject } = Promise.withResolvers<void>();
      tcp.on("error", reject);
      tcp.listen(0, "127.0.0.1", onListening);
      await listening;
      const { port } = tcp.address() as AddressInfo;

      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(await response.text()).toBe("ok");
    } finally {
      unsubscribe("http.server.response.created", onCreated);
      unsubscribe("http.server.request.start", onStart);
      unsubscribe("http.server.response.finish", onFinish);
      tcp.close();
      httpServer.close();
    }

    expect(events.map(e => e.name)).toEqual(["created", "start", "finish"]);
    for (const { message } of events) {
      expect(message.request).toBeInstanceOf(IncomingMessage);
      expect(message.response).toBeInstanceOf(ServerResponse);
    }
    expect(events[1].message.server).toBe(httpServer);
    expect(events[2].message.server).toBe(httpServer);
  });

  test("http.Server.listen() publishes on net.server.listen", async () => {
    const events: string[] = [];
    let startMessage: any, endMessage: any;
    const onStart = (m: any) => {
      events.push("asyncStart");
      startMessage = m;
    };
    const onEnd = (m: any) => {
      events.push("asyncEnd");
      endMessage = m;
    };
    subscribe("tracing:net.server.listen:asyncStart", onStart);
    subscribe("tracing:net.server.listen:asyncEnd", onEnd);

    const server = createServer((req, res) => res.end("ok"));
    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", resolve);
      await promise;
    } finally {
      unsubscribe("tracing:net.server.listen:asyncStart", onStart);
      unsubscribe("tracing:net.server.listen:asyncEnd", onEnd);
      server.close();
    }

    expect(events).toEqual(["asyncStart", "asyncEnd"]);
    expect(startMessage.server).toBe(server);
    expect(startMessage.options).toEqual({ port: 0, host: "127.0.0.1" });
    expect(endMessage.server).toBe(server);
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
