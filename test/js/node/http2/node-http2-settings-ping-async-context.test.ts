/**
 * Http2Session.settings(settings, callback) and Http2Session.ping(callback) send a frame, and the
 * peer acknowledges it. Many callers can share one session. What the acknowledgement delivers (the
 * callback, and for settings() the 'localSettings' event) runs in the async context of the caller
 * that sent the frame, not in the context that the session was made in.
 *
 * node keeps one async resource per frame, made when the frame is submitted:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L881-L907
 * While a client session connects, node submits a SETTINGS frame from a 'connect' listener:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1569-L1574
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-settings-ping-async-context.test.ts
 *   node --test test/js/node/http2/node-http2-settings-ping-async-context.test.ts
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { once } from "node:events";
import http2 from "node:http2";
import net, { type AddressInfo } from "node:net";
import { Duplex, duplexPair } from "node:stream";
import { before, describe, test } from "node:test";
import { promisify } from "node:util";

const als = new AsyncLocalStorage<string>();
const store = () => als.getStore() ?? "no store";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
// Runs a function in the async context that this module is loaded in: no store of any
// AsyncLocalStorage. A test function runs in a context of the test runner.
const outsideAnyStore = AsyncLocalStorage.snapshot();

// The server listens in the "listener" store, and its sessions are made in it.
async function listen(options: http2.ServerOptions = {}) {
  const server = http2.createServer(options);
  await once(
    als.run("listener", () => server.listen(0, "127.0.0.1")),
    "listening",
  );
  return server;
}
const portOf = (server: net.Server) => (server.address() as AddressInfo).port;
// The client session is made in the "session" store.
function connect(server: net.Server, options?: http2.ClientSessionOptions) {
  return als.run("session", () => http2.connect(`http://127.0.0.1:${portOf(server)}`, options));
}
// A client session and the server session of the same connection. The SETTINGS frames that the two
// sessions send at first are acknowledged.
// maxOutstandingSettings is not in @types/node.
type SessionOptions = http2.ServerOptions & http2.ClientSessionOptions & { maxOutstandingSettings?: number };
async function pair(options?: SessionOptions) {
  const server = await listen(options);
  const serverSession = once(server, "session") as Promise<[http2.ServerHttp2Session]>;
  const client = connect(server, options);
  const [[session]] = await Promise.all([serverSession, once(client, "localSettings")]);
  if (session.pendingSettingsAck) await once(session, "localSettings");
  return {
    client,
    session,
    close() {
      client.destroy();
      server.close();
    },
  };
}

// Resolves with the store that the settings() callback ran in.
function settingsStore(session: http2.Http2Session, settings: http2.Settings = {}) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  session.settings(settings, err => (err ? reject(err) : resolve(store())));
  return promise;
}
// Resolves with the store that the ping() callback ran in.
function pingStore(session: http2.Http2Session) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  session.ping(err => (err ? reject(err) : resolve(store())));
  return promise;
}

// Three callers in one tick: alice with a callback, bob without one, and a caller that has no store.
// Returns what each acknowledgement delivered, in order, with the store it ran in.
async function settingsFromThreeCallers(session: http2.Http2Session) {
  const delivered: string[] = [];
  session.on("localSettings", () => delivered.push(`'localSettings' in ${store()}`));
  const callback = (resolve: () => void) => () => {
    delivered.push(`callback in ${store()}`);
    resolve();
  };
  const { promise: alice, resolve: aliceDone } = Promise.withResolvers<void>();
  const { promise: nobody, resolve: nobodyDone } = Promise.withResolvers<void>();
  als.run("alice", () => session.settings({}, callback(aliceDone)));
  als.run("bob", () => session.settings({}));
  session.settings({}, callback(nobodyDone));
  await Promise.all([alice, nobody]);
  return delivered;
}
const fromThreeCallers = [
  "callback in alice",
  "'localSettings' in alice",
  "'localSettings' in bob",
  "callback in no store",
  "'localSettings' in no store",
];

// Two ends of one connection. Nothing is delivered until pump() is called, and then it is delivered
// inside that call: what an acknowledgement runs sees the async context of the pump() caller,
// unless it has one of its own.
function manualPair() {
  const queue: [Duplex, Buffer][] = [];
  const end = (peer: () => Duplex) =>
    new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        queue.push([peer(), chunk]);
        callback();
      },
    });
  const a: Duplex = end(() => b);
  const b: Duplex = end(() => a);
  return {
    a,
    b,
    pump() {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) next[0].push(next[1]);
    },
  };
}
// Sessions over manualPair(), both made outside any store. Their first SETTINGS frames are acknowledged.
async function manualSessions() {
  const { a, b, pump } = manualPair();
  const [client, session] = outsideAnyStore(() => [
    http2.connect("http://localhost", { createConnection: () => a }),
    http2.performServerHandshake(b),
  ]);
  const pumpUntil = async (done: () => boolean) => {
    while (!done()) {
      pump();
      await tick();
    }
  };
  let acknowledged = 0;
  client.once("localSettings", () => acknowledged++);
  session.once("localSettings", () => acknowledged++);
  await pumpUntil(() => acknowledged === 2);
  return {
    client,
    session,
    pump,
    pumpUntil,
    close() {
      client.destroy();
      session.destroy();
    },
  };
}

describe("Http2Session.settings()", () => {
  test("delivers the acknowledgement in the store of each caller on a client session", async () => {
    const { client, close } = await pair();
    try {
      assert.deepStrictEqual(await settingsFromThreeCallers(client), fromThreeCallers);
    } finally {
      close();
    }
  });

  test("delivers the acknowledgement in the store of each caller on a server session", async () => {
    const { session, close } = await pair();
    try {
      assert.deepStrictEqual(await settingsFromThreeCallers(session), fromThreeCallers);
    } finally {
      close();
    }
  });

  test("runs a callback in the store of its caller when it is called from another settings() callback", async () => {
    const { client, close } = await pair();
    try {
      const { promise, resolve } = Promise.withResolvers<string[]>();
      als.run("outer", () =>
        client.settings({}, () => {
          const outer = store();
          als.run("inner", () => client.settings({}, () => resolve([outer, store()])));
        }),
      );
      assert.deepStrictEqual(await promise, ["outer", "inner"]);
    } finally {
      close();
    }
  });

  test("calls the callback with (null, settings, duration) and no `this`", async () => {
    const { client, close } = await pair();
    try {
      const { promise, resolve } = Promise.withResolvers<unknown[]>();
      client.settings({ initialWindowSize: 123456 }, function (this: unknown, ...args: unknown[]) {
        resolve([this, ...args]);
      });
      const [self, err, settings, duration] = await promise;
      assert.strictEqual(self, undefined);
      assert.strictEqual(err, null);
      assert.strictEqual(settings, client.localSettings);
      assert.strictEqual((settings as http2.Settings).initialWindowSize, 123456);
      assert.strictEqual(typeof duration, "number");
    } finally {
      close();
    }
  });

  test("runs the callback with no store when its caller has none and the acknowledgement arrives inside a store", async () => {
    const { client, session, pump, pumpUntil, close } = await manualSessions();
    try {
      const stores: string[] = [];
      outsideAnyStore(() => {
        client.settings({}, () => stores.push(store()));
        session.settings({}, () => stores.push(store()));
      });
      await als.run("transport", () => pumpUntil(() => stores.length === 2));
      assert.deepStrictEqual(stores, ["no store", "no store"]);
    } finally {
      pump();
      close();
    }
  });

  test("keeps a store that the callback enters to itself", async () => {
    const { client, pump, close } = await manualSessions();
    try {
      const stores: string[] = [];
      client.on("localSettings", () => stores.push(`'localSettings' in ${store()}`));
      outsideAnyStore(() =>
        client.settings({}, () => {
          stores.push(`callback in ${store()}`);
          als.enterWith("entered");
        }),
      );
      // The acknowledgement is delivered inside a pump() call of this loop.
      while (stores.length < 2) {
        pump();
        if (store() !== "no store") stores.push(`the pump() caller in ${store()}`);
        await tick();
      }
      // The callback and the event are one delivery: the event sees what the callback entered.
      assert.deepStrictEqual(stores, ["callback in no store", "'localSettings' in entered"]);
    } finally {
      close();
    }
  });

  describe("before the session connects", () => {
    test("runs the callback in the store of the 'connect' event", async () => {
      const server = await listen();
      const client = connect(server);
      try {
        assert.strictEqual(client.connecting, true);
        const delivered: string[] = [];
        const { promise: acknowledged, resolve } = Promise.withResolvers<void>();
        client.once("connect", () => delivered.push(`'connect' in ${store()}`));
        als.run("early", () => client.settings({}, () => delivered.push(`callback in ${store()}`)));
        // The first 'localSettings' is of the SETTINGS frame that the session sends by itself.
        client.once("localSettings", () => {
          client.once("localSettings", () => {
            delivered.push(`'localSettings' in ${store()}`);
            resolve();
          });
        });
        await acknowledged;
        assert.deepStrictEqual(delivered, [
          "'connect' in session",
          "callback in session",
          "'localSettings' in session",
        ]);
      } finally {
        client.destroy();
        server.close();
      }
    });

    test("runs the callback in the store that a socket of createConnection() connects in", async () => {
      const server = await listen();
      const socket = als.run("socket", () => net.connect(portOf(server), "127.0.0.1"));
      const client = connect(server, { createConnection: () => socket });
      try {
        assert.strictEqual(client.connecting, true);
        const { promise: connected, resolve } = Promise.withResolvers<string>();
        client.once("connect", () => resolve(store()));
        const early = als.run("early", () => settingsStore(client));
        assert.deepStrictEqual(await Promise.all([connected, early]), ["socket", "socket"]);
      } finally {
        client.destroy();
        server.close();
      }
    });

    test("runs the callback in the store of its caller when createConnection() returned a connected socket", async () => {
      const server = await listen();
      const socket = net.connect(portOf(server), "127.0.0.1");
      await once(socket, "connect");
      const client = connect(server, { createConnection: () => socket });
      try {
        assert.strictEqual(client.connecting, false);
        assert.strictEqual(await als.run("early", () => settingsStore(client)), "early");
      } finally {
        client.destroy();
        server.close();
      }
    });

    test("sends a custom setting whose id is not written in decimal", async () => {
      const server = await listen({ remoteCustomSettings: [0x10] });
      const serverSession = once(server, "session") as Promise<[http2.ServerHttp2Session]>;
      const client = connect(server);
      try {
        assert.strictEqual(client.connecting, true);
        const customSettings: Record<string, number> = { "0x10": 7 };
        await settingsStore(client, { customSettings });
        const [session] = await serverSession;
        assert.deepStrictEqual({ ...session.remoteSettings.customSettings }, { 16: 7 });
      } finally {
        client.destroy();
        server.close();
      }
    });

    test("does not call the callback when the session is destroyed first", async () => {
      const server = await listen();
      const client = connect(server);
      try {
        let called = false;
        client.settings({}, () => (called = true));
        client.destroy();
        await once(client, "close");
        await tick();
        assert.strictEqual(called, false);
      } finally {
        server.close();
      }
    });
  });

  for (const side of ["client", "server"] as const) {
    test(`tells the callback of a SETTINGS frame that a ${side} session cannot send, in the store of its caller`, async () => {
      const { client, session: serverSession, close } = await pair({ maxOutstandingSettings: 2 });
      try {
        const session = side === "client" ? client : serverSession;
        const { promise: failed, resolve } = Promise.withResolvers<string | undefined>();
        client.on("error", () => {});
        serverSession.on("error", () => {});
        session.on("error", (err: NodeJS.ErrnoException) => resolve(err.code));
        // Nothing waits for an acknowledgement yet: the third call is one too many.
        const told: string[] = [];
        for (const user of ["alice", "bob", "carol"]) {
          als.run(user, () => {
            session.settings({}, (err: NodeJS.ErrnoException | null) => {
              if (err) told.push(`${user} is told ${err.code} in ${store()}`);
            });
            told.push(`settings() of ${user} returns`);
          });
        }
        assert.deepStrictEqual(
          { told, error: await failed },
          {
            told: [
              "settings() of alice returns",
              "settings() of bob returns",
              "carol is told ERR_HTTP2_SETTINGS_CANCEL in carol",
              "settings() of carol returns",
            ],
            error: "ERR_HTTP2_MAX_PENDING_SETTINGS_ACK",
          },
        );
      } finally {
        close();
      }
    });
  }

  test("gives each callback its own acknowledgement when the transport answers inside the call", async () => {
    const [a, b] = duplexPair();
    const session = http2.performServerHandshake(b);
    const client = http2.connect("http://localhost", { createConnection: () => a });
    try {
      await Promise.all([once(client, "localSettings"), once(session, "localSettings")]);
      const seen: Record<string, unknown> = {};
      let acknowledgements = 0;
      const { promise: allAcknowledged, resolve } = Promise.withResolvers<void>();
      session.on("localSettings", () => ++acknowledgements === 3 && resolve());
      for (const [user, maxConcurrentStreams] of [
        ["alice", 5],
        ["bob", 6],
      ] as const) {
        als.run(user, () =>
          session.settings({ maxConcurrentStreams }, (_err, settings) => {
            seen[user] = [store(), settings.maxConcurrentStreams];
          }),
        );
      }
      session.settings({ maxConcurrentStreams: 7 });
      await allAcknowledged;
      assert.deepStrictEqual(seen, { alice: ["alice", 5], bob: ["bob", 6] });
    } finally {
      client.destroy();
      session.destroy();
    }
  });
});

describe("Http2Session.ping()", () => {
  test("calls the callback in the store of its caller, with (null, duration, payload) and no `this`", async () => {
    const { client, session, close } = await pair();
    try {
      const pings = [
        ["alice", client],
        ["bob", client],
        ["carol", session],
      ] as const;
      const seen = await Promise.all(
        pings.map(([user, from]) =>
          als.run(user, () => {
            const { promise, resolve } = Promise.withResolvers<unknown[]>();
            from.ping(Buffer.from(user.padEnd(8)), function (this: unknown, err, duration, payload) {
              resolve([store(), this, err, typeof duration, payload.toString()]);
            });
            return promise;
          }),
        ),
      );
      assert.deepStrictEqual(
        seen,
        pings.map(([user]) => [user, undefined, null, "number", user.padEnd(8)]),
      );
      assert.strictEqual(await pingStore(client), "no store");
    } finally {
      close();
    }
  });

  test("cancels a ping in the store of its caller when the session is destroyed", async () => {
    const { client, close } = await pair();
    try {
      const cancelled = ["alice", "bob"].map(user =>
        als.run(user, () => {
          const { promise, resolve } = Promise.withResolvers<unknown[]>();
          client.ping((...args: unknown[]) => resolve([store(), (args[0] as NodeJS.ErrnoException).code, args.length]));
          return promise;
        }),
      );
      als.run("destroyer", () => client.destroy());
      assert.deepStrictEqual(await Promise.all(cancelled), [
        ["alice", "ERR_HTTP2_PING_CANCEL", 1],
        ["bob", "ERR_HTTP2_PING_CANCEL", 1],
      ]);
    } finally {
      close();
    }
  });

  test("cancels a ping in the store of its caller when the socket closes", async () => {
    // This peer never answers.
    const sockets: net.Socket[] = [];
    const server = net.createServer(socket => {
      sockets.push(socket.on("error", () => {}).resume());
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const client = connect(server);
    client.on("error", () => {});
    try {
      await once(client, "connect");
      const { promise: cancelled, resolve } = Promise.withResolvers<unknown[]>();
      als.run("alice", () => client.ping((err: NodeJS.ErrnoException | null) => resolve([store(), err?.code])));
      while (sockets.length === 0) await tick();
      sockets[0].destroy();
      assert.deepStrictEqual(await cancelled, ["alice", "ERR_HTTP2_PING_CANCEL"]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("gives each callback its own acknowledgement when the transport answers inside the call", async () => {
    const [a, b] = duplexPair();
    const session = http2.performServerHandshake(b);
    const client = http2.connect("http://localhost", { createConnection: () => a });
    try {
      await Promise.all([once(client, "localSettings"), once(session, "localSettings")]);
      const seen: Record<string, unknown> = {};
      for (const user of ["alice", "bob"]) {
        als.run(user, () =>
          session.ping(Buffer.from(user.padEnd(8)), (_err, _duration, payload) => {
            seen[user] = [store(), payload.toString().trim()];
          }),
        );
      }
      // The acknowledgement of a SETTINGS frame that follows the two PING frames follows theirs.
      const settled = once(session, "localSettings");
      session.settings({});
      await settled;
      assert.deepStrictEqual(seen, { alice: ["alice", "alice"], bob: ["bob", "bob"] });
    } finally {
      client.destroy();
      session.destroy();
    }
  });

  test("keeps a store that the callback enters to itself", async () => {
    const { client, pump, close } = await manualSessions();
    try {
      const stores: string[] = [];
      outsideAnyStore(() =>
        client.ping(() => {
          stores.push(`callback in ${store()}`);
          als.enterWith("entered");
        }),
      );
      // The acknowledgement is delivered inside a pump() call of this loop.
      while (stores.length === 0) {
        pump();
        if (store() !== "no store") stores.push(`the pump() caller in ${store()}`);
        await tick();
      }
      assert.deepStrictEqual(stores, ["callback in no store"]);
    } finally {
      close();
    }
  });
});

if (typeof Bun !== "undefined") {
  describe("a caller inside a Bun.ModuleGraph that is disposed before the acknowledgement", () => {
    test("is not called back by settings(), and the session still gets 'localSettings'", async () => {
      const { client, close } = await pair();
      const graph = new Bun.ModuleGraph();
      try {
        let called = false;
        const delivered: string[] = [];
        client.on("localSettings", () => delivered.push(`'localSettings' in ${store()}`));
        graph.run(() => als.run("tenant", () => client.settings({}, () => (called = true))));
        graph.dispose();
        await once(client, "localSettings");
        assert.deepStrictEqual(
          { called, delivered, pendingSettingsAck: client.pendingSettingsAck },
          { called: false, delivered: ["'localSettings' in session"], pendingSettingsAck: false },
        );
      } finally {
        graph.dispose();
        close();
      }
    });

    test("is not called back by ping(), and the session closes without it", async () => {
      const { client, close } = await pair();
      const graph = new Bun.ModuleGraph();
      try {
        let called = false;
        graph.run(() => client.ping(() => (called = true)));
        graph.dispose();
        // The acknowledgement of a ping that follows is after the one of the graph's ping.
        assert.strictEqual(await pingStore(client), "no store");
        client.close();
        await once(client, "close");
        assert.strictEqual(called, false);
      } finally {
        graph.dispose();
        close();
      }
    });
  });

  describe("a session that is destroyed", () => {
    test("lets go of the callbacks that got no acknowledgement", async () => {
      // This peer never answers.
      const server = net.createServer(socket => socket.on("error", () => {}).resume());
      await once(server.listen(0, "127.0.0.1"), "listening");
      const N = 20;
      // What each callback keeps alive, per method.
      const kept = { settings: [] as WeakRef<object>[], ping: [] as WeakRef<object>[] };
      const keep = (refs: WeakRef<object>[]) => {
        const payload = { bytes: new Uint8Array(64 * 1024) };
        refs.push(new WeakRef(payload));
        return () => payload;
      };
      try {
        // The sessions stay reachable: what a session still keeps is not let go of.
        const sessions = await Promise.all(
          Array.from({ length: N }, async () => {
            const client = http2.connect(`http://127.0.0.1:${portOf(server)}`);
            client.on("error", () => {});
            await once(client, "connect");
            client.settings({}, keep(kept.settings));
            client.ping(keep(kept.ping));
            client.destroy();
            await once(client, "close");
            return client;
          }),
        );
        const alive = () =>
          [kept.settings, kept.ping].map(refs => refs.filter(ref => ref.deref() !== undefined).length);
        for (let i = 0; i < 20 && Math.max(...alive()) > N / 2; i++) {
          Bun.gc(true);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.strictEqual(sessions.length, N);
        for (const n of alive()) assert.ok(n <= N / 2, `${n} of ${N} payloads are still alive`);
      } finally {
        server.close();
      }
    });

    test("keeps a ping when destroy() throws", async () => {
      const { client, close } = await pair();
      try {
        const { promise, resolve } = Promise.withResolvers<string>();
        client.ping((err: NodeJS.ErrnoException | null) => resolve(err?.code ?? "acknowledged"));
        assert.throws(() => client.destroy(new Error("destroyed"), "not a code" as unknown as number));
        assert.strictEqual(await promise, "acknowledged");
      } finally {
        close();
      }
    });
  });
}

// A process that has made no AsyncLocalStorage. One process runs the three scenarios, and it starts
// before the first test: a debug build takes seconds to load node:http2 and to run them. The tests
// below read what it prints.
type FreshProcess = {
  tracking?: { before: boolean; after: boolean };
  thrown: { uncaught: string; emitted: boolean; pendingSettingsAck: boolean };
  stores: { settings: string; ping: string; localSettings: string };
};
const execFileAsync = promisify(execFile);
let freshProcess: Promise<FreshProcess> | undefined;
before(() => void inFreshProcess().catch(() => {}));
function inFreshProcess() {
  const source = `
    const http2 = require("node:http2");
    const { once } = require("node:events");
    const { Duplex } = require("node:stream");
    const manualPair = ${manualPair.toString()};
    const tick = () => new Promise(resolve => setImmediate(resolve));
    (async () => {
      const report = {};
      const server = http2.createServer().listen(0, "127.0.0.1");
      await once(server, "listening");
      const client = http2.connect("http://127.0.0.1:" + server.address().port);
      await once(client, "localSettings");

      // node always tracks async contexts. Bun starts when something needs it.
      if (typeof Bun !== "undefined") {
        const frames = require("bun:internal-for-testing").exposedInternals["internal/async_context_frame"];
        // A promise reaction runs in the frame that was current when it was made, only while
        // the process tracks async contexts.
        const isTracking = () => {
          const frame = { storage: {}, value: 1, prev: undefined, masked: undefined };
          const previous = frames.exchange(frame);
          const tracked = Promise.resolve().then(() => frames.current() === frame);
          frames.exchange(previous);
          return tracked;
        };
        const before = await isTracking();
        await new Promise(resolve => client.settings({}, () => client.ping(resolve)));
        report.tracking = { before, after: await isTracking() };
      }

      let emitted = false;
      client.on("localSettings", () => (emitted = true));
      const uncaught = once(process, "uncaughtException");
      client.settings({}, () => {
        throw new Error("thrown by the callback");
      });
      const [err] = await uncaught;
      await tick();
      report.thrown = { uncaught: err.message, emitted, pendingSettingsAck: client.pendingSettingsAck };
      client.destroy();
      server.close();

      const { a, b, pump } = manualPair();
      const session = http2.performServerHandshake(b);
      const other = http2.connect("http://localhost", { createConnection: () => a });
      let acknowledged = 0;
      other.once("localSettings", () => acknowledged++);
      session.once("localSettings", () => acknowledged++);
      while (acknowledged < 2) {
        pump();
        await tick();
      }
      const stores = {};
      let als;
      const store = () => als.getStore() ?? "no store";
      other.settings({}, () => (stores.settings = store()));
      other.ping(() => (stores.ping = store()));
      other.on("localSettings", () => (stores.localSettings = store()));
      // The first AsyncLocalStorage of the process, after the two calls.
      als = new (require("node:async_hooks").AsyncLocalStorage)();
      await als.run("transport", async () => {
        while (Object.keys(stores).length < 3) {
          pump();
          await tick();
        }
      });
      report.stores = stores;
      other.destroy();
      session.destroy();
      console.log(JSON.stringify(report));
    })();
  `;
  return (freshProcess ??= execFileAsync(process.execPath, ["-e", source], {
    env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
  }).then(({ stdout }) => JSON.parse(stdout)));
}

describe("a process that has made no AsyncLocalStorage", () => {
  if (typeof Bun !== "undefined") {
    test("does not start to track async contexts for settings() or ping()", async () => {
      const { tracking } = await inFreshProcess();
      assert.deepStrictEqual(tracking, { before: false, after: false });
    });
  }

  test("ends the delivery when a settings() callback throws: 'localSettings' is not emitted", async () => {
    const { thrown } = await inFreshProcess();
    assert.deepStrictEqual(thrown, { uncaught: "thrown by the callback", emitted: false, pendingSettingsAck: false });
  });

  test("runs the callbacks with no store when it makes one before the acknowledgements, and they arrive inside it", async () => {
    const { stores } = await inFreshProcess();
    assert.deepStrictEqual(stores, { settings: "no store", ping: "no store", localSettings: "no store" });
  });
});
