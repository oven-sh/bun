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

// node's handle counts a read before TLSWrap consumes it: https://github.com/nodejs/node/blob/v26.3.0/src/stream_base-inl.h#L75-L80
test.each([
  ["no reader", {}],
  ["readable: false", { readable: false }],
  ["an onread buffer", { onread: { buffer: Buffer.alloc(64), callback() {} } }],
])(
  "a net.Socket with %s that tls.connect({ socket }) wraps counts the TLS records in bytesRead",
  async (_, options) => {
    const server = tls.createServer(certs, socket => {
      socket.on("error", () => {});
      socket.end("banner");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const raw = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1", ...options });
      await once(raw, "connect");
      const tlsSocket = tls.connect({ socket: raw, ca: certs.cert, servername: "localhost" });
      let got = "";
      tlsSocket.on("data", data => (got += data));
      await once(tlsSocket, "close");
      expect(got).toBe("banner");
      // The TLS socket counts plaintext. The wrapped socket counts the handshake and the records.
      expect(tlsSocket.bytesRead).toBe(6);
      expect(raw.bytesRead).toBeGreaterThan(tlsSocket.bytesRead);
    } finally {
      server.close();
    }
  },
);

// Values observed under node v26.3.0: the upgrade keeps the handle, so the count goes on.
test("bytesRead of the wrapped sockets keeps the bytes read before a STARTTLS upgrade", async () => {
  const serverSide = Promise.withResolvers<{ before: number; after: number; raw: number; tls: number }>();
  const server = net.createServer(socket => {
    socket.on("error", serverSide.reject);
    socket.once("data", () => {
      socket.write("GO", () => {
        const before = socket.bytesRead;
        const tlsSocket = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(certs) });
        const after = socket.bytesRead;
        tlsSocket.on("error", serverSide.reject);
        tlsSocket.on("data", data => tlsSocket.end("echo:" + data));
        tlsSocket.on("close", () =>
          serverSide.resolve({ before, after, raw: socket.bytesRead, tls: tlsSocket.bytesRead }),
        );
      });
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const raw = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
    raw.write("STARTTLS");
    expect(String((await once(raw, "data"))[0])).toBe("GO");
    const before = raw.bytesRead;
    const tlsSocket = tls.connect({ socket: raw, ca: certs.cert, servername: "localhost" });
    const after = raw.bytesRead;
    tlsSocket.on("secureConnect", () => tlsSocket.write("hi"));
    let got = "";
    tlsSocket.on("data", data => (got += data));
    await once(tlsSocket, "close");
    expect(got).toBe("echo:hi");
    expect({ before, after, tls: tlsSocket.bytesRead }).toEqual({ before: 2, after: 2, tls: 7 });
    expect(raw.bytesRead).toBeGreaterThan(before + tlsSocket.bytesRead);

    const peer = await serverSide.promise;
    expect({ before: peer.before, after: peer.after, tls: peer.tls }).toEqual({ before: 8, after: 8, tls: 2 });
    expect(peer.raw).toBeGreaterThan(peer.before + peer.tls);
  } finally {
    server.close();
  }
});
