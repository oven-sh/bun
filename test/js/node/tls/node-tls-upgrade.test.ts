import { expect, test } from "bun:test";
import { spawn } from "child_process";
import { EventEmitter, once } from "events";
import { bunEnv, bunExe, tls as certs } from "harness";
import http from "http";
import net from "net";
import { Duplex, Readable } from "stream";
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
    "tls.connect({ socket: a stream that is no stream.Duplex })",
    true,
    (raw: net.Socket, o: object) => tls.connect({ socket: new EmitterDuplex(raw) as unknown as Duplex, ...o }),
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

// The arguments of the next `event` of `socket`. An error, or a close ahead of the event, rejects.
function nextEvent(socket: net.Socket, event: string) {
  const { promise, resolve, reject } = Promise.withResolvers<unknown[]>();
  socket.once(event, (...args: unknown[]) => resolve(args));
  socket.once("error", reject);
  socket.once("close", () => reject(new Error(`closed before '${event}'`)));
  return promise;
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

test("a server-side TLSSocket over the socket of an http 'connect' event is connected", async () => {
  // That socket is a net.Socket with no handle of its own, so the wrap reads it as a stream. It is connected all the same.
  const atSecure = Promise.withResolvers<{ connecting: boolean; pending: boolean; readyState: string }>();
  const proxy = http.createServer();
  proxy.on("connect", (_request, socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const secure = wrapAndEcho(socket);
    secure.once("secure", () => {
      atSecure.resolve({ connecting: secure.connecting, pending: secure.pending, readyState: secure.readyState });
    });
    secure.once("error", atSecure.reject);
    secure.once("close", () => atSecure.reject(new Error("closed before 'secure'")));
  });
  await once(proxy.listen(0, "127.0.0.1"), "listening");
  const raw = net.connect((proxy.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    raw.write("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n");
    const established = Promise.withResolvers<void>();
    let head = "";
    raw.on("data", function readAnswer(chunk) {
      head += chunk;
      if (!head.includes("\r\n\r\n")) return;
      raw.removeListener("data", readAnswer);
      established.resolve();
    });
    await established.promise;
    const echoed = pingOverTLS(raw);
    expect(await atSecure.promise).toEqual({ connecting: false, pending: false, readyState: "open" });
    expect(await echoed).toBe("ping");
  } finally {
    raw.destroy();
    proxy.closeAllConnections();
    proxy.close();
  }
});

test("tls.connect({ socket }) over the socket of an http 'connect' event completes the handshake", async () => {
  // The proxy is the TLS client over the tunnel it answered, and the peer that asked for the tunnel is the TLS server.
  const echoed = Promise.withResolvers<object>();
  const proxy = http.createServer();
  proxy.on("connect", (_request, socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    let atSecureConnect: object;
    const secure = tls.connect({ socket, rejectUnauthorized: false }, () => {
      atSecureConnect = { connecting: secure.connecting, pending: secure.pending, readyState: secure.readyState };
      secure.write("ping");
    });
    secure.on("error", echoed.reject);
    secure.on("close", () => echoed.reject(new Error("closed before the echo arrived")));
    secure.on("data", chunk => echoed.resolve({ echoed: chunk.toString(), ...atSecureConnect }));
  });
  await once(proxy.listen(0, "127.0.0.1"), "listening");
  const raw = net.connect((proxy.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    raw.write("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n");
    let head = Buffer.alloc(0);
    raw.on("data", function readAnswer(chunk: Buffer) {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      raw.removeListener("data", readAnswer);
      // The proxy's ClientHello can come in the chunk that ends its answer.
      raw.pause();
      raw.unshift(head.subarray(end + 4));
      wrapAndEcho(raw);
    });
    expect(await echoed.promise).toEqual({ echoed: "ping", connecting: false, pending: false, readyState: "open" });
  } finally {
    raw.destroy();
    proxy.closeAllConnections();
    proxy.close();
  }
});

// A duplex of another streams implementation: it has the methods that Node's JSStreamSocket calls and is no stream.Duplex.
class EmitterDuplex extends EventEmitter {
  destroyed = false;
  #socket: net.Socket;
  #paused = false;
  #queued: Buffer[] = [];
  #ended = false;
  constructor(socket: net.Socket) {
    super();
    this.#socket = socket;
    socket.on("data", (chunk: Buffer) => {
      if (this.#paused) this.#queued.push(chunk);
      else this.emit("data", chunk);
    });
    socket.on("end", () => {
      this.#ended = true;
      this.#deliver();
    });
    socket.on("close", () => {
      this.destroyed = true;
      this.emit("close");
    });
    socket.on("error", err => this.emit("error", err));
    socket.on("drain", () => this.emit("drain"));
  }
  #deliver() {
    while (!this.#paused && this.#queued.length > 0) this.emit("data", this.#queued.shift());
    if (this.#ended && !this.#paused) {
      this.#ended = false;
      this.emit("end");
    }
  }
  pause() {
    this.#paused = true;
    return this;
  }
  resume() {
    this.#paused = false;
    process.nextTick(() => this.#deliver());
    return this;
  }
  cork() {}
  uncork() {}
  write(chunk: Buffer, ...rest: any[]) {
    return this.#socket.write(chunk, ...rest);
  }
  end(...args: any[]) {
    this.#socket.end(...args);
    return this;
  }
  destroy(err?: Error) {
    this.destroyed = true;
    this.#socket.destroy(err);
    return this;
  }
}
// The same stream behind an object that is no EventEmitter either.
function plainObjectStream(socket: net.Socket) {
  const stream = new EmitterDuplex(socket);
  const object: Record<string, unknown> = {
    get destroyed() {
      return stream.destroyed;
    },
  };
  for (const method of [
    "on",
    "once",
    "removeListener",
    "pause",
    "resume",
    "cork",
    "uncork",
    "write",
    "end",
    "destroy",
  ]) {
    object[method] = (...args: unknown[]) => {
      const result = stream[method](...args);
      return result === stream ? object : result;
    };
  }
  return object;
}

test.each([
  ["an EventEmitter with the methods of a stream", (socket: net.Socket) => new EmitterDuplex(socket)],
  ["the same, paused before the wrap", (socket: net.Socket) => new EmitterDuplex(socket).pause()],
  ["a plain object with the methods of a stream", plainObjectStream],
  // Only the handle of a net.Socket is one the TLS layer can take over.
  [
    "a Duplex that has a _handle of its own",
    (socket: net.Socket) => Object.assign(duplexOver(socket), { _handle: {} }),
  ],
])("a stream that is no net.Socket is wrapped on both sides: %s", async (_name, streamOver) => {
  const sockets: net.Socket[] = [];
  const server = net.createServer(accepted => {
    sockets.push(accepted);
    wrapAndEcho(streamOver(accepted) as unknown as Duplex);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  sockets.push(raw);
  try {
    await once(raw, "connect");
    expect(await pingOverTLS(streamOver(raw) as unknown as Duplex)).toBe("ping");
  } finally {
    closeAll(server, sockets);
  }
});

test("new TLSSocket(stream) with no options wraps a plain object that has the methods of a stream", async () => {
  const sockets: net.Socket[] = [];
  const server = net.createServer(accepted => {
    sockets.push(accepted);
    accepted.on("error", () => {});
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  sockets.push(raw);
  try {
    await once(raw, "connect");
    const stream = plainObjectStream(raw);
    const firstWrite = Promise.withResolvers<Buffer>();
    const write = stream.write as (chunk: Buffer, ...rest: unknown[]) => boolean;
    stream.write = (chunk: Buffer, ...rest: unknown[]) => {
      firstWrite.resolve(chunk);
      return write(chunk, ...rest);
    };
    const client = new tls.TLSSocket(stream as unknown as net.Socket);
    client.on("error", firstWrite.reject);
    client.on("close", () => firstWrite.reject(new Error("closed before a write")));
    // @ts-expect-error node starts the handshake of a constructor wrap here
    client._start();
    // A ClientHello, which is a handshake record (type 22), leaves through the object.
    expect((await firstWrite.promise)[0]).toBe(22);
  } finally {
    closeAll(server, sockets);
  }
});

test("what is no stream is refused with a TypeError, as in Node", () => {
  const server = tls.createServer(certs);
  const refused = (wrap: (value: unknown) => unknown) =>
    [{}, [], 42, "text", () => {}, new EventEmitter(), { pause: 1 }].map(value => {
      try {
        wrap(value);
        return "no error";
      } catch (err) {
        return (err as Error).name;
      }
    });
  const every = Array.from({ length: 7 }, () => "TypeError");
  expect({
    "new TLSSocket(value, options)": refused(
      value => new tls.TLSSocket(value as net.Socket, { isServer: true, ...certs }),
    ),
    'server.emit("connection", value)': refused(value => server.emit("connection", value)),
    "tls.connect({ socket: value })": refused(value => tls.connect({ socket: value as Duplex })),
  }).toEqual({
    "new TLSSocket(value, options)": every,
    'server.emit("connection", value)': every,
    "tls.connect({ socket: value })": every,
  });
});

const streamMethods = ["pause", "resume", "on", "once", "write", "end", "destroy"];
test.each([
  "a stream.Readable",
  ...streamMethods.map(method => `an object with every method of a stream but ${method}()`),
])("%s is refused: the TLS layer calls each of them on what it wraps", name => {
  const incomplete = () =>
    name === "a stream.Readable"
      ? new Readable({ read() {} })
      : Object.fromEntries(streamMethods.filter(method => !name.endsWith(` ${method}()`)).map(m => [m, () => {}]));
  const refused = (wrap: (value: unknown) => unknown) => {
    try {
      wrap(incomplete());
      return "no error";
    } catch (err) {
      return `${(err as Error).name} ${(err as NodeJS.ErrnoException).code}`;
    }
  };
  const server = tls.createServer(certs);
  expect({
    "new TLSSocket(value, options)": refused(
      value => new tls.TLSSocket(value as net.Socket, { isServer: true, ...certs }),
    ),
    'server.emit("connection", value)': refused(value => server.emit("connection", value)),
    "tls.connect({ socket: value })": refused(value => tls.connect({ socket: value as Duplex })),
  }).toEqual({
    "new TLSSocket(value, options)": "TypeError ERR_INVALID_ARG_TYPE",
    'server.emit("connection", value)': "TypeError ERR_INVALID_ARG_TYPE",
    // No stream, so no connection to use, and no port either.
    "tls.connect({ socket: value })": "TypeError ERR_MISSING_ARGS",
  });
});

// A tunnel through the server itself: the server hands the socket of a session to its own 'connection' listener, for a
// second session inside the first.
test.each(["a socket the server accepted", "an injected socket"])(
  "tls.Server wraps %s again when it is emitted after its handshake",
  async how => {
    let sessions = 0;
    const server = tls.createServer(certs, socket => {
      socket.on("error", () => {});
      if (++sessions > 1) return void socket.write("inner");
      socket.write("outer");
      server.emit("connection", socket);
    });
    const listener =
      how === "an injected socket" ? net.createServer(socket => void server.emit("connection", socket)) : server;
    await once(listener.listen(0, "127.0.0.1"), "listening");
    const port = (listener.address() as net.AddressInfo).port;
    const outer = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    outer.on("error", () => {});
    try {
      expect(String((await nextEvent(outer, "data"))[0])).toBe("outer");
      const inner = tls.connect({ socket: outer, rejectUnauthorized: false });
      inner.on("error", () => {});
      expect(String((await nextEvent(inner, "data"))[0])).toBe("inner");
    } finally {
      outer.destroy();
      listener.close();
    }
  },
);

test("a server-side TLSSocket over a net.Socket that has no handle is connected, and its end() reaches the peer", async () => {
  // How a library puts a socket over a transport of its own.
  class Tunnel extends net.Socket {
    #under: net.Socket;
    constructor(under: net.Socket) {
      super();
      this.#under = under;
      under.on("data", chunk => this.push(chunk) || under.pause());
      under.on("end", () => this.push(null));
      under.on("error", err => this.destroy(err));
      under.on("close", () => this.destroy());
    }
    _read() {
      this.#under.resume();
    }
    _write(chunk: Buffer, encoding: BufferEncoding, callback: (err?: Error | null) => void) {
      this.#under.write(chunk, encoding, callback);
    }
    _final(callback: (err?: Error | null) => void) {
      this.#under.end(callback);
    }
    _destroy(err: Error | null, callback: (err?: Error | null) => void) {
      this.#under.destroy();
      callback(err);
    }
  }
  const atSecure = Promise.withResolvers<{ connecting: boolean; readyState: string; connectsLater: number }>();
  let tunnel: Tunnel;
  const server = tls.createServer(certs, socket => {
    socket.on("error", () => {});
    const { connecting, readyState } = socket;
    // The handshake has reported the connection. A 'connect' of the transport after it is no second one.
    let connectsLater = 0;
    socket.on("connect", () => connectsLater++);
    tunnel.emit("connect");
    atSecure.resolve({ connecting, readyState, connectsLater });
    socket.end("bye");
  });
  const front = net.createServer(socket => void server.emit("connection", (tunnel = new Tunnel(socket))));
  await once(front.listen(0, "127.0.0.1"), "listening");
  const port = (front.address() as net.AddressInfo).port;
  const options = { port, host: "127.0.0.1", rejectUnauthorized: false, allowHalfOpen: true };
  const client = tls.connect(options as tls.ConnectionOptions);
  try {
    let received = "";
    client.setEncoding("utf8");
    client.on("data", chunk => (received += chunk));
    await nextEvent(client, "end");
    expect({ received, ...(await atSecure.promise) }).toEqual({
      received: "bye",
      connecting: false,
      readyState: "open",
      connectsLater: 0,
    });
  } finally {
    client.destroy();
    front.close();
  }
});

test("a 'connect' listener that throws when a server-side handshake completes does not stop the completion", async () => {
  const script = `
    const net = require("node:net");
    const tls = require("node:tls");
    const { once } = require("node:events");
    // A socket over a transport of its own: it has no handle and emits no 'connect'.
    class Tunnel extends net.Socket {
      constructor(under) {
        super();
        this.under = under;
        under.on("data", chunk => this.push(chunk));
        under.on("end", () => this.push(null));
        under.on("close", () => this.destroy());
      }
      _read() {}
      _write(chunk, encoding, callback) {
        this.under.write(chunk, encoding, callback);
      }
      _final(callback) {
        this.under.end(callback);
      }
      _destroy(err, callback) {
        this.under.destroy();
        callback(err);
      }
    }
    const events = [];
    process.on("uncaughtException", err => events.push("uncaughtException " + err.message));
    const front = net.createServer(socket => {
      const { TLS_KEY: key, TLS_CERT: cert } = process.env;
      const secure = new tls.TLSSocket(new Tunnel(socket), { isServer: true, key, cert });
      secure.on("error", err => events.push("error " + err.message));
      secure.on("connect", () => {
        events.push("connect");
        throw new Error("boom");
      });
      secure.on("secure", () => {
        events.push("secure");
        secure.end("bye");
      });
    });
    await once(front.listen(0, "127.0.0.1"), "listening");
    const client = tls.connect({ port: front.address().port, host: "127.0.0.1", rejectUnauthorized: false });
    client.on("error", err => events.push("client error " + err.code));
    client.setEncoding("utf8");
    client.on("data", chunk => events.push("client data " + chunk));
    await once(client, "close");
    front.close();
    console.log(JSON.stringify(events));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, TLS_KEY: certs.key, TLS_CERT: certs.cert },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(["connect", "uncaughtException boom", "secure", "client data bye"]);
  expect(exitCode).toBe(0);
});

test("a server-side TLSSocket over a net.Socket that dials later is connecting until then, and keeps its end()", async () => {
  // The peer is the TLS client over the connection it accepts. The server has ended its side before it dials.
  const peerSaw = Promise.withResolvers<string[]>();
  const peer = net.createServer(accepted => {
    const events: string[] = [];
    const client = tls.connect({ socket: accepted, rejectUnauthorized: false });
    client.on("error", () => {});
    client.on("end", () => events.push("end"));
    client.on("close", () => peerSaw.resolve(events));
    client.resume();
  });
  await once(peer.listen(0, "127.0.0.1"), "listening");
  const raw = new net.Socket();
  const secure = new tls.TLSSocket(raw, { isServer: true, ...certs });
  try {
    secure.on("error", () => {});
    const beforeDial = { connecting: secure.connecting, readyState: secure.readyState };
    secure.end();
    await new Promise(resolve => setImmediate(resolve));
    raw.connect((peer.address() as net.AddressInfo).port, "127.0.0.1");
    expect({ beforeDial, peerSaw: await peerSaw.promise }).toEqual({
      beforeDial: { connecting: true, readyState: "opening" },
      peerSaw: ["end"],
    });
  } finally {
    secure.destroy();
    raw.destroy();
    peer.close();
  }
});

test.each(["tls.connect({ socket })", "new TLSSocket(socket, { isServer: true })"])(
  "%s over the socket of an http 'connect' event that is destroyed is not connected",
  async how => {
    // Node's rule is `connecting || !_handle`, and its destroyed socket has no handle.
    const outcome = Promise.withResolvers<{ connecting: boolean; readyState: string }>();
    const proxy = http.createServer();
    proxy.on("connect", (_request, socket) => {
      socket.on("error", () => {});
      socket.destroy();
      const secure =
        how === "tls.connect({ socket })"
          ? tls.connect({ socket, rejectUnauthorized: false })
          : new tls.TLSSocket(socket, { isServer: true, ...certs });
      const atWrap = { connecting: secure.connecting, readyState: secure.readyState };
      secure.on("error", () => {});
      for (const done of ["secure", "secureConnect"]) {
        secure.once(done, () => outcome.reject(new Error("the handshake completed")));
      }
      secure.once("close", () => outcome.resolve(atWrap));
    });
    await once(proxy.listen(0, "127.0.0.1"), "listening");
    const raw = net.connect((proxy.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      raw.on("error", () => {});
      raw.write("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n");
      expect(await outcome.promise).toEqual({ connecting: true, readyState: "opening" });
    } finally {
      raw.destroy();
      proxy.closeAllConnections();
      proxy.close();
    }
  },
);

test("net.connect({ socket }) with a stream that is no stream.Duplex still asks for a port", async () => {
  const server = net.createServer(socket => socket.on("error", () => {}));
  await once(server.listen(0, "127.0.0.1"), "listening");
  const raw = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    await once(raw, "connect");
    // @ts-expect-error `socket` is no option of net.connect()
    expect(() => net.connect({ socket: new EmitterDuplex(raw) })).toThrow(
      expect.objectContaining({ code: "ERR_MISSING_ARGS" }),
    );
  } finally {
    closeAll(server, [raw]);
  }
});
