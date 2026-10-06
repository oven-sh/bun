import { expect, test } from "bun:test";
import { spawn } from "child_process";
import { once } from "events";
import { bunEnv, bunExe, tls as certs } from "harness";
import net from "net";
import { Duplex } from "stream";
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

function duplexOver(raw: net.Socket) {
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end(callback);
    },
  });
  raw.on("data", chunk => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  return duplex;
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L596
test.each([
  ["tls.connect({ socket: connected })", true, (socket: net.Socket, o: object) => tls.connect({ socket, ...o })],
  ["tls.connect({ socket: connecting })", false, (socket: net.Socket, o: object) => tls.connect({ socket, ...o })],
  [
    "tls.connect({ socket: Duplex })",
    true,
    (raw: net.Socket, o: object) => tls.connect({ socket: duplexOver(raw), ...o }),
  ],
  [
    "new tls.TLSSocket(socket)",
    true,
    (raw: net.Socket, o: object) => {
      const socket = new tls.TLSSocket(raw, o);
      // @ts-expect-error node starts the handshake of a constructor wrap here
      socket._start();
      return socket;
    },
  ],
] as const)("%s ignores onread and emits 'data' (#42419)", async (_name, waitForConnect, wrap) => {
  const server = tls.createServer(certs, socket => {
    socket.on("error", () => {});
    socket.end("hello");
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const raw = net.connect({ port: (server.address() as net.AddressInfo).port, host: "127.0.0.1" });
  try {
    if (waitForConnect) await once(raw, "connect");
    const log: string[] = [];
    const tlsSocket = wrap(raw, {
      rejectUnauthorized: false,
      onread: { buffer: Buffer.alloc(16), callback: (n: number) => log.push(`onread ${n}`) },
    });
    tlsSocket.on("data", data => log.push(`data ${data.length}`));
    await once(tlsSocket, "end");
    expect(log).toEqual(["data 5"]);
  } finally {
    raw.destroy();
    server.close();
  }
});

// server.close() leaves live connections open, and a failed assertion must not leave one behind.
function closeAll(server: net.Server, sockets: net.Socket[]) {
  for (const socket of sockets) socket.destroy();
  server.close();
}

// The wrap takes the fd over one tick after the constructor, the tick the wrapped socket's end() shuts it down in.
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

// The takeover lands between end() and the shutdown that end() deferred.
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

// A "ping" round trip over tls.connect({ socket }) with a peer that echoes.
function pingOverTLS(socket: Duplex) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const tlsSocket = tls.connect({ socket, rejectUnauthorized: false }, () => tlsSocket.write("ping"));
  tlsSocket.on("error", reject);
  tlsSocket.on("close", () => reject(new Error("closed before the echo arrived")));
  tlsSocket.on("data", chunk => resolve(chunk.toString()));
  return promise;
}

function wrapAndEcho(transport: Duplex) {
  const secure = new tls.TLSSocket(transport as net.Socket, { isServer: true, ...certs });
  secure.on("error", () => {});
  secure.on("data", chunk => secure.write(chunk));
  return secure;
}

test("new TLSSocket(accepted, { isServer: true }) hands over a ClientHello buffered in several chunks", async () => {
  // Protocol sniffing: read(1) and unshift() leave the ClientHello in the readable buffer as two chunks.
  const server = net.createServer(accepted => {
    accepted.once("readable", () => {
      accepted.unshift(accepted.read(1));
      wrapAndEcho(accepted);
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    expect(await pingOverTLS(socket)).toBe("ping");
  } finally {
    socket.destroy();
    server.close();
  }
});

test("new TLSSocket(accepted, { isServer: true }) hands an already buffered ClientHello over once", async () => {
  const surfaced = Promise.withResolvers<{ handedOver: number; emitted: number; buffered: number }>();
  const server = net.createServer(accepted => {
    accepted.once("readable", () => {
      const handedOver = accepted.readableLength;
      const secure = wrapAndEcho(accepted);
      let emitted = 0;
      accepted.on("data", chunk => (emitted += chunk.length));
      secure.once("data", () => surfaced.resolve({ handedOver, emitted, buffered: accepted.readableLength }));
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    expect(await pingOverTLS(socket)).toBe("ping");
    const { handedOver, ...rest } = await surfaced.promise;
    expect(handedOver).toBeGreaterThan(0);
    expect(rest).toEqual({ emitted: handedOver, buffered: 0 });
  } finally {
    socket.destroy();
    server.close();
  }
});

test("a Duplex that is paused with the ClientHello buffered when it is wrapped still handshakes", async () => {
  const pipeTo = (peer: () => Duplex) =>
    new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        peer().push(chunk);
        callback();
      },
    });
  const serverSide: Duplex = pipeTo(() => clientSide);
  const clientSide: Duplex = pipeTo(() => serverSide);
  const echoed = pingOverTLS(clientSide);
  await once(serverSide, "readable");
  serverSide.pause();
  const secure = wrapAndEcho(serverSide);
  try {
    expect(await echoed).toBe("ping");
  } finally {
    secure.destroy();
    clientSide.destroy();
  }
});

test("TLS over TLS: an outer socket that is paused with the inner ClientHello unshifted still handshakes", async () => {
  const server = tls.createServer(certs, outer => {
    outer.on("error", () => {});
    outer.once("data", chunk => {
      outer.pause();
      if (chunk.length > 8) outer.unshift(chunk.subarray(8));
      wrapAndEcho(outer);
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const outer = tls.connect({
    port: (server.address() as net.AddressInfo).port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
  });
  try {
    await once(outer, "secureConnect");
    outer.cork();
    outer.write("STARTTLS");
    const echoed = pingOverTLS(outer);
    outer.uncork();
    expect(await echoed).toBe("ping");
  } finally {
    outer.destroy();
    server.close();
  }
});

// Node has one handle under both sockets, so the last call on either decides.
test.each(["socket.unref();", "socket.ref(); tlsSocket.unref();"])(
  "after the upgrade, %s lets the process exit",
  async calls => {
    const server = net.createServer(accepted => wrapAndEcho(accepted));
    await once(server.listen(0, "127.0.0.1"), "listening");
    const script = `
      const net = require("net"), tls = require("tls");
      // A process that cannot exit must not outlive the test.
      setTimeout(() => process.exit(3), 10_000).unref();
      const socket = net.connect(${(server.address() as net.AddressInfo).port}, "127.0.0.1", () => {
        const tlsSocket = tls.connect({ socket, rejectUnauthorized: false }, () => {
          tlsSocket.resume();
          ${calls}
        });
      });`;
    const child = spawn(bunExe(), ["-e", script], { env: bunEnv, stdio: ["ignore", "inherit", "inherit"] });
    try {
      expect(await once(child, "exit")).toEqual([0, null]);
    } finally {
      child.kill();
      server.close();
    }
  },
);

test("_parent is the wrapped net.Socket", async () => {
  const server = net.createServer(socket => socket.on("error", () => {}));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const sockets: net.Socket[] = [];
  const parentOf = (wrap: (raw: net.Socket) => tls.TLSSocket) => {
    const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    const tlsSocket = wrap(raw).on("error", () => {});
    sockets.push(raw, tlsSocket);
    // @ts-expect-error not in @types/node
    return tlsSocket._parent === raw;
  };
  try {
    expect({
      "tls.connect({ socket })": parentOf(socket => tls.connect({ socket })),
      "new TLSSocket(socket)": parentOf(socket => new tls.TLSSocket(socket)),
      "new TLSSocket(socket, { isServer })": parentOf(
        socket => new tls.TLSSocket(socket, { isServer: true, ...certs }),
      ),
    }).toEqual({
      "tls.connect({ socket })": true,
      "new TLSSocket(socket)": true,
      "new TLSSocket(socket, { isServer })": true,
    });
  } finally {
    closeAll(server, sockets);
  }
});
