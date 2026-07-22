import { describe, expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import tls from "tls";

// A net.Socket handed to tls.connect({ socket }) must be destroyed (and emit
// 'close') when the handshake fails. The 'end'-listener release path only
// covers a graceful close; _destroy must tear down the wrapped socket too.
describe.each([
  ["connecting", false],
  ["already connected", true],
])("tls.connect({ socket }) with a failing handshake destroys the wrapped net.Socket (%s)", (_, waitForConnect) => {
  test.concurrent("destroys the wrapped socket and fires its 'close'", async () => {
    await using server = net.createServer(c => {
      c.on("error", () => {});
      c.on("data", () => c.write("NOT TLS AT ALL\r\n"));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");

    const netSock = net.connect({ host: "127.0.0.1", port: (server.address() as net.AddressInfo).port });
    netSock.on("error", () => {});
    if (waitForConnect) await once(netSock, "connect");

    const netClose = once(netSock, "close");
    const tlsSock = tls.connect({ socket: netSock, servername: "localhost" });

    const [tlsErr] = await once(tlsSock, "error");
    expect((tlsErr as NodeJS.ErrnoException).code).toBe("ERR_SSL_WRONG_VERSION_NUMBER");

    const [hadError] = await netClose;
    expect({ destroyed: netSock.destroyed, hadError }).toEqual({ destroyed: true, hadError: false });
  });
});

// resetAndDestroy() on a tls.connect({ socket }) wrapper: the wrapped socket
// must still be destroyed. The wrapped-socket teardown in _destroy runs after
// this._handle's close so terminate() stays the first close on the shared
// us_socket_t (first-close-wins).
test("tls.connect({ socket }).resetAndDestroy() destroys the wrapped net.Socket", async () => {
  const { promise: peerDone, resolve: peerResolve } = Promise.withResolvers<void>();
  await using server = net.createServer(c => {
    c.on("error", () => {});
    c.on("close", () => peerResolve());
    c.resume();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  const netSock = net.connect({ host: "127.0.0.1", port: (server.address() as net.AddressInfo).port });
  netSock.on("error", () => {});
  await once(netSock, "connect");

  const netClose = once(netSock, "close");
  const tlsSock = tls.connect({ socket: netSock, servername: "localhost" });
  tlsSock.on("error", () => {});
  tlsSock.resetAndDestroy();

  await netClose;
  expect(netSock.destroyed).toBe(true);
  await peerDone;
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
