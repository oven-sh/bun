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
describe("destroying tls.connect({ socket }) destroys the wrapped net.Socket", () => {
  // events.once() rejects when 'error' is emitted first, which is the point of
  // these cases; resolves with the 'close' event's hadError argument.
  const closed = (socket: net.Socket) => new Promise<boolean>(resolve => socket.once("close", resolve));

  async function upgradeAndFail(server: net.Server, waitForConnect: boolean, options: tls.ConnectionOptions) {
    const plain = net.connect({ host: "127.0.0.1", port: (server.address() as net.AddressInfo).port });
    plain.on("error", () => {});
    if (waitForConnect) await once(plain, "connect");
    const plainClosed = closed(plain);

    const secure = tls.connect({ socket: plain, servername: "localhost", ...options });
    const secureClosed = closed(secure);
    const [err] = (await once(secure, "error")) as [Error & { code?: string }];
    expect(await secureClosed).toBe(true);
    // The TLS socket's _destroy destroys the wrapped socket synchronously, so it
    // is already destroyed once the TLS socket has closed, and it emits 'close'
    // itself, without an error of its own.
    expect(plain.destroyed).toBe(true);
    expect(await plainClosed).toBe(false);
    return err.code;
  }

  describe.each([
    ["an already connected socket", true],
    ["a socket that is still connecting", false],
  ])("handshake against a non-TLS peer over %s", (_, waitForConnect) => {
    test.concurrent("destroys the wrapped socket", async () => {
      await using server = net.createServer(peer => {
        peer.on("error", () => {});
        peer.on("data", () => peer.write("this is not a TLS ServerHello\r\n"));
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      expect(await upgradeAndFail(server, waitForConnect, {})).toBe("ERR_SSL_WRONG_VERSION_NUMBER");
    });
  });

  test.concurrent("certificate verification failure destroys the wrapped socket", async () => {
    // The server's certificate is self-signed and the client is given no `ca`.
    await using server = tls.createServer(certs, socket => socket.on("error", () => {}));
    server.on("tlsClientError", () => {});
    await once(server.listen(0, "127.0.0.1"), "listening");
    expect(await upgradeAndFail(server, true, { rejectUnauthorized: true })).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
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
