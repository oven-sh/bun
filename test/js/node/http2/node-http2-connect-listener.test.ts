// node registers the listener of http2.connect(authority, options, listener) with
// session.once('connect', listener). These tests check that contract: a throw from the
// listener is an ordinary uncaught exception, and the listener is a real 'connect' listener.
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, isDebug, nodeExe } from "harness";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";

async function listen(): Promise<{ server: http2.Http2Server; port: number }> {
  const server = http2.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as net.AddressInfo).port };
}

describe.concurrent("http2 connect() listener that throws", () => {
  // One session has an 'error' listener and one has none. The fixture prints once the server
  // side of both sessions closed, which the flows with and without the fix both reach.
  const fixture = `
    const http2 = require("node:http2");
    const logs = { withSessionErrorListener: [], withoutSessionErrorListener: [] };
    const clients = {};
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    let openSessions = 2;
    server.on("session", session => {
      session.on("close", () => {
        if (--openSessions > 0) return;
        console.log(JSON.stringify(logs));
        server.close();
      });
    });
    // Each listener throws an error whose message names its session.
    process.on("uncaughtException", err => {
      const log = logs[err.message];
      const client = clients[err.message];
      if (!client) throw err;
      log.push("uncaughtException", "destroyed: " + client.destroyed);
      const req = client.request({ ":path": "/" });
      req.on("response", headers => log.push("status: " + headers[":status"]));
      req.on("error", err => log.push("request error: " + err.code));
      req.on("close", () => client.close());
      req.resume();
      req.end();
    });
    server.listen(0, "127.0.0.1", () => {
      for (const name of Object.keys(logs)) {
        clients[name] = http2.connect("http://127.0.0.1:" + server.address().port, () => {
          throw new Error(name);
        });
      }
      clients.withSessionErrorListener.on("error", err => {
        logs.withSessionErrorListener.push("session error: " + err.message);
      });
    });
  `;

  for (const runtime of [bunExe(), nodeExe()]) {
    test.skipIf(!runtime)(
      `raises uncaughtException and leaves the session usable (${path.basename(runtime || "node")})`,
      async () => {
        await using proc = Bun.spawn({ cmd: [runtime!, "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const usable = ["uncaughtException", "destroyed: false", "status: 200"];
        expect({ stdout, stderr, exitCode }).toEqual({
          stdout: JSON.stringify({ withSessionErrorListener: usable, withoutSessionErrorListener: usable }) + "\n",
          // node can print warnings that are not about this test.
          stderr: runtime === bunExe() ? "" : expect.any(String),
          exitCode: 0,
        });
      },
      // The child of a debug build needs seconds to load node:http2.
      isDebug ? 30_000 : undefined,
    );
  }
});

test("the listener is a one-time 'connect' listener of the session", async () => {
  const { server, port } = await listen();
  const clients: http2.ClientHttp2Session[] = [];
  try {
    const connect = (...args: unknown[]): http2.ClientHttp2Session => {
      const client = (http2.connect as Function)(`http://127.0.0.1:${port}`, ...args);
      clients.push(client);
      return client;
    };
    const connected = (client: http2.ClientHttp2Session) =>
      new Promise((resolve, reject) => {
        client.on("connect", resolve);
        client.on("error", reject);
        client.on("close", () => reject(new Error("the session closed before 'connect'")));
      });

    // It is registered on the session, runs in listener order with the event's (session, socket)
    // arguments, and is removed after the event.
    const calls: unknown[] = [];
    const listener = function (this: unknown, session: unknown, socket: unknown) {
      calls.push(["listener", this === client && session === client, socket instanceof net.Socket]);
    };
    const client = connect(listener);
    const registered = client.listeners("connect");
    client.prependListener("connect", () => calls.push("prepended"));
    client.on("connect", () => calls.push("on"));
    await connected(client);
    expect({ registered, calls, registeredAfter: client.listeners("connect").includes(listener) }).toEqual({
      registered: [listener],
      calls: ["prepended", ["listener", true, true], "on"],
      registeredAfter: false,
    });

    // It can be removed before the session connects.
    const removedListener = mock();
    const removed = connect(removedListener);
    removed.off("connect", removedListener);
    await connected(removed);
    expect(removedListener).not.toHaveBeenCalled();

    // A listener that is not a function is ignored.
    const ignored = connect({}, "not a function");
    await connected(ignored);
    expect(ignored.destroyed).toBe(false);
  } finally {
    for (const client of clients) client.destroy();
    server.close();
  }
});

test("the listener and 'connect' still fire for a session destroyed before its socket connected", async () => {
  const { server, port } = await listen();
  const socket = net.connect(port, "127.0.0.1");
  try {
    const calls: unknown[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket }, (session, sock) => {
      calls.push(["listener", session.destroyed, sock === socket]);
    });
    client.on("connect", (session, sock) => {
      calls.push(["connect", session.destroyed, sock === socket]);
      resolve();
    });
    client.on("error", reject);
    // destroy() ends the socket once it has connected. After it closed, 'connect' cannot fire.
    socket.on("close", () => reject(new Error("the socket closed before the session emitted 'connect'")));
    client.destroy();
    await promise;
    expect(calls).toEqual([
      ["listener", true, true],
      ["connect", true, true],
    ]);
  } finally {
    socket.destroy();
    server.close();
  }
});

test("over a connected socket the listener and 'connect' run on the first tick, like node", async () => {
  const { server, port } = await listen();
  const sockets: net.Socket[] = [];
  try {
    // Resolves with the first three calls.
    const firstCalls = async (
      afterConnect: (client: http2.ClientHttp2Session, record: (name: string) => void) => void,
    ) => {
      const socket = net.connect(port, "127.0.0.1");
      sockets.push(socket);
      await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
      const calls: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      const record = (name: string) => {
        if (calls.push(name) === 3) resolve(calls);
      };
      const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection: () => socket }, () =>
        record("listener"),
      );
      client.on("connect", () => record("connect"));
      client.on("close", () => record("close"));
      client.on("error", reject);
      // node emits the session 'close' from a socket 'close' listener that destroy() adds, so
      // that listener runs after this one. The failure waits for the rest of the dispatch.
      socket.on("close", () => setImmediate(() => reject(new Error(`the socket closed after only: ${calls}`))));
      afterConnect(client, record);
      return promise;
    };

    expect(await firstCalls((client, record) => process.nextTick(record, "tick"))).toEqual([
      "listener",
      "connect",
      "tick",
    ]);
    expect(await firstCalls(client => client.destroy())).toEqual(["listener", "connect", "close"]);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});
