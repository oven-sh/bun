import { describe, expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import tls from "tls";

// The net.Socket handed to tls.connect({ socket }) goes down with the TLS
// socket (node's TLSWrap close() destroys its parent wrap), so a STARTTLS
// caller keyed on the plain socket's 'close' sees it even when the upgrade
// fails. Releasing it from the TLS socket's 'end' only covered a graceful
// shutdown: a failed handshake destroys the TLS socket without emitting 'end'.
// Node's order of events, asserted below: the TLS socket's 'error' first, with
// the plain socket still intact (a caller can still read its remoteAddress
// there), then the plain socket's 'close', then the TLS socket's 'close'.
describe("destroying tls.connect({ socket }) destroys the wrapped net.Socket", () => {
  // Logs both sockets' lifecycle events in order. Resolves once the TLS socket
  // has closed, plus the plain socket's 'close' if one is still due (a plain
  // socket that was never destroyed, the bug, would never emit it, so that case
  // resolves right away and fails on the log). Plain listeners rather than
  // events.once(): the TLS socket emits 'error' before 'close' here.
  function observe(plain: net.Socket, secure: tls.TLSSocket) {
    const events: string[] = [];
    const { promise, resolve } = Promise.withResolvers<string[]>();
    plain.on("error", (err: Error & { code?: string }) => events.push(`plain error ${err.code}`));
    plain.on("close", hadError => events.push(`plain close hadError=${hadError}`));
    secure.on("error", (err: Error & { code?: string }) =>
      events.push(`secure error ${err.code} plain.destroyed=${plain.destroyed}`),
    );
    secure.on("close", hadError => {
      events.push(`secure close hadError=${hadError} plain.destroyed=${plain.destroyed}`);
      if (plain.destroyed && !events.some(event => event.startsWith("plain close"))) {
        plain.once("close", () => resolve(events));
      } else {
        resolve(events);
      }
    });
    return promise;
  }

  async function failedUpgrade(server: net.Server, waitForConnect: boolean, options: tls.ConnectionOptions) {
    const plain = net.connect({ host: "127.0.0.1", port: (server.address() as net.AddressInfo).port });
    if (waitForConnect) await once(plain, "connect");
    return observe(plain, tls.connect({ socket: plain, servername: "localhost", ...options }));
  }

  describe.each([
    ["an already connected socket", true],
    ["a socket that is still connecting", false],
  ])("handshake against a non-TLS peer over %s", (_, waitForConnect) => {
    test.concurrent("destroys the wrapped socket after the error", async () => {
      await using server = net.createServer(peer => {
        peer.on("error", () => {});
        peer.on("data", () => peer.write("this is not a TLS ServerHello\r\n"));
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      expect(await failedUpgrade(server, waitForConnect, {})).toEqual([
        "secure error ERR_SSL_WRONG_VERSION_NUMBER plain.destroyed=false",
        "plain close hadError=false",
        "secure close hadError=true plain.destroyed=true",
      ]);
    });
  });

  test.concurrent("certificate verification failure destroys the wrapped socket after the error", async () => {
    // The server's certificate is self-signed and the client is given no `ca`.
    await using server = tls.createServer(certs, socket => socket.on("error", () => {}));
    server.on("tlsClientError", () => {});
    await once(server.listen(0, "127.0.0.1"), "listening");
    expect(await failedUpgrade(server, true, { rejectUnauthorized: true })).toEqual([
      "secure error DEPTH_ZERO_SELF_SIGNED_CERT plain.destroyed=false",
      "plain close hadError=false",
      "secure close hadError=true plain.destroyed=true",
    ]);
  });

  test.concurrent("destroy() while the wrapped socket is still connecting destroys it too", async () => {
    // Nothing is listening on the port any more, so the connect would fail:
    // a wrapped socket left behind would surface that as an error of its own.
    const server = net.createServer();
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>(resolve => server.close(() => resolve()));

    const plain = net.connect({ host: "127.0.0.1", port });
    const secure = tls.connect({ socket: plain, servername: "localhost" });
    const events = observe(plain, secure);
    secure.destroy();
    // The plain socket still owns its (connecting) handle, so its 'close'
    // follows the handle close, a later phase than the handle-less TLS
    // socket's 'close': the set of events is the contract here, not the order.
    expect((await events).sort()).toEqual([
      "plain close hadError=false",
      "secure close hadError=false plain.destroyed=true",
    ]);
  });

  test.concurrent("destroy() right after wrapping a connected socket destroys it and the connection", async () => {
    // The socket was adopted synchronously, so the TLS socket owns the fd by
    // now: destroying it has to release the plain socket and close the
    // connection the peer is holding.
    const peerClosed = Promise.withResolvers<void>();
    await using server = net.createServer(peer => {
      peer.on("error", () => {});
      peer.on("close", () => peerClosed.resolve());
      peer.resume();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");

    const plain = net.connect({ host: "127.0.0.1", port: (server.address() as net.AddressInfo).port });
    await once(plain, "connect");
    const secure = tls.connect({ socket: plain, servername: "localhost" });
    const events = observe(plain, secure);
    secure.destroy();
    expect(await events).toEqual(["plain close hadError=false", "secure close hadError=false plain.destroyed=true"]);
    await peerClosed.promise;
  });

  test.concurrent("a graceful shutdown after the handshake destroys the wrapped socket", async () => {
    // No error involved: the TLS socket ends, the peer ends back and the TLS
    // socket's own destroy takes the plain socket down.
    await using server = tls.createServer(certs, socket => socket.on("error", () => {}));
    await once(server.listen(0, "127.0.0.1"), "listening");

    const plain = net.connect({ host: "127.0.0.1", port: (server.address() as net.AddressInfo).port });
    await once(plain, "connect");
    const secure = tls.connect({ socket: plain, servername: "localhost", ca: certs.cert });
    const events = observe(plain, secure);
    await once(secure, "secureConnect");
    secure.end();
    expect(await events).toEqual(["plain close hadError=false", "secure close hadError=false plain.destroyed=true"]);
  });
});

test("should be able to upgrade a paused socket and also have backpressure on it #15438", async () => {
  // enought to trigger backpressure
  const payload = Buffer.alloc(16 * 1024 * 4, "b").toString("utf8");

  const server = tls.createServer(certs, socket => {
    // echo
    socket.on("data", data => {
      socket.write(data);
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");

  const socket = net.connect({
    port: (server.address() as net.AddressInfo).port,
    host: "127.0.0.1",
  });
  await once(socket, "connect");

  // pause raw socket
  socket.pause();

  const tlsSocket = tls.connect({
    ca: certs.cert,
    servername: "localhost",
    socket,
  });
  await once(tlsSocket, "secureConnect");

  // do http request using tls socket
  async function doWrite(socket: net.Socket) {
    let downloadedBody = 0;
    const { promise, resolve, reject } = Promise.withResolvers();
    function onData(data: Buffer) {
      downloadedBody += data.byteLength;
      if (downloadedBody === payload.length * 2) {
        resolve();
      }
    }
    socket.pause();
    socket.write(payload);
    socket.write(payload, () => {
      socket.on("data", onData);
      socket.resume();
    });

    await promise;
    socket.off("data", onData);
  }
  for (let i = 0; i < 100; i++) {
    // upgrade the tlsSocket
    await doWrite(tlsSocket);
  }

  expect().pass();
});
