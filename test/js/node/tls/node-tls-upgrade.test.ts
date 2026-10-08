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
  // A socket that finished writing cannot be adopted, so the wrap fails on the
  // TLSSocket and the net.Socket stays in charge of its fd.
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

test("new tls.TLSSocket(socket, { isServer: true }) on a socket that already finished writing emits 'error'", async () => {
  // The native upgrade runs a tick after the wrap and throws for this socket.
  // The TLSSocket has to report that, not the process.
  const { promise: outcome, resolve, reject } = Promise.withResolvers<Error>();
  const server = net.createServer({ allowHalfOpen: true }, accepted => {
    accepted.on("error", () => {});
    accepted.end();
    const tlsSocket = new tls.TLSSocket(accepted, { isServer: true, secureContext: tls.createSecureContext(certs) });
    tlsSocket.once("error", resolve);
    tlsSocket.once("secure", () => reject(new Error("handshake completed on a finished socket")));
    tlsSocket.once("close", () => reject(new Error("TLSSocket closed without emitting 'error'")));
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = net.connect({
    port: (server.address() as net.AddressInfo).port,
    host: "127.0.0.1",
    allowHalfOpen: true,
  });
  client.on("error", () => {});

  try {
    expect((await outcome).message).toBe("Cannot upgrade to TLS: the socket is closed or has been shut down");
  } finally {
    client.destroy();
    server.close();
  }
});

// The refused wrap destroys the TLSSocket, so it reports 'close' once. An owner that gives the
// TLSSocket up in the same tick gets only what that owner did, with no error from the wrap behind it.
test.each([
  ["and nothing else", (_tlsSocket: tls.TLSSocket) => {}, ["error: Cannot upgrade to TLS: the socket is closed or has been shut down", "close"]],
  ["and destroy() in the same tick", (tlsSocket: tls.TLSSocket) => void tlsSocket.destroy(), ["close"]],
  ["and destroy(error) in the same tick", (tlsSocket: tls.TLSSocket) => void tlsSocket.destroy(new Error("mine")), ["error: mine", "close"]],
] as const)("tls.connect({ socket }) on a finished socket %s emits 'close' once", async (_name, giveUp, expected) => {
  const server = net.createServer({ allowHalfOpen: true }, peer => {
    peer.on("error", () => {});
    peer.on("end", () => peer.end());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");

  try {
    const raw = net.connect({
      port: (server.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      allowHalfOpen: true,
    });
    raw.on("error", () => {});
    await once(raw, "connect");
    raw.end();
    await once(raw, "finish");

    const events: string[] = [];
    const tlsSocket = tls.connect({ socket: raw, host: "127.0.0.1" });
    tlsSocket.on("error", error => events.push("error: " + error.message));
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    tlsSocket.on("close", () => {
      events.push("close");
      onClosed();
    });
    giveUp(tlsSocket);
    await closed;
    // What tls.connect() queued for the next tick has run by the next turn of the loop.
    await new Promise<void>(resolve => setImmediate(resolve));

    expect({ events, destroyed: tlsSocket.destroyed }).toEqual({ events: [...expected], destroyed: true });
    raw.destroy();
  } finally {
    server.close();
  }
});

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L723-L727
test.each([
  ["readable: false", () => ({ readable: false })],
  [
    "an onread buffer",
    (saw: string[]) => ({ onread: { buffer: Buffer.alloc(64), callback: (n: number) => saw.push(`onread ${n}`) } }),
  ],
  ["no reader", () => ({})],
])(
  "tls.connect({ socket }) over a net.Socket with %s keeps the TLS bytes off the wrapped socket",
  async (_, options) => {
    const server = tls.createServer(certs, socket => {
      socket.on("error", () => {});
      socket.write("banner");
      socket.on("data", data => socket.write("echo:" + data));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const saw: string[] = [];
      const raw = net.connect({
        port: (server.address() as net.AddressInfo).port,
        host: "127.0.0.1",
        ...options(saw),
      });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      raw.on("error", reject);
      await once(raw, "connect");
      const tlsSocket = tls.connect({ socket: raw, ca: certs.cert, servername: "localhost" });
      const closed = once(tlsSocket, "close");
      let got = "";
      tlsSocket.on("error", reject);
      tlsSocket.on("close", () => reject(new Error(`closed after ${JSON.stringify(got)}`)));
      tlsSocket.on("secureConnect", () => tlsSocket.write("hi"));
      tlsSocket.on("data", data => {
        got += data;
        if (got.endsWith("echo:hi")) resolve(got);
      });
      expect(await promise).toBe("bannerecho:hi");
      expect(saw).toEqual([]);
      expect(raw.readableLength).toBe(0);
      tlsSocket.destroy();
      await closed;
    } finally {
      server.close();
    }
  },
);

// Both peers keep their plaintext 'data' listener across the upgrade.
test("a STARTTLS exchange hands no TLS bytes to the 'data' listeners of the wrapped sockets (#32239)", async () => {
  const saw: string[] = [];
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const server = net.createServer(socket => {
    socket.on("error", reject);
    let wrapped = false;
    socket.on("data", data => {
      if (wrapped) return void saw.push(`server data ${data.length}`);
      wrapped = true;
      socket.write("GO", () => {
        const tlsSocket = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(certs) });
        tlsSocket.on("error", reject);
        tlsSocket.on("data", data => tlsSocket.write("echo:" + data));
      });
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const raw = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
    raw.on("error", reject);
    let tlsSocket: tls.TLSSocket | undefined;
    raw.on("data", data => {
      if (tlsSocket) return void saw.push(`client data ${data.length}`);
      tlsSocket = tls.connect({ socket: raw, ca: certs.cert, servername: "localhost" });
      tlsSocket.on("error", reject);
      tlsSocket.on("secureConnect", () => tlsSocket!.write("hi"));
      tlsSocket.on("data", data => resolve(String(data)));
    });
    raw.write("STARTTLS");
    expect(await promise).toBe("echo:hi");
    expect(saw).toEqual([]);
    const closed = once(tlsSocket!, "close");
    tlsSocket!.destroy();
    await closed;
  } finally {
    server.close();
  }
});
