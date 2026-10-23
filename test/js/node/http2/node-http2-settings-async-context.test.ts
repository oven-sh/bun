/**
 * Http2Session.settings(settings, callback) sends a SETTINGS frame, and the peer acknowledges it.
 * Many callers can share one session. What the acknowledgement delivers (the callback, then the
 * 'localSettings' event) runs in the async context of the caller that sent the frame, not in the
 * context that the session was made in. Each caller gets the acknowledgement of its own frame, also
 * when the peer answers before settings() or ping() returns.
 *
 * node keeps one async resource per frame, made when the frame is submitted:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L881-L907
 * While a session connects, node submits the frame from a 'connect' listener:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1569-L1574
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-settings-async-context.test.ts
 *   node --test test/js/node/http2/node-http2-settings-async-context.test.ts
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { Duplex, duplexPair } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";

const als = new AsyncLocalStorage<string>();
const store = () => als.getStore() ?? "no store";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
// Runs a function in the async context that this module is loaded in: no store of any
// AsyncLocalStorage. A test function runs in a context of the test runner.
const outsideAnyStore = AsyncLocalStorage.snapshot();
const sides = ["client", "server"] as const;
const keys = path.join(import.meta.dirname, "..", "test", "fixtures", "keys");
const tlsOptions = {
  key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
  ALPNProtocols: ["h2"],
};

// Whether the TLS handshake of a socket is not finished. The types of node do not have the property.
const secureConnecting = (socket: net.Socket) =>
  (socket as net.Socket & { secureConnecting?: boolean }).secureConnecting;

// The server listens in the "listener" store, and its sessions are made in it.
async function listen(server: net.Server = http2.createServer()) {
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
async function pair(options: { maxOutstandingPings?: number } = {}) {
  const server = await listen(http2.createServer(options));
  const serverSession = once(server, "session") as Promise<[http2.ServerHttp2Session]>;
  const client = connect(server, options);
  const [[session]] = await Promise.all([serverSession, once(client, "localSettings")]);
  if (session.pendingSettingsAck) await once(session, "localSettings");
  client.on("error", () => {});
  session.on("error", () => {});
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
function settingsStore(session: http2.Http2Session) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  session.settings({}, err => (err ? reject(err) : resolve(store())));
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
// Sessions over manualPair(), both made outside any store: the sessions have no async context to
// deliver in. The SETTINGS frames that the two sessions send at first are acknowledged.
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

// The length of each chunk that is written to one end of a connection.
function recordWrites(end: Duplex) {
  const lengths: number[] = [];
  const write = end.write;
  end.write = function (this: Duplex, ...args: Parameters<Duplex["write"]>) {
    lengths.push((args[0] as Buffer).length);
    return write.apply(this, args);
  } as Duplex["write"];
  return lengths;
}
// Sessions over duplexPair(), with one open stream whose response headers are sent. What one end
// writes, the other end can read inside that write. `written` has what each session wrote.
async function directSessions() {
  const [a, b] = duplexPair();
  const written = { client: recordWrites(a), server: recordWrites(b) };
  const session = http2.performServerHandshake(b);
  const client = http2.connect("http://localhost", { createConnection: () => a });
  await Promise.all([once(client, "localSettings"), once(session, "localSettings")]);
  const opened = once(session, "stream") as Promise<[http2.ServerHttp2Stream]>;
  const request = client.request({ ":method": "POST" });
  request.on("error", () => {}).resume();
  const [stream] = await opened;
  stream.on("error", () => {}).resume();
  stream.respond();
  // After two turns the response headers are written, and no session is reading.
  await tick();
  await tick();
  return {
    sessions: { client, server: session },
    streams: { client: request, server: stream },
    written,
    close() {
      client.destroy();
      session.destroy();
    },
  };
}
// Bun holds the frames of one turn in 16,384 bytes (H2_CORK_BUFFER_SIZE), and writes at once a frame
// that does not fit. A DATA frame is 9 bytes and its payload: after this one, 8 bytes are left.
const almostFull = Buffer.alloc(16384 - 9 - 8);

// alice and bob with a callback, then a caller without one. Returns the store that each callback ran
// in with the setting that it was called with, and what the call of alice did before it returned.
async function settingsOfAliceAndBob(session: http2.Http2Session, written: number[]) {
  const seen: Record<string, unknown> = {};
  let acknowledgements = 0;
  const { promise: allAcknowledged, resolve } = Promise.withResolvers<void>();
  session.on("localSettings", () => ++acknowledgements === 3 && resolve());
  let insideTheCallOfAlice = { acknowledgements: 0, wrote: [] as number[] };
  for (const [user, maxConcurrentStreams] of [
    ["alice", 5],
    ["bob", 6],
  ] as const) {
    const chunks = written.length;
    als.run(user, () =>
      session.settings({ maxConcurrentStreams }, (_err, settings) => {
        seen[user] = [store(), settings.maxConcurrentStreams];
      }),
    );
    if (user === "alice") insideTheCallOfAlice = { acknowledgements, wrote: written.slice(chunks) };
  }
  session.settings({ maxConcurrentStreams: 7 });
  await allAcknowledged;
  return { seen, insideTheCallOfAlice };
}
const ofAliceAndBob = { alice: ["alice", 5], bob: ["bob", 6] };

// Three pings, then a SETTINGS frame: its acknowledgement is the last one. Returns the payload that
// each ping callback was called with.
async function pingsOfThree(session: http2.Http2Session) {
  const seen: Record<string, string> = {};
  for (const payload of ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"]) {
    session.ping(Buffer.from(payload), (err, _duration, echoed) => {
      seen[payload] = err ? String((err as NodeJS.ErrnoException).code) : echoed.toString();
    });
  }
  const acknowledged = once(session, "localSettings");
  session.settings({});
  await acknowledged;
  await tick();
  return seen;
}
const ofThreePings = { AAAAAAAA: "AAAAAAAA", BBBBBBBB: "BBBBBBBB", CCCCCCCC: "CCCCCCCC" };

// Two settings() calls: the outer one in the "outer" store, and a nested one that a getter of the
// outer settings makes at its last read. `make` gets what the getter calls. Returns what the two
// acknowledgements delivered, in order.
async function settingsFromAGetter(target: http2.Http2Session, make: (read: () => void) => http2.Settings) {
  const delivered: string[] = [];
  // How often one call reads through the getter.
  let reads = 0;
  let left = Infinity;
  const read = () => {
    reads++;
    if (--left !== 0) return;
    als.run("nested", () =>
      target.settings({ maxConcurrentStreams: 6 }, (_err, settings) => {
        delivered.push(`nested callback with ${settings.maxConcurrentStreams}`);
      }),
    );
  };
  target.settings(make(read));
  await once(target, "localSettings");
  left = reads;
  let acknowledgements = 0;
  const { promise: bothAcknowledged, resolve } = Promise.withResolvers<void>();
  target.on("localSettings", settings => {
    delivered.push(`'localSettings' with ${settings.maxConcurrentStreams} in ${store()}`);
    if (++acknowledgements === 2) resolve();
  });
  als.run("outer", () =>
    target.settings(make(read), (_err, settings) => {
      delivered.push(`outer callback with ${settings.maxConcurrentStreams}`);
    }),
  );
  await bothAcknowledged;
  return delivered;
}
// node reads the settings before it records the frame: the call that the getter makes is sent first.
const fromAGetter = [
  "nested callback with 6",
  "'localSettings' with 6 in nested",
  "outer callback with 5",
  "'localSettings' with 5 in outer",
];

// Collects what a callback throws past everyone. bun's test runner takes an uncaught exception before
// the process does, but not one that is thrown in the context of a Bun.ModuleGraph: run() enters one.
function collectUncaught() {
  const thrown: unknown[] = [];
  if (typeof Bun !== "undefined") {
    const graph = new Bun.ModuleGraph({ onError: (error: unknown) => void thrown.push(error) });
    return { thrown, run: <T>(fn: () => T) => graph.run(fn), stop: () => graph.dispose() };
  }
  process.setUncaughtExceptionCaptureCallback(error => void thrown.push(error));
  return { thrown, run: <T>(fn: () => T) => fn(), stop: () => process.setUncaughtExceptionCaptureCallback(null) };
}

describe("Http2Session.settings()", () => {
  for (const side of sides) {
    test(`delivers the acknowledgement in the store of each caller on a ${side} session`, async () => {
      const { client, session, close } = await pair();
      try {
        const delivered = await settingsFromThreeCallers(side === "client" ? client : session);
        assert.deepStrictEqual(delivered, fromThreeCallers);
      } finally {
        close();
      }
    });
  }

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

  for (const side of sides) {
    test(`keeps a store that the callback enters to the delivery on a ${side} session`, async () => {
      const { client, session, pump, close } = await manualSessions();
      try {
        const target = side === "client" ? client : session;
        const stores: string[] = [];
        target.on("localSettings", () => stores.push(`'localSettings' in ${store()}`));
        target.settings({}, () => {
          stores.push(`callback in ${store()}`);
          als.enterWith("entered");
        });
        // The acknowledgement is delivered inside a pump() call of this loop. The async context of
        // that call is the one of the settings() call.
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
  }

  test("does not emit 'localSettings' when the callback throws, and delivers the next acknowledgement", async () => {
    const uncaught = collectUncaught();
    const { client, close } = await uncaught.run(pair);
    try {
      const error = new Error("alice throws");
      const delivered: string[] = [];
      const { promise: acknowledged, resolve } = Promise.withResolvers<void>();
      client.on("localSettings", () => {
        delivered.push(`'localSettings' in ${store()}`);
        resolve();
      });
      uncaught.run(() => {
        als.run("alice", () =>
          client.settings({}, () => {
            delivered.push(`callback in ${store()}`);
            throw error;
          }),
        );
        als.run("bob", () => client.settings({}, () => void delivered.push(`callback in ${store()}`)));
      });
      await acknowledged;
      assert.deepStrictEqual(
        { delivered, thrown: uncaught.thrown, pendingSettingsAck: client.pendingSettingsAck },
        {
          delivered: ["callback in alice", "callback in bob", "'localSettings' in bob"],
          thrown: [error],
          pendingSettingsAck: false,
        },
      );
    } finally {
      close();
      uncaught.stop();
    }
  });

  test("leaves the async context of the transport as it was when the callback throws", async () => {
    const { client, pump, close } = await manualSessions();
    const uncaught = collectUncaught();
    try {
      const error = new Error("alice throws");
      const seen: string[] = [];
      await uncaught.run(async () => {
        als.run("alice", () =>
          client.settings({}, () => {
            seen.push(`callback in ${store()}`);
            throw error;
          }),
        );
        // The acknowledgement is delivered inside a pump() call of this loop.
        for (let i = 0; i < 50 && uncaught.thrown.length === 0; i++) {
          pump();
          if (store() !== "no store") seen.push(`the pump() caller in ${store()}`);
          await tick();
        }
      });
      assert.deepStrictEqual({ seen, thrown: uncaught.thrown }, { seen: ["callback in alice"], thrown: [error] });
    } finally {
      pump();
      close();
      uncaught.stop();
    }
  });

  test("gives the next acknowledgement to the next call when a call throws", async () => {
    const { client, close } = await pair();
    try {
      // How often one call reads a setting. The last read is after the arguments are checked.
      let reads = 0;
      client.settings({
        get initialWindowSize() {
          reads++;
          return 65535;
        },
      });
      await once(client, "localSettings");
      const called: string[] = [];
      const throwsAtLastRead = {
        get initialWindowSize(): number {
          if (--reads === 0) throw new Error("the last read throws");
          return 65535;
        },
      };
      assert.throws(() => client.settings(throwsAtLastRead, () => called.push("the call that threw")), {
        message: "the last read throws",
      });
      client.settings({}, () => called.push("the next call"));
      await once(client, "localSettings");
      assert.deepStrictEqual(called, ["the next call"]);
    } finally {
      close();
    }
  });

  for (const side of sides) {
    test(`returns when a getter of the settings destroys the ${side} session`, async () => {
      const { client, session, close } = await pair();
      try {
        const target = side === "client" ? client : session;
        let called = false;
        const destroys = {
          get initialWindowSize() {
            target.destroy();
            return 65535;
          },
        };
        target.settings(destroys, () => (called = true));
        await once(target, "close");
        await tick();
        assert.strictEqual(called, false);
      } finally {
        close();
      }
    });
  }

  for (const [side, what, make] of [
    [
      "client",
      "a setting",
      (read: () => void): http2.Settings => ({
        get maxConcurrentStreams() {
          read();
          return 5;
        },
      }),
    ],
    [
      "server",
      "a custom setting",
      (read: () => void): http2.Settings => ({
        maxConcurrentStreams: 5,
        customSettings: Object.defineProperty({}, "1244", { enumerable: true, get: () => (read(), 1) }),
      }),
    ],
  ] as const) {
    test(`gives each call its own acknowledgement when a getter of ${what} calls settings() on a ${side} session`, async () => {
      const { client, session, close } = await pair();
      try {
        assert.deepStrictEqual(await settingsFromAGetter(side === "client" ? client : session, make), fromAGetter);
      } finally {
        close();
      }
    });
  }

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

    // TCP is connected and the TLS handshake is not finished: node still waits for the 'connect' event.
    for (const overConnectedSocket of [false, true]) {
      const when = overConnectedSocket ? "on a TLS socket over a connected socket" : "during the TLS handshake";
      test(`runs the callback in the store of the 'connect' event when it is called ${when}`, async () => {
        const server = await listen(http2.createSecureServer(tlsOptions));
        const port = portOf(server);
        // What a CONNECT proxy gives: a tunnel that is connected before the handshake starts.
        const tunnel = overConnectedSocket ? net.connect(port, "127.0.0.1") : undefined;
        if (tunnel) await once(tunnel, "connect");
        let socket!: tls.TLSSocket;
        const client = als.run("session", () =>
          http2.connect(`https://127.0.0.1:${port}`, {
            createConnection: () =>
              (socket = tls.connect({
                ...(tunnel ? { socket: tunnel } : { host: "127.0.0.1", port }),
                ALPNProtocols: ["h2"],
                rejectUnauthorized: false,
              })),
          }),
        );
        try {
          client.on("error", () => {});
          const delivered: string[] = [];
          const { promise: acknowledged, resolve } = Promise.withResolvers<void>();
          client.once("connect", () => delivered.push(`'connect' in ${store()}`));
          // The first 'localSettings' is of the SETTINGS frame that the session sends by itself.
          client.once("localSettings", () => {
            client.once("localSettings", () => {
              delivered.push(`'localSettings' in ${store()}`);
              resolve();
            });
          });
          if (!tunnel) await once(socket, "connect");
          delivered.push(`called with connecting=${socket.connecting} secureConnecting=${secureConnecting(socket)}`);
          als.run("early", () => client.settings({}, () => delivered.push(`callback in ${store()}`)));
          await acknowledged;
          assert.deepStrictEqual(delivered, [
            "called with connecting=false secureConnecting=true",
            "'connect' in session",
            "callback in session",
            "'localSettings' in session",
          ]);
        } finally {
          client.destroy();
          server.close();
        }
      });
    }

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

    // A server session over a socket that the "session" store makes: each call is made in "caller".
    for (const secure of [false, true]) {
      test(`runs the callback of a server session over a ${secure ? "tls" : "net"} socket that still connects in the store of the 'connect' event`, async () => {
        // The peer is a client session over the accepted socket.
        const accept = (socket: net.Socket) =>
          void http2.connect("http://localhost", { createConnection: () => socket }).on("error", () => {});
        const server = secure ? tls.createServer(tlsOptions, accept) : net.createServer(accept);
        await once(server.listen(0, "127.0.0.1"), "listening");
        const port = portOf(server);
        const socket = als.run("session", () =>
          secure
            ? tls.connect({ host: "127.0.0.1", port, ALPNProtocols: ["h2"], rejectUnauthorized: false })
            : net.connect(port, "127.0.0.1"),
        );
        const session = als.run("session", () => http2.performServerHandshake(socket));
        session.on("error", () => {});
        try {
          // The store of each 'localSettings' event. The first one is of the session's own frame.
          const events: string[] = [];
          const waiting: (() => void)[] = [];
          session.on("localSettings", () => {
            events.push(store());
            for (const wake of waiting.splice(0)) wake();
          });
          let calls = 0;
          // Resolves with the store of the callback, when there is one, and the store of the event.
          const settingsInCaller = async (withCallback = true) => {
            const index = ++calls;
            const stores: string[] = [];
            als.run("caller", () =>
              withCallback ? session.settings({}, () => stores.push(store())) : session.settings({}),
            );
            while (events.length <= index) await new Promise<void>(resolve => waiting.push(resolve));
            return [...stores, events[index]];
          };
          assert.strictEqual(socket.connecting, true);
          const whileItConnects = [settingsInCaller(), settingsInCaller(false)];
          if (secure) {
            await once(socket, "connect");
            assert.strictEqual(secureConnecting(socket), true);
            whileItConnects.push(settingsInCaller());
          }
          assert.deepStrictEqual(
            { whileItConnects: await Promise.all(whileItConnects), afterTheConnect: await settingsInCaller() },
            {
              whileItConnects: [["session", "session"], ["session"], ...(secure ? [["session", "session"]] : [])],
              afterTheConnect: ["caller", "caller"],
            },
          );
        } finally {
          session.destroy();
          server.close();
        }
      });
    }
  });

  describe("over an in-process transport, which can deliver the acknowledgement before settings() returns", () => {
    for (const side of sides) {
      test(`gives each callback its own acknowledgement on a ${side} session`, async () => {
        const { sessions, written, close } = await directSessions();
        try {
          const { seen, insideTheCallOfAlice } = await settingsOfAliceAndBob(sessions[side], written[side]);
          assert.deepStrictEqual(seen, ofAliceAndBob);
          // The premise, for Bun: the acknowledgement of alice arrived inside her call.
          if (typeof Bun !== "undefined") assert.strictEqual(insideTheCallOfAlice.acknowledgements, 1);
        } finally {
          close();
        }
      });

      test(`gives each callback its own acknowledgement when the frame is written while it is submitted on a ${side} session`, async () => {
        const { sessions, streams, written, close } = await directSessions();
        try {
          const before = written[side].length;
          streams[side].write(almostFull);
          const held = written[side].length === before;
          const { seen, insideTheCallOfAlice } = await settingsOfAliceAndBob(sessions[side], written[side]);
          assert.deepStrictEqual(seen, ofAliceAndBob);
          // The premise, for Bun: the DATA frame was held, and the SETTINGS frame of alice did not
          // fit behind it. The two went out in one write, which is more than Bun holds.
          if (typeof Bun !== "undefined") {
            assert.deepStrictEqual(
              { held, acknowledgements: insideTheCallOfAlice.acknowledgements },
              { held: true, acknowledgements: 1 },
            );
            assert.ok(insideTheCallOfAlice.wrote[0] > 16384, `the call wrote ${insideTheCallOfAlice.wrote}`);
          }
        } finally {
          close();
        }
      });
    }
  });
});

describe("Http2Session.ping()", () => {
  for (const side of sides) {
    test(`cancels a ping that is one too many, and the next ping gets its own acknowledgement on a ${side} session`, async () => {
      const { client, session, close } = await pair({ maxOutstandingPings: 2 });
      try {
        const target = side === "client" ? client : session;
        const seen: string[] = [];
        let waiting = () => {};
        const ping = (payload: string) =>
          target.ping(Buffer.from(payload), (err, _duration, echoed) => {
            seen.push(`${payload}: ${err ? (err as NodeJS.ErrnoException).code : echoed.toString()}`);
            waiting();
          });
        const seenAll = (count: number) =>
          new Promise<void>(resolve => (waiting = () => seen.length === count && resolve()));
        const three = seenAll(3);
        const sent = [ping("AAAAAAAA"), ping("BBBBBBBB"), ping("CCCCCCCC")];
        await three;
        const four = seenAll(4);
        sent.push(ping("DDDDDDDD"));
        await four;
        assert.deepStrictEqual(
          { sent, seen },
          {
            sent: [true, true, false, true],
            seen: ["CCCCCCCC: ERR_HTTP2_PING_CANCEL", "AAAAAAAA: AAAAAAAA", "BBBBBBBB: BBBBBBBB", "DDDDDDDD: DDDDDDDD"],
          },
        );
      } finally {
        close();
      }
    });

    test(`gives each callback its own acknowledgement when the frame is written while it is submitted on a ${side} session`, async () => {
      const { sessions, streams, close } = await directSessions();
      try {
        streams[side].write(almostFull);
        assert.deepStrictEqual(await pingsOfThree(sessions[side]), ofThreePings);
      } finally {
        close();
      }
    });
  }
});

if (typeof Bun !== "undefined") {
  describe("Http2Session.settings() in Bun", () => {
    for (const side of sides) {
      test(`gives the next acknowledgement to the next call when the parser rejects a setting on a ${side} session`, async () => {
        const { client, session, close } = await pair();
        try {
          const target = side === "client" ? client : session;
          // How often one call reads a setting. The last read is the one that the parser gets.
          let reads = 0;
          target.settings({
            get initialWindowSize() {
              reads++;
              return 65535;
            },
          });
          await once(target, "localSettings");
          const called: string[] = [];
          const notANumberAtLastRead = {
            get initialWindowSize() {
              return --reads === 0 ? ("65535" as unknown as number) : 65535;
            },
          };
          assert.throws(() => target.settings(notANumberAtLastRead, () => called.push("the call that threw")), {
            code: "ERR_HTTP2_INVALID_SETTING_VALUE",
          });
          target.settings({}, () => called.push("the next call"));
          await once(target, "localSettings");
          assert.deepStrictEqual(called, ["the next call"]);
        } finally {
          close();
        }
      });
    }

    // Bun reads this option of a session in settings() too. node does not.
    test("gives each call its own acknowledgement when a getter of remoteCustomSettings calls settings()", async () => {
      const { client, close } = await pair();
      try {
        const delivered = await settingsFromAGetter(client, read => ({
          maxConcurrentStreams: 5,
          remoteCustomSettings: Object.defineProperty([], 0, { enumerable: true, get: () => (read(), 1244) }),
        }));
        assert.deepStrictEqual(delivered, fromAGetter);
      } finally {
        close();
      }
    });

    test("does not install the async context of a caller in another Bun.ModuleGraph", async () => {
      const { client, close } = await pair();
      const graph = new Bun.ModuleGraph();
      try {
        const delivered: string[] = [];
        client.on("localSettings", () => delivered.push(`'localSettings' in ${store()}`));
        const { promise: acknowledged, resolve } = Promise.withResolvers<void>();
        graph.run(() =>
          als.run("tenant", () =>
            client.settings({}, () => {
              delivered.push(`callback in ${store()}`);
              resolve();
            }),
          ),
        );
        await acknowledged;
        // The delivery runs where the events of the session run.
        assert.deepStrictEqual(delivered, ["callback in session", "'localSettings' in session"]);
      } finally {
        graph.dispose();
        close();
      }
    });

    // The bound of the retention tests in h2-conformance.test.ts.
    const GC_STRAGGLERS = 3;
    for (const side of sides) {
      test(`a destroyed ${side} session that is kept lets go of the callbacks that got no acknowledgement`, async () => {
        // This peer never answers.
        const silent = net.createServer(socket => socket.on("error", () => {}).resume());
        await once(silent.listen(0, "127.0.0.1"), "listening");
        const N = 20;
        // What each callback keeps alive.
        const kept: WeakRef<object>[] = [];
        const keep = () => {
          const payload = { bytes: new Uint8Array(64 * 1024) };
          kept.push(new WeakRef(payload));
          return () => payload;
        };
        try {
          // The sessions stay reachable: what a session still keeps is not let go of.
          const sessions = await Promise.all(
            Array.from({ length: N }, async (_, i) => {
              let session: http2.Http2Session;
              if (side === "client") {
                session = http2.connect(`http://127.0.0.1:${portOf(silent)}`);
                session.on("error", () => {});
                await once(session, "connect");
              } else {
                const socket = net.connect(portOf(silent), "127.0.0.1");
                socket.on("error", () => {});
                await once(socket, "connect");
                session = http2.performServerHandshake(socket);
                session.on("error", () => {});
              }
              const closed = once(session, "close");
              if (i % 2 === 0) {
                session.settings({}, keep());
                session.destroy();
              } else {
                // A getter of the settings destroys the session inside the call.
                const destroys = {
                  get initialWindowSize() {
                    session.destroy();
                    return 65535;
                  },
                };
                session.settings(destroys, keep());
              }
              await closed;
              return session;
            }),
          );
          let alive = N;
          for (let pass = 0; pass < 5 && alive > 0; pass++) {
            // A WeakRef that was read keeps its target until the turn ends: collect in a new turn.
            await tick();
            Bun.gc(true);
            await tick();
            alive = kept.filter(ref => ref.deref() !== undefined).length;
          }
          assert.strictEqual(sessions.length, N);
          assert.ok(alive <= GC_STRAGGLERS, `${alive} of ${N} payloads are still alive`);
        } finally {
          silent.close();
        }
      });
    }
  });

  // node runs a TypeScript file as it is from v22.18. Alpine's node segfaults at a random point of
  // the sibling node-http2-client-close.test.ts, and the CI runner fails a file for any new core dump.
  const node = Bun.which("node");
  const nodeVersion = node ? Bun.spawnSync({ cmd: [node, "-p", "process.versions.node"] }).stdout.toString() : "";
  const isMusl =
    process.platform === "linux" &&
    !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  if (node && parseInt(nodeVersion, 10) >= 24 && !isMusl) {
    describe("Node.js compatibility", () => {
      test("tests should run on node.js", async () => {
        await using proc = Bun.spawn({
          cmd: [node, "--test", import.meta.filename],
          stdout: "inherit",
          stderr: "inherit",
          stdin: "ignore",
        });
        assert.strictEqual(await proc.exited, 0);
      });
    });
  }
}
