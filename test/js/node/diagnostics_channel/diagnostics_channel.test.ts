import { gc } from "bun";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel, Channel, hasSubscribers, subscribe, unsubscribe } from "node:diagnostics_channel";
import http from "node:http";
import net from "node:net";

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

describe("http server channels (#29586)", () => {
  test("publishes http.server.request.start, response.created, response.finish", async () => {
    const channelNames = [
      "http.server.response.created",
      "http.server.request.start",
      "http.server.response.finish",
    ];
    const events: { channel: string; payload: Record<string, unknown> }[] = [];
    const subs: [ReturnType<typeof channel>, (msg: unknown) => void][] = [];

    // Hold direct channel refs so subscriptions can't be silently lost to GC,
    // and also so we can cleanly unsubscribe in the finally.
    for (const name of channelNames) {
      const ch = channel(name);
      const sub = (msg: unknown) => {
        events.push({ channel: ch.name as string, payload: msg as Record<string, unknown> });
      };
      ch.subscribe(sub);
      subs.push([ch, sub]);
    }

    try {
      await using server = http.createServer((_req, res) => res.end("ok"));
      await new Promise<void>(resolve => server.listen(0, resolve));
      const { port } = server.address();
      await (await fetch(`http://127.0.0.1:${port}/`)).text();
      // Wait for the "finish" nextTick and any tail events to drain.
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));

      expect(events.map(e => e.channel)).toEqual([
        "http.server.response.created",
        "http.server.request.start",
        "http.server.response.finish",
      ]);

      // response.created: { request, response } only
      const created = events[0].payload;
      expect(Object.keys(created).sort()).toEqual(["request", "response"]);
      expect(created.request).toBeInstanceOf(http.IncomingMessage);
      expect(created.response).toBeInstanceOf(http.ServerResponse);

      // request.start: { request, response, socket, server }
      const reqStart = events[1].payload;
      expect(Object.keys(reqStart).sort()).toEqual(["request", "response", "server", "socket"]);
      expect(reqStart.request).toBe(created.request);
      expect(reqStart.response).toBe(created.response);
      expect(reqStart.server).toBe(server);
      expect(reqStart.socket).toBe((reqStart.request as any).socket);

      // response.finish: { request, response, socket, server }
      const resFinish = events[2].payload;
      expect(Object.keys(resFinish).sort()).toEqual(["request", "response", "server", "socket"]);
      expect(resFinish.request).toBe(created.request);
      expect(resFinish.response).toBe(created.response);
      expect(resFinish.server).toBe(server);
      expect(resFinish.socket).toBe(reqStart.socket);
    } finally {
      for (const [ch, sub] of subs) ch.unsubscribe(sub);
    }
  });

  // Node's contract: response.created fires before any user handler can mutate
  // the response. Mirror of Node's test-diagnostic-channel-http-response-created.js.
  test("response.created fires before the request handler runs", async () => {
    const created = channel("http.server.response.created");
    const finish = channel("http.server.response.finish");
    const snapshots: { event: string; baz: unknown }[] = [];

    const onCreated = (msg: any) => {
      snapshots.push({ event: "created", baz: msg.response.getHeader("baz") });
    };
    const onFinish = (msg: any) => {
      snapshots.push({ event: "finish", baz: msg.response.getHeader("baz") });
    };
    created.subscribe(onCreated);
    finish.subscribe(onFinish);

    try {
      await using server = http.createServer((_req, res) => {
        res.setHeader("baz", "bar");
        res.end("done");
      });
      await new Promise<void>(resolve => server.listen(0, resolve));
      const { port } = server.address();
      await (await fetch(`http://127.0.0.1:${port}/`)).text();
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));

      expect(snapshots).toEqual([
        { event: "created", baz: undefined }, // fired before handler set the header
        { event: "finish", baz: "bar" }, // fired after the handler completed
      ]);
    } finally {
      created.unsubscribe(onCreated);
      finish.unsubscribe(onFinish);
    }
  });

  // Subscribing after the request arrived but before the response finished
  // must still deliver response.finish — the 'finish' listener is attached
  // unconditionally, matching Node's resOnFinish, so this works no matter
  // when subscription happens.
  test("response.finish delivers to subscribers added after the request arrived", async () => {
    const finish = channel("http.server.response.finish");
    const received: any[] = [];
    const onFinish = (msg: any) => {
      received.push(msg);
    };

    let subscribed = false;
    const { promise: handlerEntered, resolve: onHandlerEntered } = Promise.withResolvers<void>();
    const { promise: mayFinish, resolve: continueFinish } = Promise.withResolvers<void>();

    try {
      await using server = http.createServer(async (_req, res) => {
        onHandlerEntered();
        // Hold the response open until we've subscribed.
        await mayFinish;
        res.end("done");
      });
      await new Promise<void>(resolve => server.listen(0, resolve));
      const { port } = server.address();
      const fetched = fetch(`http://127.0.0.1:${port}/`);
      await handlerEntered;

      // Subscribe *after* request arrival, *before* response finish.
      finish.subscribe(onFinish);
      subscribed = true;
      continueFinish();

      await (await fetched).text();
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));

      expect(received).toHaveLength(1);
      expect(Object.keys(received[0]).sort()).toEqual(["request", "response", "server", "socket"]);
    } finally {
      if (subscribed) finish.unsubscribe(onFinish);
    }
  });

  // Node publishes response.created from inside the ServerResponse
  // constructor (lib/_http_server.js), so `new http.ServerResponse(req)`
  // — the pattern used by light-my-request, fastify.inject(), etc. — fires
  // it too. Mirror that.
  test("response.created fires for direct new http.ServerResponse()", () => {
    const created = channel("http.server.response.created");
    const received: any[] = [];
    const onCreated = (msg: any) => {
      received.push(msg);
    };
    created.subscribe(onCreated);
    try {
      const req = new http.IncomingMessage(new net.Socket());
      const res = new http.ServerResponse(req);
      expect(received).toHaveLength(1);
      expect(Object.keys(received[0]).sort()).toEqual(["request", "response"]);
      expect(received[0].request).toBe(req);
      expect(received[0].response).toBe(res);
    } finally {
      created.unsubscribe(onCreated);
    }
  });

  // Node publishes request.start once per non-upgrade request in
  // parserOnIncoming — before the branching — so it fires on the
  // checkContinue, checkExpectation, 417 auto-response and dropRequest/503
  // paths too, not only the plain server.emit('request') path.
  test("request.start fires on checkContinue path", async () => {
    const requestStart = channel("http.server.request.start");
    const received: any[] = [];
    const onStart = (msg: any) => {
      received.push(msg);
    };
    requestStart.subscribe(onStart);
    try {
      await using server = http.createServer((_req, res) => res.end("fallback"));
      server.on("checkContinue", (_req, res) => {
        res.writeContinue();
        res.end("cc");
      });
      await new Promise<void>(resolve => server.listen(0, resolve));
      const { port } = server.address();
      await new Promise<void>((resolve, reject) => {
        const req = http.request({ port, method: "POST", headers: { expect: "100-continue" } });
        req.on("response", res => {
          res.resume();
          res.on("end", resolve);
        });
        req.on("error", reject);
        req.end();
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(received).toHaveLength(1);
      expect(Object.keys(received[0]).sort()).toEqual(["request", "response", "server", "socket"]);
      expect(received[0].server).toBe(server);
    } finally {
      requestStart.unsubscribe(onStart);
    }
  });

  test("request.start fires on 417 Expectation Failed path", async () => {
    const requestStart = channel("http.server.request.start");
    const received: any[] = [];
    const onStart = (msg: any) => {
      received.push(msg);
    };
    requestStart.subscribe(onStart);
    let client: any;
    try {
      await using server = http.createServer((_req, res) => res.end("x"));
      await new Promise<void>(resolve => server.listen(0, resolve));
      const { port } = server.address();
      // Raw socket — we want `Expect: weird` to reach the 417 branch.
      await new Promise<void>((resolve, reject) => {
        client = net.connect(port, () => {
          client.write("GET / HTTP/1.1\r\nHost: x\r\nExpect: weird\r\n\r\n");
        });
        let buf = "";
        client.on("data", d => {
          buf += d;
          if (buf.includes("\r\n\r\n")) {
            // Full response received; don't wait for close (server keeps
            // the connection alive).
            buf.startsWith("HTTP/1.1 417") ? resolve() : reject(new Error(buf));
          }
        });
        client.on("error", reject);
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(received).toHaveLength(1);
      expect(Object.keys(received[0]).sort()).toEqual(["request", "response", "server", "socket"]);
      expect(received[0].server).toBe(server);
    } finally {
      client?.destroy?.();
      requestStart.unsubscribe(onStart);
    }
  });

  test("request.start does NOT fire on upgrade path", async () => {
    const requestStart = channel("http.server.request.start");
    const receivedStart: any[] = [];
    const onStart = (msg: any) => {
      receivedStart.push(msg);
    };
    requestStart.subscribe(onStart);
    try {
      await using server = http.createServer();
      server.on("upgrade", (_req, socket) => {
        // Graceful FIN rather than RST — avoids a flaky ECONNRESET on the
        // client side that could race the assertion.
        socket.end();
      });
      await new Promise<void>(resolve => server.listen(0, resolve));
      const { port } = server.address();
      await new Promise<void>((resolve, reject) => {
        const client = net.connect(port, () => {
          client.write(
            "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
          );
        });
        client.on("close", () => resolve());
        // Swallow ECONNRESET etc. — we only care that the connection
        // terminates, not how.
        client.on("error", () => {});
      });
      await new Promise<void>(resolve => setImmediate(resolve));
      // Node gates request.start on `!is_upgrade` (it returns early in
      // parserOnIncoming before constructing ServerResponse), and so do we.
      // Note: Bun currently *does* construct ServerResponse for upgrades
      // before checking is_upgrade, so response.created still fires — that
      // is a pre-existing divergence out of scope for this PR.
      expect(receivedStart).toHaveLength(0);
    } finally {
      requestStart.unsubscribe(onStart);
    }
  });

  test("server works normally when nobody subscribed", async () => {
    // No subscribers means no publish payload is allocated — just prove the
    // normal request/response path still works with the channel plumbing in.
    await using server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address();
    const body = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(body).toBe("ok");
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
