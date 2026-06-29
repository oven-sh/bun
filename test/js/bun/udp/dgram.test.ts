import { describe, expect, jest, test } from "bun:test";
import { createSocket } from "dgram";

import { bunEnv, bunExe, disableAggressiveGCScope, isIPv6, isMacOS, isWindows } from "harness";
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

// Node implicitly binds an unbound socket to a random port before a membership
// operation (libuv's deferred bind) rather than throwing "not running". The
// loopback interface is explicit so the joins don't need a multicast route.
describe("membership on an unbound socket", () => {
  const GROUP4 = "224.0.0.114";
  const SSM_GROUP4 = "232.0.0.114";
  const SSM_SOURCE4 = "127.0.0.2";
  const LO4 = "127.0.0.1";

  // Same loopback scope ids node-dgram.test.js uses for the bound-socket case.
  const LO6 = isWindows ? "::%1" : isMacOS ? "::%lo0" : "::%lo";

  test("addMembership() implicitly binds", () => {
    const socket = createSocket("udp4");
    try {
      socket.addMembership(GROUP4, LO4);
      expect(socket.address()).toMatchObject({ address: "0.0.0.0", family: "IPv4" });
      expect(socket.address().port).toBeGreaterThan(0);
      socket.dropMembership(GROUP4, LO4);
    } finally {
      socket.close();
    }
  });

  test("addSourceSpecificMembership() implicitly binds", () => {
    const socket = createSocket("udp4");
    try {
      socket.addSourceSpecificMembership(SSM_SOURCE4, SSM_GROUP4, LO4);
      expect(socket.address()).toMatchObject({ address: "0.0.0.0", family: "IPv4" });
      expect(socket.address().port).toBeGreaterThan(0);
      socket.dropSourceSpecificMembership(SSM_SOURCE4, SSM_GROUP4, LO4);
    } finally {
      socket.close();
    }
  });

  test.skipIf(!isIPv6())("addMembership() on a udp6 socket implicitly binds to [::]", () => {
    const socket = createSocket("udp6");
    try {
      socket.addMembership("ff01::1", LO6);
      expect(socket.address()).toMatchObject({ address: "::", family: "IPv6" });
      expect(socket.address().port).toBeGreaterThan(0);
      socket.dropMembership("ff01::1", LO6);
    } finally {
      socket.close();
    }
  });

  test("the implicitly bound socket can send", async () => {
    const receiver = createSocket("udp4");
    const sender = createSocket("udp4");
    try {
      const received = Promise.withResolvers<Buffer>();
      receiver.on("message", received.resolve);
      receiver.on("error", received.reject);

      const listening = Promise.withResolvers<void>();
      receiver.on("listening", listening.resolve);
      receiver.bind(0, LO4);
      await listening.promise;

      sender.addMembership(GROUP4, LO4);
      const sent = Promise.withResolvers<void>();
      sender.on("error", sent.reject);
      sender.send("via implicit bind", receiver.address().port, LO4, err => (err ? sent.reject(err) : sent.resolve()));

      await sent.promise;
      expect((await received.promise).toString()).toBe("via implicit bind");
    } finally {
      sender.close();
      receiver.close();
    }
  });

  test("an invalid multicast address does not trigger the implicit bind", () => {
    const socket = createSocket("udp4");
    try {
      expect(() => socket.addMembership("256.256.256.256")).toThrowWithCode(Error, "EINVAL");
      expect(() => socket.address()).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
    } finally {
      socket.close();
    }
  });

  test("a closed socket still throws ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const socket = createSocket("udp4");
    const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
    socket.close(onClose);
    await closed;
    expect(() => socket.addMembership(GROUP4, LO4)).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
    expect(() => socket.dropMembership(GROUP4, LO4)).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
    expect(() => socket.addSourceSpecificMembership(SSM_SOURCE4, SSM_GROUP4, LO4)).toThrowWithCode(
      Error,
      "ERR_SOCKET_DGRAM_NOT_RUNNING",
    );
    expect(() => socket.dropSourceSpecificMembership(SSM_SOURCE4, SSM_GROUP4, LO4)).toThrowWithCode(
      Error,
      "ERR_SOCKET_DGRAM_NOT_RUNNING",
    );
  });

  test("a bind() already in flight still throws ERR_SOCKET_DGRAM_NOT_RUNNING", async () => {
    const socket = createSocket("udp4");
    const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
    socket.bind(0, onListening);
    expect(() => socket.addMembership(GROUP4, LO4)).toThrowWithCode(Error, "ERR_SOCKET_DGRAM_NOT_RUNNING");
    await listening;
    socket.close();
  });
});

// "listening" is now emitted from inside dns.lookup's callback when bind()
// gets a hostname. A throw from a listener must not re-enter that callback
// as a lookup error and reset the bind state (see node-dns.test.js).
test("a throwing 'listening' listener on a hostname bind() does not corrupt the socket", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const s = require("dgram").createSocket("udp4");
      process.on("uncaughtException", () => {});
      s.on("error", e => console.log("error:" + e.message));
      s.bind(0, "localhost", () => {
        const port = s.address().port;
        setImmediate(() => {
          s.send("x", port, "127.0.0.1", () => {
            console.log(s.address().port === port ? "same-port" : "rebound");
            s.close();
          });
        });
        throw new Error("boom from the listening listener");
      });`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "same-port\n", exitCode: 0 });
});
