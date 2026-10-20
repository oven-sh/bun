/**
 * Http2Session.settings(settings, callback) sends a SETTINGS frame and calls `callback` when the
 * peer acknowledges it. Many callers can share one session. The callback runs in the async context
 * of its settings() caller, not in the context that the session was created in.
 *
 * node keeps one async resource per SETTINGS frame, made inside settings():
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L898-L907
 * While the session connects, node submits the frame from a 'connect' listener:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/http2/core.js#L1569-L1574
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-settings-async-context.test.ts
 *   node --test test/js/node/http2/node-http2-settings-async-context.test.ts
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";

const als = new AsyncLocalStorage<string>();
const store = () => als.getStore() ?? "no store";

// The server listens in the "listener" store, and its sessions are made in it.
async function listen() {
  const server = http2.createServer();
  await once(
    als.run("listener", () => server.listen(0, "127.0.0.1")),
    "listening",
  );
  return server;
}
// The client session is made in the "session" store.
function connect(server: http2.Http2Server, options?: http2.ClientSessionOptions) {
  const { port } = server.address() as AddressInfo;
  return als.run("session", () => http2.connect(`http://127.0.0.1:${port}`, options));
}
// Resolves with the store that the settings() callback ran in.
function settingsStore(session: http2.Http2Session, settings: http2.Settings = {}) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  session.settings(settings, err => (err ? reject(err) : resolve(store())));
  return promise;
}
// Calls settings() once as each user, all in one tick.
function settingsStoresAs(session: http2.Http2Session, users: string[]) {
  return Promise.all(users.map(user => als.run(user, () => settingsStore(session))));
}

describe("the callback of Http2Session.settings()", () => {
  test("runs in the store of its caller on a client session", async () => {
    const server = await listen();
    const client = connect(server);
    try {
      await once(client, "connect");
      assert.deepStrictEqual(await settingsStoresAs(client, ["alice", "bob"]), ["alice", "bob"]);
    } finally {
      client.close();
      server.close();
    }
  });

  test("runs in the store of its caller on a server session", async () => {
    const server = await listen();
    const serverSession = once(server, "session");
    const client = connect(server);
    try {
      const [session] = (await serverSession) as [http2.ServerHttp2Session];
      assert.deepStrictEqual(await settingsStoresAs(session, ["carol", "dave"]), ["carol", "dave"]);
    } finally {
      client.close();
      server.close();
    }
  });

  test("runs with no store when its caller has none", async () => {
    const server = await listen();
    const serverSession = once(server, "session");
    const client = connect(server);
    try {
      const [session] = (await serverSession) as [http2.ServerHttp2Session];
      await once(client, "connect");
      assert.deepStrictEqual(await Promise.all([settingsStore(client), settingsStore(session)]), [
        "no store",
        "no store",
      ]);
    } finally {
      client.close();
      server.close();
    }
  });

  test("runs in the store of its caller when settings() is called from another settings() callback", async () => {
    const server = await listen();
    const client = connect(server);
    try {
      await once(client, "connect");
      const { promise, resolve } = Promise.withResolvers<string[]>();
      als.run("outer", () =>
        client.settings({}, () => {
          const outer = store();
          als.run("inner", () => client.settings({}, () => resolve([outer, store()])));
        }),
      );
      assert.deepStrictEqual(await promise, ["outer", "inner"]);
    } finally {
      client.close();
      server.close();
    }
  });

  test("gets (null, settings, duration) and no `this`", async () => {
    const server = await listen();
    const client = connect(server);
    try {
      await once(client, "connect");
      const { promise, resolve } = Promise.withResolvers<unknown[]>();
      client.settings({ initialWindowSize: 123456 }, function (this: unknown, ...args: unknown[]) {
        resolve([this, ...args]);
      });
      const [self, err, settings, duration] = await promise;
      assert.strictEqual(self, undefined);
      assert.strictEqual(err, null);
      assert.strictEqual((settings as http2.Settings).initialWindowSize, 123456);
      assert.strictEqual(typeof duration, "number");
    } finally {
      client.close();
      server.close();
    }
  });

  // node submits the frame from a 'connect' listener, so the callback sees what that listener sees.
  test("runs in the store of the 'connect' event when settings() was called before the connect", async () => {
    const server = await listen();
    const client = connect(server);
    try {
      assert.strictEqual(client.connecting, true);
      const early = als.run("early", () => settingsStore(client));
      const { promise: connected, resolve } = Promise.withResolvers<string>();
      client.once("connect", () => resolve(store()));
      assert.deepStrictEqual(await Promise.all([connected, early]), ["session", "session"]);
    } finally {
      client.close();
      server.close();
    }
  });
});
