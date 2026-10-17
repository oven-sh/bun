import { describe, expect, it } from "bun:test";
import { bunEnv, nodeExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import http2 from "node:http2";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { duplexPair } from "node:stream";
import { countTimerRefreshes } from "./http2-session-timer-refresh.fixture.js";

describe.concurrent("http2 session idle timer", () => {
  // A session keeps the timer of setTimeout() under this symbol, like net.Socket does.
  const kTimeout = Symbol.for("::buntimeout::");
  const period = 50;
  // For a timer that must not expire by itself.
  const never = 2 ** 30;

  // Counts the runs of the expiry handler of the idle timer of `session`.
  function watchIdleTimer(session: http2.Http2Session) {
    const timer = session[kTimeout];
    const counts = { expiries: 0 };
    const { _onTimeout } = timer;
    timer._onTimeout = function (...args) {
      counts.expiries++;
      return _onTimeout.apply(this, args);
    };
    return counts;
  }

  // Rejects a promise that waits for the 'timeout' event of `session` when the session fails or closes first.
  function rejectOnFailure(session: http2.Http2Session, reject: (reason: Error) => void) {
    session.on("error", reject);
    session.on("close", () => reject(new Error("the session closed before its 'timeout' event")));
  }

  // Arms the idle timer of `session`. Resolves with the count of expiries at its 'timeout' event.
  function expiriesAtTimeout(session: http2.Http2Session) {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    session.setTimeout(period, () => resolve(counts.expiries));
    const counts = watchIdleTimer(session);
    rejectOnFailure(session, reject);
    return promise;
  }

  // The transports of a session: a native TCP socket, a native TLS socket, a JS stream.
  type Transport = "tcp" | "tls" | "duplexPair";
  const transports: Transport[] = ["tcp", "tls", "duplexPair"];
  const createServer = (transport: Transport): http2.Http2Server =>
    transport === "tls" ? http2.createSecureServer(tlsCert) : http2.createServer();

  // Resolves with a function that starts a client session to `server`.
  async function dialer(server: net.Server, transport: Transport = "tcp") {
    if (transport === "duplexPair") {
      return () => {
        const [clientSide, serverSide] = duplexPair();
        server.emit("connection", serverSide);
        return http2.connect("http://localhost", { createConnection: () => clientSide });
      };
    }
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return transport === "tls"
      ? () => http2.connect(`https://127.0.0.1:${port}`, { ca: tlsCert.cert })
      : () => http2.connect(`http://127.0.0.1:${port}`);
  }

  // Resolves with a client session that has connected to `server`.
  async function connectTo(server: net.Server, transport?: Transport) {
    const client = (await dialer(server, transport))();
    client.on("error", () => {});
    await once(client, "connect");
    return client;
  }

  for (const scheme of ["https", "http"]) {
    it(`emits 'timeout' at the first expiry when the peer never answers (${scheme})`, async () => {
      // The peer accepts the TCP connection. It reads nothing and writes nothing.
      const sockets: net.Socket[] = [];
      const peer = net.createServer(socket => {
        sockets.push(socket);
        socket.on("error", () => {});
      });
      await new Promise<void>(resolve => peer.listen(0, "127.0.0.1", resolve));
      const { port } = peer.address() as AddressInfo;
      const client = http2.connect(`${scheme}://127.0.0.1:${port}`, { rejectUnauthorized: false });
      try {
        expect(await expiriesAtTimeout(client)).toBe(1);
      } finally {
        client.destroy();
        for (const socket of sockets) socket.destroy();
        peer.close();
      }
    });
  }

  for (const transport of transports) {
    it(`emits 'timeout' at the first expiry of an idle client session (${transport})`, async () => {
      const server = createServer(transport);
      const client = await connectTo(server, transport);
      try {
        expect(await expiriesAtTimeout(client)).toBe(1);
      } finally {
        client.destroy();
        server.close();
      }
    });

    it(`emits 'timeout' at the first expiry of an idle server session (${transport})`, async () => {
      const server = createServer(transport);
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      let counts: { expiries: number };
      server.on("session", session => {
        counts = watchIdleTimer(session);
        rejectOnFailure(session, reject);
      });
      server.setTimeout(period, () => resolve(counts.expiries));
      const client = await connectTo(server, transport);
      try {
        expect(await promise).toBe(1);
      } finally {
        client.destroy();
        server.close();
      }
    });
  }

  it("destroys an idle server session at the first expiry when the server has no 'timeout' listener", async () => {
    const server = http2.createServer();
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    server.setTimeout(period);
    server.on("session", session => {
      const counts = watchIdleTimer(session);
      session.on("error", reject);
      session.on("close", () => resolve(counts.expiries));
    });
    const client = await connectTo(server);
    try {
      expect(await promise).toBe(1);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("holds an expiry back only while a stream write is in flight and frames leave", async () => {
    const server = http2.createServer();
    const { promise: written, resolve: onWritten } = Promise.withResolvers<http2.Http2Session>();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      const session = stream.session!;
      stream.on("error", () => {});
      session.setTimeout(never);
      stream.respond({ ":status": 200 });
      // The client reads nothing at first, so flow control stops this write after one window.
      stream.write(Buffer.alloc(1024 * 1024, "a"));
      onWritten(session);
    });
    const client = await connectTo(server);
    try {
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      const session = await written;
      let timeouts = 0;
      session.on("timeout", () => timeouts++);
      // Runs the expiry handler of the timer. The test then does not depend on the transfer speed.
      const expire = () => {
        session[kTimeout]._onTimeout(session);
        return timeouts;
      };

      // Frames left since the write went out.
      expect(expire()).toBe(0);
      // No frame left since the last expiry.
      expect(expire()).toBe(1);

      // More than one window of data at the client means that frames left after that expiry.
      const window = client.localSettings.initialWindowSize!;
      for (let received = 0; received <= window;) {
        const chunk = req.read();
        if (chunk === null) await once(req, "readable");
        else received += chunk.length;
      }
      expect(expire()).toBe(1);
    } finally {
      client.destroy();
      server.close();
    }
  });

  // http2-session-timer-refresh.fixture.js takes the same steps in Node.js and in Bun. For each
  // step it counts the refresh() calls on the idle timer of the client session and of the server
  // session. These are the counts of Node.js v18.20.8 to v26.10.0 on a TCP or TLS socket.
  const refreshesInNode = {
    "connect": { client: 1, server: 0 },
    "request()": { client: 1, server: 1 },
    "write() on the client": { client: 2, server: 1 },
    "additionalHeaders()": { client: 1, server: 1 },
    "origin() and additionalHeaders()": { client: 2, server: 1 },
    "altsvc() and additionalHeaders(), no 'altsvc' listener": { client: 1, server: 1 },
    "altsvc(), 'altsvc' listener": { client: 1, server: 0 },
    "pushStream() and respond() on the pushed stream": { client: 2, server: 2 },
    "respond()": { client: 1, server: 1 },
    "write() on the server": { client: 1, server: 2 },
    "end() and sendTrailers()": { client: 1, server: 1 },
    "end() on the client": { client: 0, server: 1 },
    "end() with data, request not read": { client: 4, server: 4 },
    "end() with data, request read to its end": { client: 6, server: 5 },
    "resume(), respond() and end() with data in the 'stream' event": { client: 4, server: 3 },
    "end() with data, request ended by an empty DATA frame and not read": { client: 4, server: 4 },
    "end() with data on the client, response ended by an empty DATA frame and not read": { client: 4, server: 4 },
    "respondWithFD()": { client: 4, server: 2 },
    "respondWithFile()": { client: 4, server: 2 },
    "respondWithFD(), statCheck responds and returns false": { client: 2, server: 3 },
    "respondWithFile() of a missing file, onError responds": { client: 2, server: 3 },
    "close() with a code, on a stream with a write that waits for window": { client: 4, server: 3 },
    "settings() on the server, no 'remoteSettings' listener": { client: 0, server: 1 },
    "settings() on the server, 'remoteSettings' listener": { client: 1, server: 1 },
    "ping() on the server, no 'ping' listener": { client: 0, server: 0 },
    "ping() on the server, 'ping' listener": { client: 1, server: 0 },
    "settings() on the client, no 'remoteSettings' listener": { client: 1, server: 0 },
    "settings() on the client, 'remoteSettings' listener": { client: 1, server: 1 },
    "ping() on the client, no 'ping' listener": { client: 0, server: 0 },
    "ping() on the client, 'ping' listener": { client: 0, server: 1 },
    "close()": { client: 1, server: 1 },
  };

  for (const transport of transports) {
    // The fixture takes 31 steps on the one JS thread. Each run has the thread to itself, so
    // that it stays far from the default time limit in a debug build.
    it.serial(`refreshes the timers as often as node for each call and frame (${transport})`, async () => {
      const server = createServer(transport);
      try {
        const counts = await countTimerRefreshes(server, await dialer(server, transport));
        // node sets up a session on a stream that has connected already inside connect(). The
        // client has no timer at that time, so node counts no refresh for the connect.
        const connect = transport === "duplexPair" ? { client: 0, server: 0 } : refreshesInNode.connect;
        expect(counts).toEqual({ ...refreshesInNode, connect });
      } finally {
        server.close();
      }
    });
  }

  const node = nodeExe();
  it.skipIf(!node)("node gives the refresh counts that the tests above expect", async () => {
    const fixture = path.join(import.meta.dir, "http2-session-timer-refresh.fixture.js");
    await using proc = Bun.spawn({ cmd: [node!, fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(refreshesInNode);
    expect(exitCode).toBe(0);
  });

  it("does not emit 'timeout' for the timer of its socket", async () => {
    const server = http2.createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    socket.setTimeout(period);
    const client = http2.connect("http://127.0.0.1", { createConnection: () => socket });
    client.on("error", () => {});
    try {
      let timeouts = 0;
      client.on("timeout", () => timeouts++);
      await once(socket, "timeout");
      expect(timeouts).toBe(0);
    } finally {
      client.destroy();
      server.close();
    }
  });

  it("arms a timer that has fired again on a request without a body", async () => {
    const server = http2.createServer();
    server.on("stream", (stream: http2.ServerHttp2Stream) => {
      stream.respond({ ":status": 204 }, { endStream: true });
    });
    const client = await connectTo(server);
    try {
      client.setTimeout(period);
      await once(client, "timeout");

      const { promise, resolve } = Promise.withResolvers<string>();
      client.once("timeout", () => resolve("timeout"));
      const req = client.request({ ":path": "/" });
      req.resume();
      await once(req, "close");
      // The response was the last activity. The idle timer, if the request armed it, is due
      // before this timer, which starts later and runs longer.
      const reference = setTimeout(resolve, period * 4, "the request did not arm the idle timer");
      try {
        expect(await promise).toBe("timeout");
      } finally {
        clearTimeout(reference);
      }
    } finally {
      client.destroy();
      server.close();
    }
  });
});
