import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs } from "harness";
import net from "net";
import { finished } from "stream";
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

// Not events.once(): that rejects when the stream emits 'error' first.
function allClosed(...streams: net.Socket[]) {
  return Promise.all(streams.map(stream => new Promise<void>(resolve => stream.once("close", () => resolve()))));
}

// The wrapped socket gets no EOF from the fd either. An EOF ends it, its 'close' follows, and that
// 'close' destroys the TLS socket ahead of the TLS socket's own 'end'.
test.each([
  ["the TLS socket", ["finish", "end", "finished", "close:false"], ["close"]],
  ["the wrapped socket", ["end", "finish", "finished", "close:false"], ["finish", "close"]],
])(
  "new TLSSocket(socket, { isServer }) emits 'end' when %s is ended before the handshake has finished",
  async (ended, tlsEvents, wrappedEvents) => {
    const seen = { tls: [] as string[], wrapped: [] as string[] };
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const server = net.createServer(socket => {
      const tlsSocket = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(certs) });
      for (const event of ["end", "finish"]) {
        tlsSocket.on(event, () => seen.tls.push(event));
        socket.on(event, () => seen.wrapped.push(event));
      }
      tlsSocket.on("error", reject);
      socket.on("error", reject);
      finished(tlsSocket, err => seen.tls.push(err ? `finished:${err.code}` : "finished"));
      tlsSocket.on("close", hadError => seen.tls.push(`close:${hadError}`));
      socket.on("close", () => seen.wrapped.push("close"));
      resolve(allClosed(tlsSocket, socket));
      // After the tick that attaches the TLS handle, and before the ClientHello is read.
      process.nextTick(() => (ended === "the TLS socket" ? tlsSocket : socket).end());
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const client = tls.connect({
      port: (server.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
    });
    // The server's FIN lands in the middle of the handshake.
    client.on("error", () => {});
    try {
      await promise;
      expect(seen).toEqual({ tls: tlsEvents, wrapped: wrappedEvents });
    } finally {
      client.destroy();
      server.close();
    }
  },
);

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

// The three places that adopt the fd of a net.Socket.
const sites = [
  "new TLSSocket(socket, { isServer })",
  "tls.connect({ socket })",
  "tls.connect({ socket }) before 'connect'",
];

// One connection with a TLS wrap of a net.Socket at both ends, both handshakes done. The subject
// is the end that `site` names. Only the peer is half-open.
async function wrappedPair(site: string) {
  type End = { tlsSocket: tls.TLSSocket; wrapped: net.Socket; secure: Promise<unknown> };
  const serverIsSubject = site.startsWith("new");
  const accepted = Promise.withResolvers<End>();
  const server = net.createServer({ allowHalfOpen: !serverIsSubject }, wrapped => {
    const tlsSocket = new tls.TLSSocket(wrapped, { isServer: true, secureContext: tls.createSecureContext(certs) });
    accepted.resolve({ tlsSocket, wrapped, secure: once(tlsSocket, "secure") });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const wrapped = net.connect({
    port: (server.address() as net.AddressInfo).port,
    host: "127.0.0.1",
    allowHalfOpen: serverIsSubject,
  });
  if (!site.endsWith("'connect'")) await once(wrapped, "connect");
  const tlsSocket = tls.connect({ socket: wrapped, rejectUnauthorized: false });
  const client: End = { tlsSocket, wrapped, secure: once(tlsSocket, "secureConnect") };
  const ends = [await accepted.promise, client];
  const [subject, peer] = serverIsSubject ? ends : [ends[1], ends[0]];
  for (const stream of [peer.tlsSocket, peer.wrapped]) stream.on("error", () => {});
  const close = () => {
    for (const end of ends) {
      end.tlsSocket.destroy();
      end.wrapped.destroy();
    }
    server.close();
  };
  try {
    await Promise.all(ends.map(end => end.secure));
  } catch (err) {
    close();
    throw err;
  }
  return { subject, peer, close };
}

// One log for both sockets of the subject, so that the order between them is part of the result.
function logEvents({ tlsSocket, wrapped }: { tlsSocket: tls.TLSSocket; wrapped: net.Socket }) {
  const events: string[] = [];
  tlsSocket.on("error", (err: NodeJS.ErrnoException) => events.push(`tls error:${err.code}`));
  tlsSocket.on("end", () => events.push("tls end"));
  tlsSocket.on("close", hadError => events.push(`tls close:${hadError}`));
  for (const event of ["error", "end", "close"]) wrapped.on(event, () => events.push(`wrapped ${event}`));
  return events;
}

// Nor a read error: the TLS socket reports a reset, then the wrapped socket closes, and it only closes.
test.each(sites)("%s: a peer reset is an 'error' on the TLS socket alone", async site => {
  const { subject, peer, close } = await wrappedPair(site);
  try {
    const events = logEvents(subject);
    const closed = allClosed(subject.tlsSocket, subject.wrapped);
    // A round trip first, so that nothing is in flight when the reset comes.
    peer.tlsSocket.once("data", () => peer.tlsSocket.write("pong"));
    subject.tlsSocket.write("ping");
    await once(subject.tlsSocket, "data");
    peer.wrapped.resetAndDestroy();
    await closed;
    expect(events).toEqual(["tls error:ECONNRESET", "wrapped close", "tls close:true"]);
  } finally {
    close();
  }
});

// An EOF on the wrapped socket closes it, and that destroys the TLS socket with its unread data.
test.each(sites)("%s: plaintext that is unread when the fd closes reaches a late reader", async site => {
  const { subject, peer, close } = await wrappedPair(site);
  try {
    const events = logEvents(subject);
    const closed = allClosed(subject.tlsSocket, subject.wrapped);
    // The peer answers the subject's FIN with data and its own FIN. Then the fd closes.
    peer.tlsSocket.on("data", () => {});
    peer.tlsSocket.on("end", () => peer.tlsSocket.end("hello"));
    subject.tlsSocket.end("bye");
    const { _readableState: readableState } = subject.tlsSocket as unknown as { _readableState: { ended: boolean } };
    while (!readableState.ended && !subject.tlsSocket.destroyed) await nextTurn();
    // A wrapped socket that ends itself closes up to three loop turns later.
    for (let turn = 0; turn < 10; turn++) await nextTurn();
    let data = "";
    subject.tlsSocket.on("data", chunk => (data += chunk));
    await closed;
    expect({ data, events }).toEqual({ data: "hello", events: ["tls end", "wrapped close", "tls close:false"] });
  } finally {
    close();
  }
});

// tlsServer.emit("connection", socket) wraps the socket the same way.
test("a socket injected into a tls.Server: a reset during the handshake is a 'tlsClientError'", async () => {
  const tlsServer = tls.createServer(certs);
  const clientError = Promise.withResolvers<NodeJS.ErrnoException>();
  tlsServer.on("tlsClientError", clientError.resolve);
  tlsServer.on("secureConnection", () => clientError.reject(new Error("the handshake completed")));
  const injected = Promise.withResolvers<void>();
  const rawServer = net.createServer(socket => {
    socket.on("error", () => {});
    // The TLS socket that the server builds is not reachable from here, so a lost 'tlsClientError'
    // shows only as silence. The wrapped socket closes after it, a few loop turns bound the wait.
    socket.on("close", async () => {
      for (let turn = 0; turn < 10; turn++) await nextTurn();
      clientError.reject(new Error("the wrapped socket closed and no 'tlsClientError' came"));
    });
    tlsServer.emit("connection", socket);
    injected.resolve();
  });
  await once(rawServer.listen(0, "127.0.0.1"), "listening");
  const raw = net.connect({ port: (rawServer.address() as net.AddressInfo).port, host: "127.0.0.1" });
  // A no-op once the server has the connection, which is before the reset.
  raw.on("error", injected.reject);
  try {
    await injected.promise;
    raw.resetAndDestroy();
    expect((await clientError.promise).code).toBe("ECONNRESET");
  } finally {
    raw.destroy();
    rawServer.close();
    tlsServer.close();
  }
});

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
