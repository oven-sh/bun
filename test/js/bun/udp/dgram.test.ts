import { describe, expect, jest, test } from "bun:test";
import { createSocket } from "dgram";
import { Worker } from "node:worker_threads";

import { bunEnv, bunExe, disableAggressiveGCScope, isWindows } from "harness";
import path from "path";
import { nodeDataCases } from "./testdata";

// Spawn a cluster fixture with a hard deadline and no-orphan protection. The
// toRun() matcher uses spawnSync, which a test timeout cannot interrupt, so a
// hung fixture leaks the primary + workers onto a non-ephemeral CI agent and
// every later UDP test in the shard then times out too. Bun.spawn lets the
// test-level timeout actually fire, `await using` kills the primary on the way
// out, and BUN_FEATURE_FLAG_NO_ORPHANS makes the workers follow it.
async function runClusterFixture(fixture: string, deadlineMs: number) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, fixture)],
    env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timedOut = Bun.sleep(deadlineMs).then(() => {
    proc.kill("SIGKILL");
    return "deadline" as const;
  });
  const result = await Promise.race([Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]), timedOut]);
  if (result === "deadline") {
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    return { stdout, stderr, exitCode: null as number | null, signalCode: proc.signalCode };
  }
  const [stdout, stderr, exitCode] = result;
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

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
    const { stdout, stderr, exitCode } = await runClusterFixture("dgram-cluster-disconnect-fixture.ts", 20_000);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  // Multi-worker traffic + close: exercises the DGRAM_FDS Owned/Adopted state
  // machine and SharedHandle teardown. A regression removing the double-close
  // guard would EBADF an IPC pipe and hang this fixture.
  test("multi-worker shared socket adopts and tears down cleanly", async () => {
    // Assert the success line, not just exit 0: the fixture has bail-out paths
    // that also exit 0. 25s deadline sits between the fixture's 20s watchdog
    // and this test's own timeout so the watchdog's diagnostic reaches stderr.
    const { stdout, stderr, exitCode } = await runClusterFixture("dgram-cluster-shared-fd-fixture.ts", 25_000);
    expect(stderr).toBe("");
    // Traffic receipt is best-effort (kernel-arbitrated), teardown is the
    // contract: the success line carries received/sent for diagnostics.
    expect(stdout).toStartWith("ok: all 4 workers adopted and released the shared descriptor ");
    expect(exitCode).toBe(0);
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

// _createSocketHandle's three return shapes, from node's
// test/parallel/test-dgram-create-socket-handle.js. That file is not vendored:
// its "create a bound handle" block needs the raw-descriptor helpers, which are
// POSIX-only in Bun (see the cluster-shared dgram note in src/js/internal/dgram.ts).
test("_createSocketHandle() without an address or port returns an unbound handle", () => {
  const { _createSocketHandle, UDP } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const handle = _createSocketHandle(null, null, "udp4");

  expect(handle).toBeInstanceOf(UDP);
  expect(handle.fd).toBe(-1);
  handle.close();
});

test.skipIf(isWindows)("_createSocketHandle() binds and reports the descriptor", () => {
  const { _createSocketHandle, UDP } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const handle = _createSocketHandle("127.0.0.1", 0, "udp4");

  expect(handle).toBeInstanceOf(UDP);
  expect(handle.fd).toBeGreaterThan(0);
  handle.close();
});

test.skipIf(isWindows)("_createSocketHandle() returns a negative errno when the bind fails", () => {
  const { _createSocketHandle } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  // Not a numeric literal: the wrap binds through inet_pton, so this is EINVAL.
  const err = _createSocketHandle("localhost", 0, "udp4");

  expect(err).toBe(-22);
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

// IP_MULTICAST_TTL accepts 0 (confine multicast to the local host); IP_TTL does
// not. Bun used to apply the unicast [1,255] range to both, rejecting
// setMulticastTTL(0) with EINVAL where Node/libuv succeed.
test("setTTL/setMulticastTTL range matches Node (node:dgram)", async () => {
  const socket = createSocket("udp4");
  const { promise, resolve } = Promise.withResolvers<void>();
  socket.bind(0, "127.0.0.1", resolve);
  await promise;
  try {
    expect(socket.setMulticastTTL(0)).toBe(0);
    expect(socket.setMulticastTTL(1)).toBe(1);
    expect(socket.setMulticastTTL(255)).toBe(255);
    expect(() => socket.setMulticastTTL(-1)).toThrowWithCode(Error, "EINVAL");
    expect(() => socket.setMulticastTTL(256)).toThrowWithCode(Error, "EINVAL");

    expect(() => socket.setTTL(0)).toThrowWithCode(Error, "EINVAL");
    expect(socket.setTTL(1)).toBe(1);
    expect(socket.setTTL(255)).toBe(255);
    expect(() => socket.setTTL(256)).toThrowWithCode(Error, "EINVAL");
  } finally {
    socket.close();
  }
});

test("setTTL/setMulticastTTL range matches Node (Bun.udpSocket)", async () => {
  const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
  try {
    expect(socket.setMulticastTTL(0)).toBe(0);
    expect(socket.setMulticastTTL(1)).toBe(1);
    expect(socket.setMulticastTTL(255)).toBe(255);
    expect(() => socket.setMulticastTTL(-1)).toThrowWithCode(Error, "EINVAL");
    expect(() => socket.setMulticastTTL(256)).toThrowWithCode(Error, "EINVAL");

    expect(() => socket.setTTL(0)).toThrowWithCode(Error, "EINVAL");
    expect(socket.setTTL(1)).toBe(1);
    expect(socket.setTTL(255)).toBe(255);
    expect(() => socket.setTTL(256)).toThrowWithCode(Error, "EINVAL");
  } finally {
    socket.close();
  }
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

// Node's udp_wrap tries uv_udp_try_send first: a datagram the kernel accepts
// synchronously never becomes a uv_udp_send_t, so getSendQueueSize/Count stay
// at 0 through the callback. Only the EAGAIN → uv_udp_send fallback counts.
test("getSendQueueCount()/Size() stay 0 for a synchronously accepted send", async () => {
  const socket = createSocket("udp4");
  await new Promise<void>(resolve => socket.bind(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => socket.connect(socket.address().port, "127.0.0.1", () => resolve()));

  const { promise, resolve } = Promise.withResolvers<{ err: any; sent: number }>();
  socket.send("hello", (err, sent) => resolve({ err, sent }));
  // Connected send reaches the kernel synchronously; loopback accepts one 5-byte
  // datagram without backpressure.
  expect({ size: socket.getSendQueueSize(), count: socket.getSendQueueCount() }).toEqual({ size: 0, count: 0 });

  const { err, sent } = await promise;
  expect(err).toBeNull();
  expect(sent).toBe(5);
  expect({ size: socket.getSendQueueSize(), count: socket.getSendQueueCount() }).toEqual({ size: 0, count: 0 });
  socket.close();
});

// harness's isIPv6() reports interface addresses and is hardcoded false on
// BuildKite Linux; what this test needs is only an IPv6 *loopback* bind.
function hasIPv6Loopback() {
  if (isWindows) return false;
  const { UDP } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const probe = new UDP();
  const rc = probe.bind6("::1", 0, 0);
  probe.close();
  return rc === 0;
}

// rinfo.family reflects the packet's sockaddr, not the constructor's `type`:
// a `udp4` socket adopting an IPv6 fd receives IPv6-tagged rinfo.
test.skipIf(isWindows || !hasIPv6Loopback())(
  "rinfo.family follows the packet's sockaddr, not the socket type",
  async () => {
    const { UDP } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
    const wrap = new UDP();
    expect(wrap.bind6("::1", 0, 0)).toBe(0);

    const socket = createSocket("udp4");
    const sender = createSocket("udp6");
    try {
      const { promise: listening, resolve: onListening, reject: onListenError } = Promise.withResolvers<void>();
      const { promise: got, resolve: onMessage, reject: onSocketError } = Promise.withResolvers<any>();
      // Route every failure into whichever promise is outstanding so a lost
      // datagram surfaces as an error rather than a test-timeout hang.
      socket.on("error", err => {
        onListenError(err);
        onSocketError(err);
      });
      sender.on("error", onSocketError);
      socket.on("listening", onListening);
      socket.on("message", (_data, rinfo) => onMessage(rinfo));

      socket.bind({ fd: wrap.fd });
      await listening;

      const port = socket.address().port;
      let rinfo: any;
      let sendErr: unknown;
      // Retry so a single dropped loopback datagram surfaces as a bounded
      // failure instead of the file-level test timeout.
      for (let i = 0; i < 50 && rinfo === undefined; i++) {
        await new Promise<void>((resolve, reject) =>
          sender.send("hi", port, "::1", err => (err ? reject(err) : resolve())),
        ).catch(e => (sendErr ??= e));
        rinfo = await Promise.race([got, Bun.sleep(100)]);
      }
      if (rinfo === undefined) {
        throw new Error(`no datagram received on adopted fd (port=${port} sendErr=${sendErr ?? "(none)"})`);
      }

      expect(rinfo.family).toBe("IPv6");
      expect(rinfo.address).toBe("::1");
    } finally {
      sender.close();
      socket.close();
      wrap.close();
    }
  },
);

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
    let rinfo: any;
    for (let i = 0; i < 50 && rinfo === undefined; i++) {
      await new Promise<void>((resolve, reject) =>
        socket.send("hi", receiverPort, "127.0.0.1", err => (err ? reject(err) : resolve())),
      );
      rinfo = await Promise.race([gotRinfo, Bun.sleep(100)]);
    }
    expect(rinfo).toBeDefined();

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

// handleDrain's break-on-renewed-backpressure → resume path, its per-entry
// catch (a throwing entry completes as an error and the loop continues), and
// the running-index bookkeeping. Native send is stubbed for a deterministic
// accept/refuse/throw sequence via the same reach-in as the test above.
test("handleDrain resumes after renewed backpressure and steps past a throwing entry", async () => {
  const { kStateSymbol } = require("bun:internal-for-testing").exposedInternals["internal/dgram"];
  const socket = createSocket("udp4");
  await new Promise<void>(resolve => socket.bind(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => socket.connect(socket.address().port, "127.0.0.1", resolve));

  const handle = socket[kStateSymbol].handle;
  const realSocket = handle.socket;
  try {
    // Force the queued path: with sendQueue non-undefined every send() lands
    // behind it (handleSend's don't-jump-the-queue check).
    handle.sendQueue = [];

    const lengths = [10, 20, 30, 40];
    const fired: { i: number; err: any; sent: number }[] = [];
    const done = lengths.map((n, i) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      socket.send(Buffer.alloc(n), (err, sent) => {
        fired.push({ i, err: err?.code ?? err, sent });
        resolve();
      });
      return promise;
    });
    expect({ queued: handle.sendQueue.length, count: handle.queueCount, size: handle.queueSize }).toEqual({
      queued: 4,
      count: 4,
      size: 100,
    });

    // First drain: kernel accepts entry 0 and 1, then reports full again.
    let script: (() => boolean)[] = [() => true, () => true, () => false];
    handle.socket = { send: () => script.shift()!() };
    handle.drain();
    await Promise.all(done.slice(0, 2));
    expect(fired).toEqual([
      { i: 0, err: null, sent: 10 },
      { i: 1, err: null, sent: 20 },
    ]);
    expect({ head: handle.sendQueueHead, count: handle.queueCount, size: handle.queueSize }).toEqual({
      head: 2,
      count: 2,
      size: 70,
    });
    // Consumed slots are nulled in place until the head crosses the compaction
    // threshold; the still-queued entries stay behind them.
    expect(handle.sendQueue.map((e: any) => e?.length)).toEqual([undefined, undefined, 30, 40]);

    // Second drain: entry 2 throws (a per-entry send failure completes that
    // request as an error and the loop continues); entry 3 succeeds.
    const emsgsize = Object.assign(new Error("too big"), { code: "EMSGSIZE" });
    script = [
      () => {
        throw emsgsize;
      },
      () => true,
    ];
    handle.drain();
    await Promise.all(done);
    // Callbacks fired in FIFO send order across both drains, with entry 2's
    // throw surfacing as a decorated send error.
    expect(fired).toEqual([
      { i: 0, err: null, sent: 10 },
      { i: 1, err: null, sent: 20 },
      { i: 2, err: "EMSGSIZE", sent: undefined },
      { i: 3, err: null, sent: 40 },
    ]);
    expect({
      queue: handle.sendQueue,
      head: handle.sendQueueHead,
      count: handle.queueCount,
      size: handle.queueSize,
    }).toEqual({ queue: undefined, head: 0, count: 0, size: 0 });
  } finally {
    handle.socket = realSocket;
    socket.close();
  }
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

// A worker that calls process.exit() from the FIRST 'message' of a batch
// leaves a TerminationException pending for the rest of that poll dispatch:
// the remaining on_data iterations, the drain, and any recv error must all
// bail instead of re-entering JS. On a debug build, removing any of those
// native has_exception guards turns this into a JSC assertNoException abort.
test("a worker exiting from its first 'message' of a batch does not crash", async () => {
  const worker = new Worker(path.join(import.meta.dir, "dgram-worker-exit-in-message-fixture.ts"));
  const port = await new Promise<number>(resolve => worker.once("message", resolve));

  // The worker's exit closes its port mid-burst; ignore the resulting ICMP
  // errors on the sender (macOS raises them synchronously from send, Linux
  // queues them for a later poll) instead of letting one fail the test as an
  // uncaught socket error.
  const sender = await Bun.udpSocket({ connect: { port, hostname: "127.0.0.1" }, socket: { error() {} } });
  const exited = new Promise<number>(resolve => worker.once("exit", resolve));
  const burst = new Array(16).fill("x");
  // Keep bursting until the worker exits: one 16-packet sendMany arrives as a
  // single recvmmsg batch, so 'message' #1 exits with 15 siblings pending.
  // Bounded so a worker that never exits cannot leave an orphaned flood
  // running into the rest of the file after the test times out.
  let stop = false;
  const pump = (async () => {
    for (let i = 0; i < 1000 && !stop; i++) {
      try {
        sender.sendMany(burst);
      } catch {}
      await Bun.sleep(10);
    }
  })();

  try {
    expect(await exited).toBe(0);
  } finally {
    stop = true;
    await pump;
    sender.close();
    // Reaps the worker if it never exited (the normal path already saw its
    // 'exit'). Not awaited: terminate() after an exit never settles.
    worker.terminate();
  }
});
