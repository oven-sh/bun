import { expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tls as certs } from "harness";
import net from "net";
import path from "node:path";
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
    // The refusal has to close the TLSSocket through its stream, or 'close' arrives twice: once
    // from the error itself and once when that stream tears down. Node emits it once.
    let tlsClosed = 0;
    tlsSocket.on("close", () => tlsClosed++);
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
    // The second 'close' of the bug lands before the wrapped socket's own close, which is awaited
    // above, so the count is final here.
    expect({ received, tlsClosed }).toEqual({ received: "bye", tlsClosed: 1 });
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

test("a refused tls.connect({ socket }) emits 'close' once, like Node", async () => {
  // The refusal used to report the error and emit 'close' by hand, and the stream behind the
  // TLSSocket emitted a second one when it tore down.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dir, "node-tls-upgrade-refused-close-fixture.js")],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(JSON.parse(stdout)).toEqual({ silent: 1, replies: 1, ends: 1 });
}, 20_000);
