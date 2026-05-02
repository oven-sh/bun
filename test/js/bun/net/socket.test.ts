import type { Socket } from "bun";
import { connect, fileURLToPath, SocketHandler, spawn } from "bun";
import { createSocketPair } from "bun:internal-for-testing";
import { describe, expect, it, jest } from "bun:test";
import { closeSync } from "fs";
import { bunEnv, bunExe, expectMaxObjectTypeCount, getMaxFD, isWindows, tempDir, tls } from "harness";
describe.concurrent("socket", () => {
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
    ).toThrow("port must be in the range [0, 65535]");
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
    expect(await stderr.text()).toBe("");
    var lines = (await stdout.text()).split(/\r?\n/);
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
      expect(await proc.stdout.text()).toContain("event loop was not killed");
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

    const [stderrText, stdoutText, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
    // stderr first so an ASAN/LSAN report isn't swallowed behind a bare "exit 134".
    expect(stderrText).toBe("");
    expect(stdoutText).toContain("CLIENT RECEIVED");
    expect(exitCode).toBe(0);
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

  it.skipIf(isWindows)("kqueue should not dispatch spurious drain events on readable", async () => {
    expect([fileURLToPath(new URL("./kqueue-filter-coalesce-fixture.ts", import.meta.url))]).toRun();
  });

  it("reload() should preserve active_connections (no UAF / counter underflow)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fileURLToPath(new URL("./socket-reload-fixture.ts", import.meta.url))],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "OK\n", exitCode: 0 });
    void stderr;
  }, 30_000);

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
            // ReferenceError: bytes is not defined
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
      expect(result?.message).toBe("bytes is not defined");
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
  }, 20_000); // only needed in debug mode
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

it("should not leak memory", async () => {
  // assert we don't leak the sockets
  // we expect 1 or 2 because that's the prototype / structure.
  // FIXME(module-loader): the C++ module map keeps the test file's module
  // record (and thus its environment / closures) alive for the lifetime of
  // the process; on Windows this pins one extra TCPSocket past GC. Widen the
  // Windows threshold by one until we can reproduce locally.
  await expectMaxObjectTypeCount(expect, "Listener", 2);
  await expectMaxObjectTypeCount(expect, "TCPSocket", isWindows ? 4 : 2);
  await expectMaxObjectTypeCount(expect, "TLSSocket", isWindows ? 4 : 2);
});

it("should not leak memory when connect() fails again", async () => {
  await expectMaxObjectTypeCount(expect, "TCPSocket", 5, 50);
});

it("should throw on empty hostname from truthy non-string value", () => {
  const socket = { data() {}, open() {}, close() {} };
  // A truthy value whose toString() returns "" should throw, not crash
  for (const hostname of [[], new String("")]) {
    expect(() => Bun.listen({ hostname: hostname as any, port: 0, socket })).toThrow('Expected a non-empty "hostname"');
    expect(() => Bun.connect({ hostname: hostname as any, port: 0, socket })).toThrow(
      'Expected a non-empty "hostname"',
    );
  }
});

it("should throw on empty unix path from truthy non-string value", () => {
  const socket = { data() {}, open() {}, close() {} };
  // unix uses a strict string type in bindgen, so non-string values are rejected before
  // reaching the empty-string check — the error message differs from hostname
  expect(() => Bun.listen({ unix: [] as any, socket })).toThrow("SocketOptions.unix must be a string");
  expect(() => Bun.connect({ unix: [] as any, socket })).toThrow("SocketOptions.unix must be a string");
});

it("reading fd of a TLS listener should not crash", () => {
  using listener = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: { data() {}, open() {}, close() {} },
    tls: { passphrase: "abc" },
  });
  expect(typeof listener.fd).toBe("number");
  expect(listener.fd).toBeGreaterThanOrEqual(0);
});

it("TLS client: flush() after end() does not double-teardown before deferred onClose", async () => {
  // `end()` on a TLS client sends close_notify and defers the raw close until the
  // peer replies, leaving `is_active` set so the eventual onClose can release the
  // Handlers. A `flush()` in that window must not re-enter markInactive and free
  // the Handlers early — when the peer's close_notify then arrives, onClose would
  // deref freed memory (ASAN heap-use-after-free). Run in a subprocess so an ASAN
  // abort surfaces as a clean test failure rather than taking down the runner.
  using dir = tempDir("tls-flush-after-end", {
    "run.ts": `
      const tls = JSON.parse(process.env.TLS_JSON!);

      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls,
        socket: {
          open() {},
          data() {},
          // reply to the client's close_notify so its deferred onClose fires
          end(s) { s.end(); },
          close() {},
          error() {},
        },
      });

      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
      const { promise: handshook, resolve: onHandshook } = Promise.withResolvers<void>();

      const client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls,
        socket: {
          handshake() { onHandshook(); },
          data() {},
          close() { onClosed(); },
          error() { onClosed(); },
        },
      });

      await handshook;
      client.end("x");
      // Previously this re-entered markInactive while the TLS raw close was
      // still deferred, freeing *Handlers before onClose ran.
      client.flush();
      client.flush();
      await closed;
      console.log("OK");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts"],
    env: { ...bunEnv, TLS_JSON: JSON.stringify(tls) },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 30_000); // debug subprocess startup + ASAN symbolication on failure is slow
