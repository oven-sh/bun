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

  // Multi-worker traffic + close: exercises the DGRAM_FDS Owned/Adopted state
  // machine and SharedHandle teardown. A regression removing the double-close
  // guard would EBADF an IPC pipe and hang this fixture.
  test("multi-worker shared socket receives traffic then tears down cleanly", async () => {
    expect([path.join(import.meta.dir, "dgram-cluster-shared-fd-fixture.ts")]).toRun();
  }, 40_000);
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

// Every send callback must fire with (null, byteLength) — never (null, 0) or
// EAGAIN — even if the kernel refuses some writes (they queue and drain like
// libuv's uv_udp_try_send → uv_udp_send fallback).
test.skipIf(isWindows)("send() reports (null, byteLength) for every callback under a burst", async () => {
  const receiver = createSocket("udp4");
  await new Promise<void>(resolve => receiver.bind(0, "127.0.0.1", resolve));
  const port = receiver.address().port;
  receiver.on("message", () => {});

  const source = createSocket("udp4");
  await new Promise<void>(resolve => source.bind(0, "127.0.0.1", resolve));
  source.setSendBufferSize(2048);

  const payload = Buffer.alloc(64, "x");
  const N = 512;
  const results = await Promise.all(
    Array.from({ length: N }, () => {
      return new Promise<{ err: any; sent: number }>(resolve =>
        source.send(payload, port, "127.0.0.1", (err, sent) => resolve({ err, sent })),
      );
    }),
  );

  // getSendQueueCount()/Size() drop back to zero once every callback has run.
  expect(source.getSendQueueCount()).toBe(0);
  expect(source.getSendQueueSize()).toBe(0);
  source.close();
  receiver.close();

  for (const { err, sent } of results) {
    // Either the kernel accepted it synchronously, or the queue drained it —
    // never (null, 0) and never a would-block error.
    expect(err).toBeNull();
    expect(sent).toBe(payload.byteLength);
  }
});

// rinfo.family reflects the packet's sockaddr, not the constructor's `type`:
// a `udp4` socket adopting an IPv6 fd receives IPv6-tagged rinfo.
test.skipIf(isWindows)("rinfo.family follows the packet's sockaddr, not the socket type", async () => {
  const { UDP } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const wrap = new UDP();
  const rc = wrap.bind6("::1", 0, 0);
  if (rc < 0) {
    // No IPv6 loopback (some CI containers).
    wrap.close();
    return;
  }

  const socket = createSocket("udp4");
  const { promise: listening, resolve: onListening, reject } = Promise.withResolvers<void>();
  socket.on("error", reject);
  socket.on("listening", onListening);
  socket.bind({ fd: wrap.fd });
  await listening;

  const { promise: got, resolve: onMessage } = Promise.withResolvers<any>();
  socket.on("message", (_data, rinfo) => onMessage(rinfo));

  const sender = createSocket("udp6");
  await new Promise<void>((resolve, reject) =>
    sender.send("hi", socket.address().port, "::1", err => (err ? reject(err) : resolve())),
  );
  const rinfo = await got;
  sender.close();
  socket.close();
  wrap.close();

  expect(rinfo.family).toBe("IPv6");
  expect(rinfo.address).toBe("::1");
});

// Adopting an unbound descriptor: the kernel auto-binds on the first sendto(),
// and address() must return that ephemeral port (Node calls getsockname fresh).
test.skipIf(isWindows)("bind({ fd }) with an unbound descriptor reports the auto-bound port after send()", async () => {
  const { newRawSocketFd, closeRawFd } = require("bun:internal-for-testing").dgramInternals;
  const fd = newRawSocketFd(false, false);
  expect(fd).toBeGreaterThan(0);

  try {
    const receiver = createSocket("udp4");
    await new Promise<void>(resolve => receiver.bind(0, "127.0.0.1", resolve));
    const receiverPort = receiver.address().port;

    const socket = createSocket("udp4");
    const { promise: listening, resolve: onListening, reject } = Promise.withResolvers<void>();
    socket.on("error", reject);
    socket.on("listening", onListening);
    socket.bind({ fd });
    await listening;

    // Unbound at adoption: port is 0 until the kernel auto-binds on send.
    expect(socket.address().port).toBe(0);

    const { promise: gotRinfo, resolve: onMessage } = Promise.withResolvers<any>();
    receiver.on("message", (_data, rinfo) => onMessage(rinfo));
    await new Promise<void>((resolve, reject) =>
      socket.send("hi", receiverPort, "127.0.0.1", err => (err ? reject(err) : resolve())),
    );
    const rinfo = await gotRinfo;

    const addr = socket.address();
    expect(addr.port).toBeGreaterThan(0);
    expect(addr.port).toBe(rinfo.port);

    socket.close();
    receiver.close();
  } finally {
    // The socket adopted and closed it; closeRawFd is a no-op for adopted fds.
    closeRawFd(fd);
  }
});

// The membership setters throw an ErrnoException with .errno set (Node's shape),
// not a hand-rolled error missing the field.
test("addMembership() with a non-IP address carries .errno", () => {
  const socket = createSocket("udp4");
  try {
    socket.addMembership("not-an-ip");
    expect.unreachable();
  } catch (err: any) {
    expect(err.code).toBe("EINVAL");
    expect(err.syscall).toBe("addMembership");
    expect(typeof err.errno).toBe("number");
  }
  socket.close();
});

// Adopting a bound fd sets SO_REUSEADDR (like libuv's uv_udp_open), so a
// second reuseAddr socket can bind the same port.
test.skipIf(isWindows)("adopting a bound fd sets SO_REUSEADDR like uv_udp_open", async () => {
  const { UDP } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const wrap = new UDP();
  expect(wrap.bind("127.0.0.1", 0, 0)).toBe(0);
  const bound = {} as any;
  wrap.getsockname(bound);

  const socket = createSocket("udp4");
  const { promise: listening, resolve: onListening, reject } = Promise.withResolvers<void>();
  socket.on("error", reject);
  socket.on("listening", onListening);
  socket.bind({ fd: wrap.fd });
  await listening;

  // A second reuseAddr socket must bind the same port without EADDRINUSE.
  const second = createSocket({ type: "udp4", reuseAddr: true });
  const { promise: secondListening, resolve: onSecondListening, reject: onSecondError } = Promise.withResolvers<void>();
  second.on("error", onSecondError);
  second.on("listening", onSecondListening);
  second.bind(bound.port, "127.0.0.1");
  await secondListening;

  expect(second.address().port).toBe(bound.port);
  second.close();
  socket.close();
  wrap.close();
});

test("unconnected socket does not emit ICMP unreachable errors like Node", async () => {
  const deadPort = await getDeadPort();

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

// Node/libuv report a send request that was still queued when the socket
// closed as ECANCELED, not EBADF (uv__udp_finish_close sets req->status =
// UV_ECANCELED). Kernel backpressure can't be forced deterministically on a
// loopback UDP socket, so this drives the same queued path handleSend takes
// under backpressure: any send() behind a non-undefined sendQueue is queued.
// The socket is connected so send() reaches doSend synchronously (an
// unconnected send resolves the address first).
test("close() completes a send still queued behind backpressure with ECANCELED", async () => {
  const { kStateSymbol } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const socket = createSocket("udp4");
  await new Promise<void>(resolve => socket.bind(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => socket.connect(socket.address().port, "127.0.0.1", resolve));

  const handle = socket[kStateSymbol].handle;
  handle.sendQueue = [];

  const { promise, resolve } = Promise.withResolvers<any>();
  socket.send("never handed to the kernel", resolve);
  expect(handle.sendQueue).toHaveLength(1);
  expect(socket.getSendQueueCount()).toBe(1);

  socket.close();
  const err = await promise;
  expect({ code: err.code, syscall: err.syscall }).toEqual({ code: "ECANCELED", syscall: "send" });
  // The libuv errno for ECANCELED, which is not the same number on every
  // platform (Linux 125, Darwin 89, FreeBSD 85, Windows -4081).
  expect(err.errno).toBeLessThan(0);
  expect(err.message).toStartWith("send ECANCELED");
});

// Reserves an ephemeral UDP port and frees it, so datagrams sent there get
// ICMP port-unreachable replies on loopback.
async function getDeadPort() {
  const target = createSocket("udp4");
  await new Promise<void>(resolve => target.bind(0, "127.0.0.1", resolve));
  const deadPort = target.address().port;
  await new Promise<void>(resolve => target.close(resolve));
  return deadPort;
}

// A connected socket's ICMP error must be *emitted*, not treated as fatal.
// On the BSDs there is no error queue, so the kernel only delivers it via the
// next recvmsg failing with so_error. On Linux an adopted descriptor has no
// IP_RECVERR (that deliberately matches libuv's uv_udp_open), so its error
// queue is empty and the kernel reports a bare EPOLLERR with no EPOLLIN.
// Either way loop.c used to treat the failure as fatal and silently close the
// socket; Node emits `recvmsg ECONNREFUSED` and keeps it open.
const icmpBindModes = {
  connected: async (socket: any) => {
    await new Promise<void>(resolve => socket.bind(0, "127.0.0.1", resolve));
  },
  "adopted + connected": async (socket: any) => {
    const { _createSocketHandle } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
    const wrap = _createSocketHandle("127.0.0.1", 0, "udp4");
    expect(typeof wrap).not.toBe("number");
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.on("listening", resolve);
    socket.bind({ fd: wrap.fd });
    await promise;
  },
};
for (const [kind, bind] of Object.entries(icmpBindModes)) {
  test.skipIf(isWindows)(`${kind} socket emits the ICMP error instead of silently dying`, async () => {
    const { kStateSymbol } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
    const deadPort = await getDeadPort();

    const socket = createSocket("udp4");
    const { promise: errored, resolve: onError } = Promise.withResolvers<any>();
    socket.on("error", onError);
    await bind(socket);
    await new Promise<void>(resolve => socket.connect(deadPort, "127.0.0.1", () => resolve()));

    // Keep sending until the queued ICMP error surfaces. If the native socket
    // is silently closed instead, fail with that rather than a timeout.
    const native = socket[kStateSymbol].handle.socket;
    let stop = false;
    const pump = (async () => {
      while (!stop) {
        if (native.closed) {
          onError(new Error("native socket was silently closed instead of emitting 'error'"));
          return;
        }
        try {
          socket.send("x");
        } catch {}
        await Bun.sleep(10);
      }
    })();

    const err = await errored;
    stop = true;
    await pump;
    expect({ code: err.code, syscall: err.syscall, message: err.message }).toEqual({
      code: "ECONNREFUSED",
      syscall: "recvmsg",
      message: "recvmsg ECONNREFUSED",
    });
    // The socket stays usable after the error, like Node's.
    expect(native.closed).toBe(false);
    socket.close();
  });
}
