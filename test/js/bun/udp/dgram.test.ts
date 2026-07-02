import { describe, expect, jest, test } from "bun:test";
import { createSocket } from "dgram";

import { disableAggressiveGCScope, isWindows } from "harness";
import path from "path";
import { nodeDataCases } from "./testdata";

describe("createSocket()", () => {
  test("connect", done => {
    const PORT = 12345;
    const client = createSocket("udp4");
    client.on("close", done);

    client.connect(PORT, () => {
      const remoteAddr = client.remoteAddress();
      expect(remoteAddr.port).toBe(PORT);
      expect(() => client.connect(PORT)).toThrow();

      client.disconnect();
      expect(() => client.disconnect()).toThrow();

      expect(() => client.remoteAddress()).toThrow();

      client.once("connect", () => client.close());
      client.connect(PORT);
    });
  });

  test("IPv4 address", done => {
    const socket = createSocket("udp4");

    socket.on("listening", () => {
      const address = socket.address();

      expect(address.address).toBe("127.0.0.1");
      expect(address.port).toBeNumber();
      expect(address.port).toBeFinite();
      expect(address.port).toBeGreaterThan(0);
      expect(address.family).toBe("IPv4");
      socket.close(done);
    });

    socket.on("error", err => {
      expect(err).toBeNull();
      socket.close(done);
    });

    socket.bind(0, "127.0.0.1");
  });

  test("IPv6 address", done => {
    const socket = createSocket("udp6");
    const localhost = "::1";

    socket.on("listening", () => {
      const address = socket.address();

      expect(address.address).toBe(localhost);
      expect(address.port).toBeNumber();
      expect(address.port).toBeFinite();
      expect(address.port).toBeGreaterThan(0);
      expect(address.family).toBe("IPv6");
      socket.close(done);
    });

    socket.on("error", err => {
      expect(err).toBeNull();
      socket.close(done);
    });

    socket.bind(0, localhost);
  });

  test("address before/after connecting", done => {
    const socket = createSocket("udp4");
    socket.bind(0, () => {
      expect(socket.address().address).toBe("0.0.0.0");
      socket.connect(socket.address().port, "127.0.0.1", () => {
        expect(socket.address().address).toBe("127.0.0.1");
        socket.close(done);
      });
    });
  });

  const validateRecv = (server, data, rinfo, bytes) => {
    using _ = disableAggressiveGCScope();
    try {
      expect(rinfo.port).toBeInteger();
      expect(rinfo.port).toBeWithin(1, 65535 + 1);
      expect(rinfo.address).toBeString();
      expect(rinfo.address).not.toBeEmpty();
      expect(rinfo.port).not.toBe(server.address().port);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  for (const { label, data, bytes } of nodeDataCases) {
    test(`send ${label}`, done => {
      const client = createSocket("udp4");
      const closed = { closed: false };
      client.on("close", () => {
        closed.closed = true;
      });
      const server = createSocket("udp4");
      client.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("message", (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);

        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(data, server.address().port, "127.0.0.1", () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on("listening", () => {
        sendRec();
      });
      server.bind();
    });

    test(`send connected ${label}`, done => {
      const client = createSocket("udp4");
      const closed = { closed: false };
      client.on("close", () => {
        closed.closed = true;
      });
      const server = createSocket("udp4");
      client.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("message", (data, rinfo) => {
        validateRecv(server, data, rinfo, bytes);

        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send(data, () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on("listening", () => {
        const addr = server.address();
        client.connect(addr.port, "127.0.0.1", () => {
          sendRec();
        });
      });
      server.bind();
    });

    test(`send array ${label}`, done => {
      const client = createSocket("udp4");
      const closed = { closed: false };
      client.on("close", () => {
        closed.closed = true;
      });
      const server = createSocket("udp4");
      client.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("error", err => {
        expect(err).toBeNull();
      });
      server.on("message", (data, rinfo) => {
        validateRecv(server, data, rinfo, Buffer.from([...bytes, ...bytes, ...bytes].flat()));

        server.close();
        client.close();
        done();
      });
      function sendRec() {
        if (!closed.closed) {
          client.send([data, data, data], server.address().port, "127.0.0.1", () => {
            setTimeout(sendRec, 100);
          });
        }
      }
      server.on("listening", () => {
        sendRec();
      });
      server.bind();
    });
  }
});

describe("unref()", () => {
  test("call before bind() does not hang", async () => {
    expect([path.join(import.meta.dir, "dgram-unref-hang-fixture.ts")]).toRun();
  });

  // The last ref()/unref() before bind wins, like Node's always-present handle.
  test("ref() after unref() before bind() keeps the socket ref'd", async () => {
    expect([path.join(import.meta.dir, "dgram-ref-after-unref-fixture.ts")]).toRun();
  });
});

// Cluster-shared dgram descriptors are POSIX-only (Windows reports ENOTSUP).
describe.skipIf(isWindows)("cluster", () => {
  // The shared wrap's close(cb) must invoke cb (Node's HandleWrap contract) or
  // cluster's disconnect refcount never reaches zero and the worker hangs.
  test("worker.disconnect() with a shared socket lets the worker exit", async () => {
    expect([path.join(import.meta.dir, "dgram-cluster-disconnect-fixture.ts")]).toRun();
  });
});

describe("after close()", () => {
  // Node throws ERR_SOCKET_DGRAM_NOT_RUNNING from these methods once the
  // socket is closed. They must not surface an internal TypeError instead.
  async function boundThenClosed() {
    const socket = createSocket("udp4");
    const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
    socket.bind(0, onListening);
    await listening;
    const port = socket.address().port;
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    socket.close(onClose);
    await closed;
    return { socket, port };
  }

  test("address() throws ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const { socket } = await boundThenClosed();
    let err: any;
    try {
      socket.address();
    } catch (e) {
      err = e;
    }
    expect({ name: err?.name, code: err?.code }).toEqual({ name: "Error", code: "ERR_SOCKET_DGRAM_NOT_RUNNING" });
  });

  test("remoteAddress() throws ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const { socket } = await boundThenClosed();
    expect(() => socket.remoteAddress()).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
  });

  test("send() throws ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const { socket, port } = await boundThenClosed();
    expect(() => socket.send(Buffer.from("hello"), port, "127.0.0.1")).toThrowWithCode(
      Error,
      "ERR_SOCKET_DGRAM_NOT_RUNNING",
    );
  });

  test("send() with a callback throws ERR_SOCKET_DGRAM_NOT_RUNNING synchronously", async () => {
    const { socket, port } = await boundThenClosed();
    expect(() => socket.send(Buffer.from("hello"), port, "127.0.0.1", () => {})).toThrowWithCode(
      Error,
      "ERR_SOCKET_DGRAM_NOT_RUNNING",
    );
  });

  test("close() throws ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const { socket } = await boundThenClosed();
    expect(() => socket.close()).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
  });

  test("bind() throws ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const { socket } = await boundThenClosed();
    expect(() => socket.bind(0)).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
  });

  test("close() of a never-bound socket can only be called once", async () => {
    const socket = createSocket("udp4");
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    socket.close(onClose);
    await closed;
    expect(() => socket.close()).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
  });

  test("Symbol.asyncDispose resolves when the socket is already closed", async () => {
    const { socket } = await boundThenClosed();
    expect(await socket[Symbol.asyncDispose]()).toBeUndefined();
  });
});

describe("bind()", () => {
  // Node throws ERR_SOCKET_ALREADY_BOUND synchronously from bind(); the error
  // must reach the caller's try/catch, never an attached 'error' listener.
  test("on an already-bound socket throws ERR_SOCKET_ALREADY_BOUND and does not emit 'error'", async () => {
    await using socket = createSocket("udp4");
    const { promise: listening, resolve: onListening, reject } = Promise.withResolvers<void>();
    const onError = jest.fn(reject);
    socket.on("error", onError);
    socket.bind(0, onListening);
    await listening;
    expect(() => socket.bind(0)).toThrowWithCode(Error, "ERR_SOCKET_ALREADY_BOUND");
    expect(onError).not.toHaveBeenCalled();
  });

  test("while a bind is still in flight throws ERR_SOCKET_ALREADY_BOUND and does not emit 'error'", async () => {
    await using socket = createSocket("udp4");
    const { promise: listening, resolve: onListening, reject } = Promise.withResolvers<void>();
    const onError = jest.fn(reject);
    socket.on("error", onError);
    socket.bind(0, onListening);
    expect(() => socket.bind(0)).toThrowWithCode(Error, "ERR_SOCKET_ALREADY_BOUND");
    // The in-flight first bind must still complete normally.
    await listening;
    expect(onError).not.toHaveBeenCalled();
  });
});

// The duplicate-adoption guard must trip synchronously: libuv reports EEXIST
// from the second uv_udp_open() of the same descriptor even in the same tick.
test.skipIf(isWindows)("bind({ fd }) rejects a same-tick duplicate adoption", async () => {
  const { _createSocketHandle } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const wrap = _createSocketHandle("127.0.0.1", 0, "udp4");
  expect(typeof wrap).not.toBe("number");

  const first = createSocket("udp4");
  const second = createSocket("udp4");
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  first.on("listening", onListening);
  first.bind({ fd: wrap.fd });
  expect(() => second.bind({ fd: wrap.fd })).toThrowWithCode(Error, "EEXIST");
  await listening;
  first.close();
  second.close();
  wrap.close();
});

// The same guard lives in the native layer so `Bun.udpSocket({ fd })` cannot
// adopt (and later double-close) a descriptor a live socket already owns.
test.skipIf(isWindows)("Bun.udpSocket({ fd }) rejects a descriptor a live socket already adopted", async () => {
  const { _createSocketHandle } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const wrap = _createSocketHandle("127.0.0.1", 0, "udp4");
  const socket = createSocket("udp4");
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  socket.on("listening", onListening);
  socket.bind({ fd: wrap.fd });
  await listening;

  await expect(() => Bun.udpSocket({ fd: wrap.fd })).toThrowWithCodeAsync(Error, "EEXIST");

  socket.close();
  wrap.close();
});

// Node throws an ErrnoException from the option setters of an unbound socket;
// the error carries the syscall name and code, not a bare `Error`.
test("setBroadcast()/setMulticastLoopback() before bind() throw EBADF", () => {
  const socket = createSocket("udp4");
  for (const method of ["setBroadcast", "setMulticastLoopback"] as const) {
    expect(() => socket[method](true)).toThrowWithCode(Error, "EBADF");
    expect(() => socket[method](true)).toThrow(`${method} EBADF`);
  }
  socket.close();
});

// An oversized datagram fails send(2) with EMSGSIZE; on the connected path no
// address/port is known, so the error must match Node's bare `send <code>`.
test.skipIf(isWindows)("connected send() failure reports Node's error shape", async () => {
  const receiver = createSocket("udp4");
  const { promise: receiverBound, resolve: onReceiverBound } = Promise.withResolvers<void>();
  receiver.bind(0, "127.0.0.1", onReceiverBound);
  await receiverBound;

  const socket = createSocket("udp4");
  const { promise: bound, resolve: onBound } = Promise.withResolvers<void>();
  socket.bind(0, "127.0.0.1", onBound);
  await bound;
  const { promise: connected, resolve: onConnected } = Promise.withResolvers<void>();
  socket.connect(receiver.address().port, "127.0.0.1", onConnected);
  await connected;

  const err: any = await new Promise(resolve => socket.send(Buffer.alloc(70000), resolve));
  socket.close();
  receiver.close();
  expect(err).not.toBeNull();
  expect({ syscall: err.syscall, code: err.code, message: err.message, address: err.address, port: err.port }).toEqual({
    syscall: "send",
    code: "EMSGSIZE",
    message: "send EMSGSIZE",
    address: undefined,
    port: undefined,
  });
});

test("unconnected socket does not emit ICMP unreachable errors like Node", async () => {
  // Reserve a port, then close it so datagrams sent there trigger ICMP
  // port-unreachable replies on loopback.
  const target = createSocket("udp4");
  await new Promise<void>(resolve => target.bind(0, "127.0.0.1", resolve));
  const deadPort = target.address().port;
  await new Promise<void>(resolve => target.close(resolve));

  const source = createSocket("udp4");
  const errors: Error[] = [];
  source.on("error", err => errors.push(err));

  try {
    // Several sends with event-loop turns in between so any queued ICMP error
    // would have been read back and surfaced before the next send.
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve, reject) =>
        source.send("hello", deadPort, "127.0.0.1", err => (err ? reject(err) : resolve())),
      );
      await Bun.sleep(10);
    }
    expect(errors).toEqual([]);
  } finally {
    source.close();
  }
});
