import type { Socket } from "bun";
import { connect, fileURLToPath, SocketHandler, spawn } from "bun";
import { createSocketPair } from "bun:internal-for-testing";
import { expect, it, jest } from "bun:test";
import { closeSync } from "fs";
import { bunEnv, bunExe, expectMaxObjectTypeCount, getMaxFD, isWindows, tls } from "harness";

it("should throw when a socket from a file descriptor has a bad file descriptor", async () => {
  const open = jest.fn();
  const close = jest.fn();
  const data = jest.fn();
  const connectError = jest.fn(() => {});
  {
    expect(
      async () =>
        await Bun.connect({
          fd: getMaxFD() + 1024,
          socket: {
            open,
            close,
            data,
            connectError,
          },
        }),
    ).toThrow();
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);
  }

  await Bun.sleep(10);
  expect(open).toHaveBeenCalledTimes(0);
  expect(close).toHaveBeenCalledTimes(0);
  expect(data).toHaveBeenCalledTimes(0);
  expect(connectError).toHaveBeenCalledTimes(1);
  connectError.mockClear();
  open.mockClear();
  close.mockClear();
  data.mockClear();
});

it.skipIf(isWindows)("should not crash when a socket from a file descriptor is closed after opening", async () => {
  const [server, client] = createSocketPair();
  const open = jest.fn();
  const close = jest.fn();
  const data = jest.fn();
  {
    const socket = await Bun.connect({
      fd: server,
      socket: {
        open,
        close,
        data,
      },
    });
    Bun.gc(true);
    await Bun.sleep(10);
    closeSync(client);
    Bun.gc(true);
  }

  await Bun.sleep(10);
  expect(open).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(data).toHaveBeenCalledTimes(0);
  open.mockClear();
  close.mockClear();
  data.mockClear();
});

it.skipIf(isWindows)(
  "should not crash when a socket from a file descriptor is already closed after opening",
  async () => {
    const [server, client] = createSocketPair();
    const open = jest.fn();
    const close = jest.fn();
    const data = jest.fn();
    closeSync(client);
    {
      const socket = await Bun.connect({
        fd: server,
        socket: {
          open,
          close,
          data,
        },
      });
      Bun.gc(true);
      await Bun.sleep(10);
      Bun.gc(true);
    }
    await Bun.sleep(10);

    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledTimes(0);
    open.mockClear();
    close.mockClear();
    data.mockClear();
  },
);

it("should coerce '0' to 0", async () => {
  const listener = Bun.listen({
    // @ts-expect-error
    port: "0",
    hostname: "localhost",
    socket: {
      open() {},
      close() {},
      data() {},
    },
  });
  listener.stop(true);
});

it("should NOT coerce '-1234' to 1234", async () => {
  expect(() =>
    Bun.listen({
      // @ts-expect-error
      port: "-1234",
      hostname: "localhost",
      socket: {
        open() {},
        close() {},
        data() {},
      },
    }),
  ).toThrow(`Expected \"port\" to be a number between 0 and 65535`);
});

it("should keep process alive only when active", async () => {
  const { exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "echo.js"],
    cwd: import.meta.dir,
    stdout: "pipe",
    stdin: null,
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await exited).toBe(0);
  expect(await new Response(stderr).text()).toBe("");
  var lines = (await new Response(stdout).text()).split(/\r?\n/);
  expect(
    lines.filter(function (line) {
      return line.startsWith("[Server]");
    }),
  ).toEqual(["[Server] OPENED", "[Server] GOT request", "[Server] CLOSED"]);
  expect(
    lines.filter(function (line) {
      return line.startsWith("[Client]");
    }),
  ).toEqual(["[Client] OPENED", "[Client] GOT response", "[Client] CLOSED"]);
});

it("connect without top level await should keep process alive", async () => {
  const server = Bun.listen({
    socket: {
      open(socket) {},
      data(socket, data) {},
    },
    hostname: "localhost",
    port: 0,
  });
  const proc = Bun.spawn({
    cmd: [bunExe(), "keep-event-loop-alive.js", String(server.port), server.hostname],
    cwd: import.meta.dir,
    env: bunEnv,
  });
  await proc.exited;
  try {
    expect(proc.exitCode).toBe(0);
    expect(await new Response(proc.stdout).text()).toContain("event loop was not killed");
  } finally {
    server.stop();
  }
});

it("connect() should return the socket object", async () => {
  const { exited, stdout, stderr } = spawn({
    cmd: [bunExe(), "connect-returns-socket.js"],
    cwd: import.meta.dir,
    stdout: "pipe",
    stdin: null,
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await exited).toBe(0);
  expect(await new Response(stderr).text()).toBe("");
});

it("listen() should throw connection error for invalid host", () => {
  expect(() => {
    const handlers: SocketHandler = {
      open(socket) {
        socket.end();
      },
      close() {},
      data() {},
    };

    Bun.listen({
      port: 4423,
      hostname: "whatishtis.com",
      socket: handlers,
    });
  }).toThrow();
});

it("should reject on connection error, calling both connectError() and rejecting the promise", done => {
  var data = {};
  connect({
    data,
    hostname: "localhost",
    port: 55555,
    socket: {
      connectError(socket, error) {
        expect(socket).toBeDefined();
        expect(socket.data).toBe(data);
        expect(error).toBeDefined();
        expect(error.name).toBe("Error");
        expect(error.code).toBe("ECONNREFUSED");
        expect(error.message).toBe("Failed to connect");
      },
      data() {
        done(new Error("Unexpected data()"));
      },
      drain() {
        done(new Error("Unexpected drain()"));
      },
      close() {
        done(new Error("Unexpected close()"));
      },
      end() {
        done(new Error("Unexpected end()"));
      },
      error() {
        done(new Error("Unexpected error()"));
      },
      open() {
        done(new Error("Unexpected open()"));
      },
    },
  }).then(
    () => done(new Error("Promise should reject instead")),
    err => {
      expect(err).toBeDefined();
      expect(err.name).toBe("Error");
      expect(err.code).toBe("ECONNREFUSED");
      expect(err.message).toBe("Failed to connect");

      done();
    },
  );
});

it("should not leak memory when connect() fails", async () => {
  await (async () => {
    // windows can take more than a second per connection
    const quantity = isWindows ? 10 : 50;
    var promises = new Array(quantity);
    for (let i = 0; i < quantity; i++) {
      promises[i] = connect({
        hostname: "localhost",
        port: 55555,
        socket: {
          connectError(socket, error) {},
          data() {},
          drain() {},
          close() {},
          end() {},
          error() {},
          open() {},
        },
      });
    }
    await Promise.allSettled(promises);
    promises.length = 0;
  })();

  await expectMaxObjectTypeCount(expect, "TCPSocket", 50, 50);
}, 60_000);

// this also tests we mark the promise as handled if connectError() is called
it("should handle connection error", done => {
  var data = {};
  connect({
    data,
    hostname: "localhost",
    port: 55555,
    socket: {
      connectError(socket, error) {
        expect(socket).toBeDefined();
        expect(socket.data).toBe(data);
        expect(error).toBeDefined();
        expect(error.name).toBe("Error");
        expect(error.message).toBe("Failed to connect");
        expect((error as any).code).toBe("ECONNREFUSED");
        done();
      },
      data() {
        done(new Error("Unexpected data()"));
      },
      drain() {
        done(new Error("Unexpected drain()"));
      },
      close() {
        done(new Error("Unexpected close()"));
      },
      end() {
        done(new Error("Unexpected end()"));
      },
      error() {
        done(new Error("Unexpected error()"));
      },
      open() {
        done(new Error("Unexpected open()"));
      },
    },
  });
});

it("should not leak memory when connect() fails again", async () => {
  await expectMaxObjectTypeCount(expect, "TCPSocket", 5, 50);
});

it("socket.timeout works", async () => {
  try {
    const { promise, resolve } = Promise.withResolvers<any>();

    var server = Bun.listen({
      socket: {
        binaryType: "buffer",
        open(socket) {
          socket.write("hello");
        },
        data(socket, data) {
          if (data.toString("utf-8") === "I have timed out!") {
            client.end();
            resolve(undefined);
          }
        },
      },
      hostname: "localhost",
      port: 0,
    });
    var client = await connect({
      hostname: server.hostname,
      port: server.port,
      socket: {
        timeout(socket) {
          socket.write("I have timed out!");
        },
        data() {},
        drain() {},
        close() {},
        end() {},
        error() {},
        open() {},
      },
    });
    client.timeout(1);
    await promise;
  } finally {
    server!.stop(true);
  }
}, 10_000);

it("should allow large amounts of data to be sent and received", async () => {
  expect([fileURLToPath(new URL("./socket-huge-fixture.js", import.meta.url))]).toRun();
}, 60_000);

it("it should not crash when getting a ReferenceError on client socket open", async () => {
  using server = Bun.serve({
    port: 0,
    hostname: "localhost",
    fetch() {
      return new Response("Hello World");
    },
  });
  {
    const { resolve, reject, promise } = Promise.withResolvers();
    let client: Socket<undefined> | null = null;
    const timeout = setTimeout(() => {
      client?.end();
      reject(new Error("Timeout"));
    }, 1000);
    client = await Bun.connect({
      port: server.port,
      hostname: server.hostname,
      socket: {
        open(socket) {
          // ReferenceError: Can't find variable: bytes
          // @ts-expect-error
          socket.write(bytes);
        },
        error(socket, error) {
          clearTimeout(timeout);
          resolve(error);
        },
        close(socket) {
          // we need the close handler
          resolve({ message: "Closed" });
        },
        data(socket, data) {},
      },
    });

    const result: any = await promise;
    expect(result?.message).toBe("Can't find variable: bytes");
  }
});

it("it should not crash when returning a Error on client socket open", async () => {
  using server = Bun.serve({
    port: 0,
    hostname: "localhost",
    fetch() {
      return new Response("Hello World");
    },
  });
  {
    const { resolve, reject, promise } = Promise.withResolvers();
    let client: Socket<undefined> | null = null;
    const timeout = setTimeout(() => {
      client?.end();
      reject(new Error("Timeout"));
    }, 1000);
    client = await Bun.connect({
      port: server.port,
      hostname: server.hostname,
      socket: {
        //@ts-ignore
        open(socket) {
          return new Error("CustomError");
        },
        error(socket, error) {
          clearTimeout(timeout);
          resolve(error);
        },
        close(socket) {
          // we need the close handler
          resolve({ message: "Closed" });
        },
        data(socket, data) {},
      },
    });

    const result: any = await promise;
    expect(result?.message).toBe("CustomError");
  }
});

it("it should only call open once", async () => {
  using server = Bun.listen({
    port: 0,
    hostname: "localhost",
    socket: {
      open(socket) {
        socket.end("Hello");
      },
      data(socket, data) {},
    },
  });

  const { resolve, reject, promise } = Promise.withResolvers();

  let client: Socket<undefined> | null = null;
  let opened = false;
  client = await Bun.connect({
    port: server.port,
    hostname: "localhost",
    socket: {
      open(socket) {
        expect(opened).toBe(false);
        opened = true;
      },
      connectError(socket, error) {
        expect().fail("connectError should not be called");
      },
      close(socket) {
        resolve();
      },
      data(socket, data) {},
    },
  });

  await promise;
  expect(opened).toBe(true);
});

it.skipIf(isWindows)("should not leak file descriptors when connecting", async () => {
  expect([fileURLToPath(new URL("./socket-leak-fixture.js", import.meta.url))]).toRun();
});

it("should not call open if the connection had an error", async () => {
  using server = Bun.listen({
    port: 0,
    hostname: "0.0.0.0",
    socket: {
      open(socket) {
        socket.end();
      },
      data(socket, data) {},
    },
  });

  const { resolve, reject, promise } = Promise.withResolvers();

  let client: Socket<undefined> | null = null;
  let hadError = false;
  try {
    client = await Bun.connect({
      port: server.port,
      hostname: "::1",
      socket: {
        open(socket) {
          expect().fail("open should not be called, the connection should fail");
        },
        connectError(socket, error) {
          expect(hadError).toBe(false);
          hadError = true;
          resolve();
        },
        close(socket) {
          expect().fail("close should not be called, the connection should fail");
        },
        data(socket, data) {},
      },
    });
  } catch (e) {}

  await Bun.sleep(50);
  await promise;
  expect(hadError).toBe(true);
});

it("should connect directly when using an ip address", async () => {
  using server = Bun.listen({
    port: 0,
    hostname: "127.0.0.1",
    socket: {
      open(socket) {
        socket.end("Hello");
      },
      data(socket, data) {},
    },
  });

  const { resolve, reject, promise } = Promise.withResolvers();

  let client: Socket<undefined> | null = null;
  let opened = false;
  client = await Bun.connect({
    port: server.port,
    hostname: "127.0.0.1",
    socket: {
      open(socket) {
        expect(opened).toBe(false);
        opened = true;
      },
      connectError(socket, error) {
        expect().fail("connectError should not be called");
      },
      close(socket) {
        resolve();
      },
      data(socket, data) {},
    },
  });

  await promise;
  expect(opened).toBe(true);
});

it("should not call drain before handshake", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  using socket = await Bun.connect({
    hostname: "www.example.com",
    tls: true,
    port: 443,
    socket: {
      drain() {
        if (!socket.authorized) {
          reject(new Error("Socket not authorized"));
        }
      },
      handshake() {
        resolve();
      },
    },
  });
  await promise;
  expect(socket.authorized).toBe(true);
});
it("upgradeTLS handles errors", async () => {
  using server = Bun.serve({
    port: 0,
    tls,
    async fetch(req) {
      return new Response("Hello World");
    },
  });
  let body = "";
  let rawBody = Buffer.alloc(0);

  for (let i = 0; i < 100; i++) {
    const socket = await Bun.connect({
      hostname: "localhost",
      port: server.port,
      socket: {
        data(socket, data) {
          rawBody = Buffer.concat([rawBody, data]);
        },
        close() {},
        error(err) {},
      },
    });

    const handlers = {
      data: Buffer.from("GET / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n"),
      socket: {
        data: jest.fn(),
        close: jest.fn(),
        drain: jest.fn(),
        error: jest.fn(),
        open: jest.fn(),
      },
    };
    expect(() =>
      socket.upgradeTLS({
        ...handlers,
        tls: {
          ca: "invalid certificate!",
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_BORINGSSL",
      }),
    );

    expect(() =>
      socket.upgradeTLS({
        ...handlers,
        tls: {
          cert: "invalid certificate!",
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_BORINGSSL",
      }),
    );

    expect(() =>
      socket.upgradeTLS({
        ...handlers,
        tls: {
          ...tls,
          key: "invalid key!",
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_BORINGSSL",
      }),
    );

    expect(() =>
      socket.upgradeTLS({
        ...handlers,
        tls: {
          ...tls,
          key: "invalid key!",
          cert: "invalid cert!",
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ERR_BORINGSSL",
      }),
    );

    expect(() =>
      socket.upgradeTLS({
        ...handlers,
        tls: {},
      }),
    ).toThrow();

    expect(handlers.socket.close).not.toHaveBeenCalled();
    expect(handlers.socket.error).not.toHaveBeenCalled();
    expect(handlers.socket.data).not.toHaveBeenCalled();
    expect(handlers.socket.drain).not.toHaveBeenCalled();
    expect(handlers.socket.open).not.toHaveBeenCalled();
    socket.end();
  }
  Bun.gc(true);
});
it("should be able to upgrade to TLS", async () => {
  using server = Bun.serve({
    port: 0,
    tls,
    async fetch(req) {
      return new Response("Hello World");
    },
  });
  for (let i = 0; i < 50; i++) {
    const { promise: tlsSocketPromise, resolve, reject } = Promise.withResolvers();
    const { promise: rawSocketPromise, resolve: rawSocketResolve, reject: rawSocketReject } = Promise.withResolvers();
    {
      let body = "";
      let rawBody = Buffer.alloc(0);
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(socket, data) {
            rawBody = Buffer.concat([rawBody, data]);
          },
          close() {
            rawSocketResolve(rawBody);
          },
          error(err) {
            rawSocketReject(err);
          },
        },
      });
      const result = socket.upgradeTLS({
        data: Buffer.from("GET / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n"),
        tls,
        socket: {
          data(socket, data) {
            body += data.toString("utf8");
            if (body.includes("\r\n\r\n")) {
              socket.end();
            }
          },
          close() {
            resolve(body);
          },
          drain(socket) {
            while (socket.data.byteLength > 0) {
              const written = socket.write(socket.data);
              if (written === 0) {
                break;
              }
              socket.data = socket.data.slice(written);
            }
            socket.flush();
          },
          error(err) {
            reject(err);
          },
        },
      });

      const [raw, tls_socket] = result;
      expect(raw).toBeDefined();
      expect(tls_socket).toBeDefined();
    }
    const [tlsData, rawData] = await Promise.all([tlsSocketPromise, rawSocketPromise]);
    expect(tlsData).toContain("HTTP/1.1 200 OK");
    expect(tlsData).toContain("Content-Length: 11");
    expect(tlsData).toContain("\r\nHello World");
    expect(rawData.byteLength).toBeGreaterThanOrEqual(1980);
  }
});

it("should not leak memory", async () => {
  // assert we don't leak the sockets
  // we expect 1 or 2 because that's the prototype / structure
  await expectMaxObjectTypeCount(expect, "Listener", 2);
  await expectMaxObjectTypeCount(expect, "TCPSocket", 2);
  await expectMaxObjectTypeCount(expect, "TLSSocket", 2);
});
