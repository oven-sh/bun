import { expect, test } from "bun:test";
import { once } from "events";
import { tls as certs, isWindows, tempDir } from "harness";
import net from "net";
import { join } from "path";
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

// server.close() leaves live connections open, and a failed assertion must not leave one behind.
function closeAll(server: net.Server, sockets: net.Socket[]) {
  for (const socket of sockets) socket.destroy();
  server.close();
}

// The wrap takes the fd of the wrapped socket over one tick after the constructor, the same tick
// the wrapped socket's end() shuts the fd down in. Node v26.3.0 reports the same client events.
test.each<[string, (raw: net.Socket, tlsSocket: tls.TLSSocket) => void]>([
  ["end()", raw => raw.end()],
  ["destroySoon()", raw => raw.destroySoon()],
  [
    "end() before the TLSSocket's end()",
    (raw, tlsSocket) => {
      raw.end();
      tlsSocket.end();
    },
  ],
])(
  "the wrapped socket's %s in the tick of new tls.TLSSocket(socket, { isServer: true }) sends the FIN",
  async (_, endWrapped) => {
    const sockets: net.Socket[] = [];
    const server = net.createServer(raw => {
      raw.on("error", () => {});
      const tlsSocket = new tls.TLSSocket(raw, { isServer: true, ...certs });
      tlsSocket.on("error", () => {});
      sockets.push(raw, tlsSocket);
      endWrapped(raw, tlsSocket);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const client = tls.connect({
        port: (server.address() as net.AddressInfo).port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
      });
      sockets.push(client);
      const events: string[] = [];
      const { promise, resolve } = Promise.withResolvers<string[]>();
      // Reached only when the FIN never arrives: the handshake completes and the connection stays open.
      client.on("secureConnect", () => {
        events.push("secureConnect");
        client.destroy();
      });
      client.on("end", () => events.push("end"));
      client.on("error", err => events.push(`error ${(err as NodeJS.ErrnoException).code}`));
      client.on("close", () => resolve(events));
      expect(await promise).toEqual(["end", "error ECONNRESET"]);
    } finally {
      closeAll(server, sockets);
    }
  },
);

// tls.connect({ socket }) takes the fd over at once, or in the 'connect' listener it adds after the
// one end() added. Either way the takeover lands between end() and the shutdown that end() deferred.
test.each(["connected", "connecting"])(
  "end() on a %s socket before tls.connect({ socket }) in the same tick sends the FIN",
  async state => {
    const sockets: net.Socket[] = [];
    const { promise, resolve } = Promise.withResolvers<string>();
    // Reached only when the FIN never arrives.
    const server = tls.createServer(certs, () => resolve("secureConnection"));
    server.on("connection", socket => {
      socket.on("error", () => {});
      sockets.push(socket);
    });
    server.on("tlsClientError", err => resolve(`tlsClientError ${(err as NodeJS.ErrnoException).code}`));
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const raw = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
      raw.on("error", () => {});
      sockets.push(raw);
      if (state === "connected") await once(raw, "connect");
      raw.end();
      const tlsSocket = tls.connect({ socket: raw, rejectUnauthorized: false });
      tlsSocket.on("error", () => {});
      sockets.push(tlsSocket);
      expect(await promise).toBe("tlsClientError ECONNRESET");
    } finally {
      closeAll(server, sockets);
    }
  },
);

// Only a TLS wrap moves the deferred shutdown to the handle that replaced the one end() saw.
// connect(path) also installs a new handle at once, for a connection that end() did not close.
test.skipIf(isWindows)(
  "end(), destroy() and connect(path) in one tick do not half-close the new connection",
  async () => {
    using dir = tempDir("net-reconnect", {});
    const path = join(String(dir), "s.sock");
    const sockets: net.Socket[] = [];
    const { promise, resolve } = Promise.withResolvers<string>();
    let connections = 0;
    const server = net.createServer({ allowHalfOpen: true }, socket => {
      const id = ++connections;
      sockets.push(socket);
      socket.on("error", () => {});
      socket.on("end", () => {
        if (id === 2) resolve("the new connection received a FIN");
      });
      socket.resume();
    });
    await once(server.listen(path), "listening");
    try {
      const client = net.connect(path);
      client.on("error", () => {});
      sockets.push(client);
      await once(client, "connect");
      client.end();
      client.destroy();
      client.connect(path, () => resolve("connect"));
      expect(await promise).toBe("connect");
    } finally {
      closeAll(server, sockets);
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
