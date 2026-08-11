import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import tls from "tls";

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

test("tls.connect({ socket }) on a socket that already finished writing emits 'error'", async () => {
  // Same underlying bug as upgradeTLS() on a shut-down Bun socket: the native
  // adopt used to leave the fd registered as a plain TCP socket while the TLS
  // wrapper was stored as its owner, so the TLSSocket never got an 'error' and
  // simply went 'close' once the peer hung up.
  const peerSawFin = Promise.withResolvers<net.Socket>();
  // allowHalfOpen: the peer must not answer our FIN on its own, or its reply
  // could close the socket under test before tls.connect() gets to it.
  const server = net.createServer({ allowHalfOpen: true }, peer => {
    peer.on("error", () => {});
    peer.on("end", () => peerSawFin.resolve(peer));
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  try {
    const socket = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
    await once(socket, "connect");
    let received = "";
    socket.on("data", chunk => (received += chunk));
    const socketClosed = once(socket, "close");

    socket.end();
    await once(socket, "finish");

    const tlsSocket = tls.connect({ socket, rejectUnauthorized: false });
    const outcome = new Promise<Error>((resolve, reject) => {
      tlsSocket.once("error", resolve);
      tlsSocket.once("secureConnect", () => reject(new Error("handshake completed on a finished socket")));
      tlsSocket.once("close", () => reject(new Error("TLSSocket closed without emitting 'error'")));
    });
    // The upgrade has been attempted; now the peer may reply. The refused
    // upgrade must have left the original net.Socket in charge of the fd.
    const peerReplied = peerSawFin.promise.then(peer => peer.end("bye"));

    expect((await outcome).message).toBe("Cannot upgrade to TLS: the socket is closed or has been shut down");
    await peerReplied;
    await socketClosed;
    expect(received).toBe("bye");
  } finally {
    server.close();
  }
});
