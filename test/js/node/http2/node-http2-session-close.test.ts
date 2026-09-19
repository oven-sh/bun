// What a node:http2 session still accepts after close(), and while it is still connecting.
// node refuses pushStream() and ping() on a closed session, and cancels a ping() issued before
// the session is ready (for https, that is until the TLS handshake completes).
import { expect, it } from "bun:test";
import http2 from "node:http2";
import tls from "node:tls";
import { TLS_CERT, TLS_OPTIONS } from "./http2-helpers";

it("http2 pushStream() and ping() are refused after session.close(), like node", async () => {
  const out = {};
  const serverDone = Promise.withResolvers();
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.on("error", () => {});
    const session = stream.session;
    out.pushAllowedBefore = stream.pushAllowed;
    session.close();
    out.sessionClosed = session.closed;
    out.sessionDestroyed = session.destroyed;
    out.pushAllowedAfter = stream.pushAllowed;
    try {
      stream.pushStream({ ":path": "/pushed" }, (err, pushed) => {
        out.pushCallback = err ? err.code : "pushed";
        if (pushed) {
          pushed.on("error", () => {});
          pushed.respond({ ":status": 200 });
          pushed.end();
        }
      });
      out.pushStream = "no throw";
    } catch (e) {
      out.pushStream = e.code;
    }
    // node checks pushAllowed before it validates the callback.
    try {
      stream.pushStream({ ":path": "/pushed" });
      out.pushStreamNoCallback = "no throw";
    } catch (e) {
      out.pushStreamNoCallback = e.code;
    }
    out.pingReturn = session.ping((err, duration) => {
      out.pingCallback = err ? err.code : "ok";
      out.pingDuration = duration;
      serverDone.resolve();
    });
    out.pingCallbackRanSync = "pingCallback" in out;
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  try {
    client.on("error", () => {});
    const clientClosed = new Promise(resolve => client.once("close", resolve));
    client.on("stream", (pushed, headers) => {
      out.clientGotPush = headers[":path"];
      pushed.on("error", () => {});
      pushed.resume();
    });
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.resume();
    await new Promise(resolve => req.once("close", resolve));
    await serverDone.promise;
    await clientClosed;
  } finally {
    client.destroy();
    server.close();
  }

  expect(out).toEqual({
    pushAllowedBefore: true,
    sessionClosed: true,
    sessionDestroyed: false,
    pushAllowedAfter: false,
    pushStream: "ERR_HTTP2_PUSH_DISABLED",
    pushStreamNoCallback: "ERR_HTTP2_PUSH_DISABLED",
    pingReturn: undefined,
    pingCallbackRanSync: false,
    pingCallback: "ERR_HTTP2_PING_CANCEL",
    pingDuration: undefined,
  });
});

it("http2 client ping() after session.close() is cancelled on the next tick, like node", async () => {
  const server = http2.createServer();
  const serverStream = Promise.withResolvers();
  server.on("stream", stream => {
    stream.on("error", () => {});
    serverStream.resolve(stream);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  try {
    client.on("error", () => {});
    const clientClosed = new Promise(resolve => client.once("close", resolve));
    await new Promise(resolve => client.once("connect", resolve));
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.resume();
    const stream = await serverStream.promise;

    // The open request keeps the session alive, so close() marks it closed without destroying it.
    client.close();
    expect(client.closed).toBe(true);
    expect(client.destroyed).toBe(false);

    const pingResult = Promise.withResolvers();
    let pingCallbackRan = false;
    const pingReturn = client.ping((err, duration) => {
      pingCallbackRan = true;
      pingResult.resolve({ code: err?.code, duration });
    });
    expect(pingReturn).toBeUndefined();
    // The callback runs on the next tick, never synchronously.
    expect(pingCallbackRan).toBe(false);
    expect(await pingResult.promise).toEqual({ code: "ERR_HTTP2_PING_CANCEL", duration: undefined });

    stream.respond({ ":status": 200 });
    stream.end("ok");
    await clientClosed;
  } finally {
    client.destroy();
    server.close();
  }
});

it("http2 client ping() during the TLS handshake is cancelled, like node", async () => {
  const server = http2.createSecureServer({ cert: TLS_CERT.cert, key: TLS_CERT.key });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const socket = tls.connect({ host: "127.0.0.1", port, ALPNProtocols: ["h2"], ...TLS_OPTIONS });
  const client = http2.connect(`https://127.0.0.1:${port}`, { createConnection: () => socket });
  try {
    client.on("error", () => {});
    const connected = new Promise(resolve => client.once("connect", resolve));
    // Wait for the TCP connect. The TLS handshake is still in flight.
    await new Promise(resolve => socket.once("connect", resolve));
    expect(socket.connecting).toBe(false);
    expect(socket.secureConnecting).toBe(true);
    expect(client.connecting).toBe(true);
    expect(client.connected).toBe(false);

    const handshakePing = Promise.withResolvers();
    const handshakeReturn = client.ping(err => handshakePing.resolve(err?.code));
    expect(handshakeReturn).toBeUndefined();
    expect(await handshakePing.promise).toBe("ERR_HTTP2_PING_CANCEL");

    await connected;
    expect(client.connecting).toBe(false);
    expect(client.connected).toBe(true);
    const connectedPing = Promise.withResolvers();
    const connectedReturn = client.ping((err, duration) => connectedPing.resolve(err ? err.code : typeof duration));
    expect(connectedReturn).toBe(true);
    expect(await connectedPing.promise).toBe("number");
  } finally {
    client.destroy();
    server.close();
  }
});
