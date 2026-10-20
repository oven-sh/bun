import { describe, expect, test } from "bun:test";
import { spawn } from "child_process";
import { once } from "events";
import { bunEnv, bunExe, tls as certs, isWindows } from "harness";
import http2 from "http2";
import https from "https";
import net from "net";
import { join } from "path";
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
    outer.once("data", (chunk: Buffer) => {
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

// Whether a process here can reserve one buffer of 2^31 bytes. The probe is a process of its own: a failed
// allocation ends an ASAN build.
const canReserve2GiB = await (async () => {
  await using probe = Bun.spawn({
    cmd: [bunExe(), "-e", "Buffer.alloc(2 ** 31)"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await probe.exited) === 0;
})();

// Node's JSStreamSocket has no 'drain' listener on the stream it wraps:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/js_stream_socket.js#L64-L92
describe("a TLS socket does not listen for 'drain' on the stream it wraps", () => {
  const serverOptions = { isServer: true, ...certs };
  const clientWraps = {
    "tls.connect({ socket })": (socket: Duplex) => tls.connect({ socket, rejectUnauthorized: false }),
    "new TLSSocket(socket)": (socket: Duplex) => new tls.TLSSocket(socket as net.Socket, { rejectUnauthorized: false }),
  };
  // An in-memory pair. `inWrite` runs inside that side's write(), once the peer has the chunk.
  function pairOf(inWrite: { client?: () => void; server?: () => void } = {}) {
    const side = (peer: () => Duplex, hook = () => {}) =>
      new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          peer().push(chunk);
          hook();
          callback();
        },
        final(callback) {
          peer().push(null);
          callback();
        },
      });
    const clientSide: Duplex = side(() => serverSide, inWrite.client);
    const serverSide: Duplex = side(() => clientSide, inWrite.server);
    return { clientSide, serverSide };
  }
  const closeOf = (socket: tls.TLSSocket) => new Promise<void>(resolve => socket.on("close", () => resolve()));
  // `client` writes "parked" before its handshake and ends. Resolves once it closed, with what the server got.
  async function parkedWrite(client: tls.TLSSocket, serverSide: Duplex) {
    const received: Buffer[] = [];
    const errors: unknown[] = [];
    let callbacks = 0;
    const server = new tls.TLSSocket(serverSide as net.Socket, serverOptions);
    server.on("data", (chunk: Buffer) => received.push(chunk));
    server.on("end", () => server.end());
    server.on("error", (err: NodeJS.ErrnoException) => errors.push(err.code));
    client.on("data", () => {});
    client.on("error", (err: NodeJS.ErrnoException) => errors.push(err.code));
    const closed = closeOf(client);
    client.write("parked", () => callbacks++);
    client.end();
    await closed;
    return { received: Buffer.concat(received).toString(), errors, callbacks, bytesWritten: client.bytesWritten };
  }

  describe("a stream that emits 'drain' inside its own write()", () => {
    test.each(Object.keys(clientWraps) as (keyof typeof clientWraps)[])(
      "%s sends a write made before the handshake once",
      async wrap => {
        const { clientSide, serverSide } = pairOf({ client: () => void clientSide.emit("drain") });
        const client = clientWraps[wrap](clientSide);
        const drainListeners = [clientSide.listenerCount("drain")];
        const result = await parkedWrite(client, serverSide);
        drainListeners.push(clientSide.listenerCount("drain"));
        expect({ ...result, drainListeners }).toEqual({
          received: "parked",
          errors: [],
          callbacks: 1,
          bytesWritten: 6,
          drainListeners: [0, 0],
        });
      },
    );

    test("new TLSSocket(socket, { isServer: true }) sends a write made before the handshake once", async () => {
      const { clientSide, serverSide } = pairOf({ server: () => void serverSide.emit("drain") });
      const received: Buffer[] = [];
      const errors: unknown[] = [];
      const server = new tls.TLSSocket(serverSide as net.Socket, serverOptions);
      server.on("data", () => {});
      server.on("error", (err: NodeJS.ErrnoException) => errors.push(err.code));
      server.write("banner");
      server.end();
      const client = tls.connect({ socket: clientSide, rejectUnauthorized: false });
      client.on("data", (chunk: Buffer) => received.push(chunk));
      client.on("end", () => client.end());
      client.on("error", (err: NodeJS.ErrnoException) => errors.push(err.code));
      await closeOf(client);
      expect({
        received: Buffer.concat(received).toString(),
        errors,
        bytesWritten: server.bytesWritten,
        drainListeners: serverSide.listenerCount("drain"),
      }).toEqual({ received: "banner", errors: [], bytesWritten: 6, drainListeners: 0 });
    });

    test("a write() override that emits 'drain' does not nest the stream's writes", async () => {
      const { clientSide, serverSide } = pairOf();
      let depth = 0;
      let deepest = 0;
      const write = clientSide.write;
      clientSide.write = function (this: Duplex, ...args: any[]) {
        deepest = Math.max(deepest, ++depth);
        // Bounded, so a nested write shows as a depth and not as a stack overflow.
        if (depth < 3) this.emit("drain");
        try {
          return write.apply(this, args);
        } finally {
          depth--;
        }
      } as typeof write;
      const client = tls.connect({ socket: clientSide, rejectUnauthorized: false });
      const { received, errors } = await parkedWrite(client, serverSide);
      expect({ received, errors, deepest }).toEqual({ received: "parked", errors: [], deepest: 1 });
    });

    // What a user sees of it: an https.Server handles the one request twice.
    test("https.request() through createConnection sends its request once", async () => {
      const { clientSide, serverSide } = pairOf({ client: () => void clientSide.emit("drain") });
      let requests = "";
      const server = new tls.TLSSocket(serverSide as net.Socket, serverOptions);
      server.setEncoding("latin1");
      server.on("error", () => {});
      server.on("data", (chunk: string) => {
        requests += chunk;
        if (requests.endsWith("body")) server.end("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      });
      const request = https.request({
        method: "POST",
        path: "/once",
        headers: { "Content-Length": "4" },
        createConnection: () => tls.connect({ socket: clientSide, rejectUnauthorized: false }),
      });
      request.end("body");
      const [response] = await once(request, "response");
      response.resume();
      await once(response, "end");
      expect({ status: response.statusCode, requestLines: requests.split("POST /once HTTP/1.1").length - 1 }).toEqual({
        status: 200,
        requestLines: 1,
      });
    });

    test("an HTTP/2 request body arrives intact", async () => {
      const body = Buffer.alloc(512 * 1024, Buffer.from(Array.from({ length: 251 }, (_, i) => i)));
      const { promise, resolve, reject } = Promise.withResolvers<{
        status: unknown;
        received: number;
        intact: boolean;
      }>();
      const server = http2.createSecureServer(certs);
      server.on("sessionError", reject);
      server.on("stream", (stream: http2.ServerHttp2Stream) => {
        const chunks: Buffer[] = [];
        stream.on("error", reject);
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          const all = Buffer.concat(chunks);
          stream.respond({ ":status": 200, "x-received": String(all.length), "x-intact": String(all.equals(body)) });
          stream.end();
        });
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
      await once(raw, "connect");
      // Hands each chunk to the socket inside write(), with no queue of its own.
      class Direct extends Duplex {
        _read() {}
        write(chunk: any, encoding?: any, callback?: any) {
          this.emit("drain");
          raw.write(chunk, typeof encoding === "function" ? encoding : callback);
          return true;
        }
        end() {
          raw.end();
          return this;
        }
      }
      const transport = new Direct();
      raw.on("data", chunk => transport.push(chunk));
      raw.on("error", reject);
      raw.on("close", () => reject(new Error("the connection closed before the response ended")));
      const session = http2.connect("https://localhost", {
        createConnection: () => tls.connect({ socket: transport, ALPNProtocols: ["h2"], rejectUnauthorized: false }),
      });
      try {
        session.on("error", reject);
        const request = session.request({ ":path": "/", ":method": "POST" });
        request.on("error", reject);
        request.on("close", () => reject(new Error("the request closed before its response ended")));
        request.on("response", headers => {
          request.resume();
          request.on("end", () =>
            resolve({
              status: headers[":status"],
              received: Number(headers["x-received"]),
              intact: headers["x-intact"] === "true",
            }),
          );
        });
        request.end(body);
        expect(await promise).toEqual({ status: 200, received: body.length, intact: true });
      } finally {
        session.destroy();
        raw.destroy();
        server.close();
      }
    });
  });

  // The dialing socket sends its own backlog at 'connect' and emits 'drain' for it, before that 'connect' reaches
  // the TLS socket over it. The backlog also puts the TLS socket on the engine that runs over a stream.
  test("a write made before the TCP connect of the wrapped net.Socket is sent once", async () => {
    const { promise: received, resolve, reject } = Promise.withResolvers<string>();
    let backlog = 0;
    const server = net.createServer(accepted => {
      let seen = 0;
      accepted.on("error", reject);
      accepted.on("data", function onBacklog(chunk: Buffer) {
        if ((seen += chunk.length) < backlog) return;
        accepted.removeListener("data", onBacklog);
        const secure = tls.connect({ socket: accepted, rejectUnauthorized: false });
        let text = "";
        secure.setEncoding("utf8");
        secure.on("error", reject);
        secure.on("data", chunk => (text += chunk));
        secure.on("end", () => resolve(text));
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      const events: string[] = [];
      raw.on("error", reject);
      // The least that makes the socket emit 'drain' once it is sent.
      raw.write(Buffer.alloc((backlog = raw.writableHighWaterMark), "p"));
      raw.once("drain", () => events.push("transport drain"));
      const socket = new tls.TLSSocket(raw, serverOptions);
      socket.once("connect", () => events.push("connect"));
      socket.on("error", reject);
      socket.write("hello", () => socket.end());
      expect({ received: await received, bytesWritten: socket.bytesWritten, events }).toEqual({
        received: "hello",
        bytesWritten: 5,
        events: ["transport drain", "connect"],
      });
    } finally {
      raw.destroy();
      server.close();
    }
  });

  // One SSL_write takes at most 2^31 - 1 bytes, and the listener was what sent the rest of a longer chunk. Node fails
  // such a write and hands the stream nothing:
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_tls.cc#L1105-L1126
  // Skipped where a process cannot reserve a buffer of 2^31 bytes, which the fixture needs.
  test.skipIf(!canReserve2GiB)(
    "one write above 2^31 - 1 bytes fails with EPROTO",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dirname, "node-tls-write-limit.fixture.ts")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const refused = { code: "EPROTO", syscall: "write", callbacks: 1, errors: ["EPROTO"] };
      const closedHandle = isWindows ? "EPIPE" : "EBADF";
      expect(JSON.parse(stdout.trim() || '"NO_OUTPUT"')).toEqual({
        aboveAsBuffer: { ...refused, transportWrites: 0 },
        aboveAsString: { ...refused, transportWrites: 0 },
        aboveBeforeTheTransportConnects: refused,
        atTheLimit: { code: closedHandle, syscall: "write", callbacks: 1, errors: [closedHandle] },
        aboveOnATCPSocket: { code: closedHandle, syscall: "write", callbacks: 1, errors: [closedHandle] },
      });
      expect(exitCode).toBe(0);
    },
    // A build that does not refuse the chunk seals 2 GiB before the fixture can say so.
    30_000,
  );

  // That limit is a branch of Socket.prototype._write, which a subclass overrides as in Node.
  test("a subclass's _write() runs for each write", async () => {
    let subclassWrites = 0;
    class Counting extends tls.TLSSocket {
      _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        subclassWrites++;
        return super._write(chunk, encoding, callback);
      }
    }
    const { clientSide, serverSide } = pairOf();
    const client = new Counting(clientSide as net.Socket, { rejectUnauthorized: false });
    expect({ ...(await parkedWrite(client, serverSide)), subclassWrites }).toEqual({
      received: "parked",
      errors: [],
      callbacks: 1,
      bytesWritten: 6,
      subclassWrites: 1,
    });
  });
});
