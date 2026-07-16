import type { Socket } from "bun";
import { connect, fileURLToPath, SocketHandler, spawn } from "bun";
import { createSocketPair } from "bun:internal-for-testing";
import { describe, expect, it, jest } from "bun:test";
import { closeSync } from "fs";
import {
  bunEnv,
  bunExe,
  expectMaxObjectTypeCount,
  getMaxFD,
  isWindows,
  libcPathForDlopen,
  normalizeBunSnapshot,
  tempDir,
  tls,
} from "harness";
import net from "node:net";
import { createSecureContext, connect as tlsConnect } from "node:tls";
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
  }, 60_000);

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
          code: "ERR_OSSL_PEM_NO_START_LINE",
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
          code: "ERR_OSSL_PEM_NO_START_LINE",
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
          code: "ERR_OSSL_PEM_NO_START_LINE",
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
          tls: { ...tls, ca: tls.cert },
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
  it("upgradeTLS feeds the initialData bytes captured at call time", async () => {
    const handshake = Promise.withResolvers<void>();
    const echoed = Promise.withResolvers<string>();
    const serverTls = { key: tls.key, cert: tls.cert };
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {},
        data(raw, chunk) {
          raw.upgradeTLS({
            isServer: true,
            initialData: chunk,
            get tls() {
              chunk.fill(0);
              return serverTls;
            },
            socket: {
              open() {},
              data(secure: Socket, payload: Buffer) {
                secure.write(payload);
              },
              error(_secure: Socket, err: Error) {
                handshake.reject(err);
                echoed.reject(err);
              },
              close() {
                handshake.reject(new Error("server socket closed before the echo completed"));
                echoed.reject(new Error("server socket closed before the echo completed"));
              },
            },
          } as any);
        },
        error(_raw, err) {
          handshake.reject(err);
          echoed.reject(err);
        },
        close() {},
      },
    });
    const client = await Bun.connect({
      hostname: "127.0.0.1",
      port: listener.port,
      tls: { rejectUnauthorized: false },
      socket: {
        open() {},
        handshake(socket, success, authorizationError) {
          if (!success) {
            handshake.reject(authorizationError);
            return;
          }
          handshake.resolve();
          socket.write("ping");
        },
        data(_socket, payload) {
          echoed.resolve(payload.toString());
        },
        error(_socket, err) {
          handshake.reject(err);
          echoed.reject(err);
        },
        connectError(_socket, err) {
          handshake.reject(err);
          echoed.reject(err);
        },
        close() {
          handshake.reject(new Error("client socket closed before the echo completed"));
          echoed.reject(new Error("client socket closed before the echo completed"));
        },
      },
    });
    try {
      await handshake.promise;
      expect(await echoed.promise).toBe("ping");
    } finally {
      client.end();
    }
  });
  it("does not use-after-free when upgradeTLS is called synchronously inside the open handler", async () => {
    // https://github.com/oven-sh/bun/issues/33387
    // Calling upgradeTLS from inside the socket's own open callback transfers
    // the per-connection Handlers (and its OWNS_HANDLERS free) to the raw TLS
    // twin while the in-flight open scope still holds that same pointer. The
    // scope used to free it on exit, then the twin double-freed it at GC.
    using dir = tempDir("upgrade-tls-in-open", {
      "fixture.mjs": `
import net from "node:net";

const server = net.createServer(sock => { sock.on("error", () => {}); sock.on("data", () => {}); });
await new Promise(res => server.listen(0, "127.0.0.1", res));
const port = server.address().port;

const TLS = {
  socket: { open() {}, data() {}, error() {}, close() {}, handshake() {}, end() {}, timeout() {}, drain() {} },
  tls: { rejectUnauthorized: false, servername: "localhost" },
};

let done = 0;
// The UAF fires at the first Bun.gc(true) that finalizes a raw twin whose
// handlers the open scope freed; a small workload triggers it deterministically
// (the unfixed binary segfaults well before completing).
const TOTAL = 64, CONCURRENCY = 16;

function oneCycle() {
  return new Promise(resolve => {
    let settled = false;
    const fin = () => { if (settled) return; settled = true; resolve(); };
    Bun.connect({
      hostname: "127.0.0.1", port,
      socket: {
        open(sock) {
          try {
            const result = sock.upgradeTLS(TLS);
            if (result) { const [raw, tls] = result; try { tls.end(); } catch {} try { raw.end(); } catch {} }
          } catch {}
          try { sock.end(); } catch {}
          fin();
        },
        connectError() { fin(); }, error() { fin(); }, close() { fin(); }, data() {},
      },
    });
  });
}
async function worker() { while (done < TOTAL) { done++; await oneCycle(); if (done % 8 === 0) Bun.gc(true); } }
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
Bun.gc(true); server.close();
console.log("completed", done, "cycles without crashing");
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("completed 64 cycles without crashing");
    expect(exitCode).toBe(0);
  }, 30_000); // subprocess + debug/ASAN startup is slow
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

it("reading .listener on a closed client socket does not use-after-free handlers", async () => {
  // Client-mode Handlers is heap-allocated per-connect and freed in
  // markInactive once the socket closes. `socket.listener` read
  // `handlers.mode` through the dangling pointer before the isDetached()
  // check. Run in a subprocess so the ASAN abort is observable as a
  // non-zero exit instead of killing the test runner.
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { promise: closed, resolve: onClosed } = Promise.withResolvers();
        using server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open(s) { s.end(); },
            data() {},
          },
        });
        const client = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: {
            data() {},
            close() { onClosed(); },
          },
        });
        await closed;
        server.stop(true);
        // The close callback resolves while native onClose is still on the
        // stack; markInactive (which frees the client Handlers) runs in the
        // deferred unwind after scope.exit() drains this microtask. Hop one
        // event-loop turn so the free has actually happened.
        await new Promise(r => setImmediate(r));
        console.log("listener:" + client.listener);
      `,
    ],
    env: {
      ...bunEnv,
      // llvm-symbolizer on the debug binary takes several seconds; the raw
      // ASAN report line + exit code are enough to flag the regression.
      ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:symbolize=0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("listener:undefined\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
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

it("getServername on a closed TLS socket should not crash", async () => {
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    socket: {
      data() {},
      open() {},
      close() {},
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const client = await Bun.connect({
    hostname: "127.0.0.1",
    port: listener.port,
    tls: { ...tls, rejectUnauthorized: false },
    socket: {
      data() {},
      open() {},
      handshake(socket) {
        socket.end();
      },
      close(socket) {
        // The underlying SSL* is already gone by the time close fires;
        // getServername must return undefined rather than deref a null SSL*.
        try {
          resolve(socket.getServername());
        } catch (e) {
          reject(e);
        }
      },
      error(_socket, err) {
        reject(err);
      },
    },
  });

  expect(await promise).toBeUndefined();
  expect(client.getServername()).toBeUndefined();
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
        tls: { ...tls, ca: tls.cert },
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

it("writing to an established TLS socket from another TLS client's open() does not divert either connection", async () => {
  // Proxy-style flow: an inbound TLS connection is already established, then an
  // outbound TLS client is opened and its open() callback synchronously writes a
  // status frame back to the inbound socket. The outbound socket's handshake must
  // still be sent to *its own* upstream server (so it completes and the proxy can
  // report "upstream-ready"), and the inbound client's TLS stream must only ever
  // carry the proxy's application data — never bytes belonging to the outbound
  // connection. Previously the per-loop SSL output target was not re-pointed after
  // the open() dispatch, so the outbound handshake bytes landed in the inbound
  // client's stream, corrupting its session and stalling the outbound connection.
  const { promise: clientResult, resolve: resolveClientResult } = Promise.withResolvers<{
    outcome: string;
    received: string;
  }>();

  let clientReceived = "";

  // Upstream TLS server the proxy connects out to.
  const upstream = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    socket: {
      open() {},
      data() {},
      close() {},
      error() {},
    },
  });

  let outbound: Socket | undefined;
  let inboundRequest = "";

  // Proxy: TLS server that, when the inbound client asks, opens an outbound TLS
  // connection and writes to the inbound socket from the outbound open() callback.
  const proxy = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    socket: {
      open() {},
      async data(inbound, chunk) {
        inboundRequest += chunk.toString();
        if (!inboundRequest.includes("CONNECT\n") || outbound) return;
        outbound = await Bun.connect({
          hostname: "127.0.0.1",
          port: upstream.port,
          tls: { ...tls, rejectUnauthorized: false },
          socket: {
            open() {
              // Writes to the already-established inbound TLS socket while the
              // outbound socket's own handshake has not been flushed to the wire yet.
              inbound.write("hello-from-proxy\n");
            },
            handshake(_socket, success) {
              inbound.write(success ? "upstream-ready\n" : "upstream-handshake-failed\n");
            },
            data() {},
            close() {},
            error() {},
          },
        });
      },
      close() {},
      error() {},
    },
  });

  let client: Socket | undefined;
  try {
    // Inbound client talking TLS to the proxy.
    client = await Bun.connect({
      hostname: "127.0.0.1",
      port: proxy.port,
      tls: { ...tls, rejectUnauthorized: false },
      socket: {
        open() {},
        handshake(socket) {
          socket.write("CONNECT\n");
        },
        data(_socket, chunk) {
          clientReceived += chunk.toString();
          if (clientReceived.includes("upstream-ready\n") || clientReceived.includes("upstream-handshake-failed\n")) {
            resolveClientResult({ outcome: "ok", received: clientReceived });
          }
        },
        close() {
          resolveClientResult({ outcome: "closed", received: clientReceived });
        },
        error(_socket, err) {
          resolveClientResult({ outcome: `error: ${err}`, received: clientReceived });
        },
      },
    });

    // The inbound client's TLS session stays intact (no error/close) and sees
    // exactly the proxy's two status frames, and the outbound handshake reached
    // its own upstream server — otherwise "upstream-ready" is never produced.
    expect(await clientResult).toEqual({
      outcome: "ok",
      received: "hello-from-proxy\nupstream-ready\n",
    });
  } finally {
    client?.end();
    outbound?.end();
    proxy.stop(true);
    upstream.stop(true);
  }
}, 30_000);

it("TLS mid-read boundary dispatch: writing to another TLS socket from data() does not corrupt the rest of the stream", async () => {
  // When SSL_read fills the per-loop 512KiB output buffer exactly, uSockets
  // dispatches that chunk to the data() callback mid-read and then continues
  // decrypting the rest of the same TCP read. If the callback does TLS work on
  // another socket on the same loop (here: write() to a second TLS client),
  // the per-loop ssl_read_input/offset/length and ssl_socket must be restored
  // afterwards — otherwise the remaining ciphertext is dropped and the stream
  // desyncs (bad record MAC / truncated payload).
  const BOUNDARY_CHUNK = 512 * 1024;
  const PAYLOAD_SIZE = 12 * 1024 * 1024;
  const block = Buffer.alloc(64 * 1024);
  for (let i = 0; i < block.length; i++) block[i] = i & 0xff;
  const payload = Buffer.concat(Array(PAYLOAD_SIZE / block.length).fill(block));
  const expectedHash = new Bun.CryptoHasher("sha256").update(payload).digest("hex");

  const downloadDone = Promise.withResolvers<string>();
  const sideReceived = Promise.withResolvers<void>();

  // Server that streams the 12MiB payload once the client asks for it.
  let sent = 0;
  const pump = (socket: Socket) => {
    while (sent < payload.length) {
      const written = socket.write(payload.subarray(sent, Math.min(sent + 1024 * 1024, payload.length)));
      if (written <= 0) break;
      sent += written;
    }
    socket.flush();
  };
  const payloadServer = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    socket: {
      open() {},
      data(socket) {
        pump(socket);
      },
      drain(socket) {
        pump(socket);
      },
      close() {},
      error() {},
    },
  });

  // Second TLS server + client on the same loop; the download's data() handler
  // writes to this client from inside the boundary dispatch.
  const sideServer = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    tls,
    socket: {
      open() {},
      data() {
        sideReceived.resolve();
      },
      close() {},
      error() {},
    },
  });

  let sideSocket: Socket | undefined;
  let downloadSocket: Socket | undefined;
  const hasher = new Bun.CryptoHasher("sha256");
  let receivedBytes = 0;
  let boundaryChunks = 0;
  let sideWrites = 0;

  try {
    sideSocket = await Bun.connect({
      hostname: "127.0.0.1",
      port: sideServer.port,
      tls: { ...tls, rejectUnauthorized: false },
      socket: {
        open() {},
        data() {},
        close() {},
        error() {},
      },
    });

    downloadSocket = await Bun.connect({
      hostname: "127.0.0.1",
      port: payloadServer.port,
      tls: { ...tls, rejectUnauthorized: false },
      socket: {
        open() {},
        handshake(socket) {
          socket.write("GO\n");
        },
        data(_socket, chunk) {
          hasher.update(chunk);
          receivedBytes += chunk.byteLength;

          const isBoundary = chunk.byteLength === BOUNDARY_CHUNK;
          if (isBoundary) boundaryChunks += 1;
          // Write to the second TLS socket from the boundary dispatch; if this
          // run never produces an exact 512KiB chunk, fall back to writing on
          // every data event so the re-entrancy is still exercised.
          if (isBoundary || boundaryChunks === 0) {
            sideWrites += 1;
            sideSocket!.write("ping\n");
          }

          if (receivedBytes >= PAYLOAD_SIZE) {
            downloadDone.resolve("done");
          }
        },
        close() {
          downloadDone.resolve(`closed after ${receivedBytes} bytes`);
        },
        error(_socket, err) {
          downloadDone.resolve(`error: ${err} after ${receivedBytes} bytes`);
        },
      },
    });

    expect(await downloadDone.promise).toBe("done");
    expect(receivedBytes).toBe(PAYLOAD_SIZE);
    expect(hasher.digest("hex")).toBe(expectedHash);
    expect(sideWrites).toBeGreaterThan(0);
    await sideReceived.promise;
  } finally {
    downloadSocket?.end();
    sideSocket?.end();
    payloadServer.stop(true);
    sideServer.stop(true);
  }
}, 60_000);

// Bun.connect() on a Windows named pipe takes a dedicated early branch in
// Listener.connectInner that heap-allocates a standalone Handlers block. That
// block's `.mode` must be `.client` so Handlers.markInactive() destroys it on
// close; the `.server` path does `@fieldParentPtr("handlers", ...)` expecting
// a surrounding Listener struct and would read past the standalone
// allocation (heap-buffer-overflow under ASAN) and leak the block.
describe.skipIf(!isWindows)("Bun.connect named-pipe client Handlers lifecycle", () => {
  it("open → close cleans up without reading past the Handlers allocation", async () => {
    const src = /* js */ `
      const pipe = "\\\\\\\\.\\\\pipe\\\\bun-test-connect-" + Math.random().toString(36).slice(2);

      const closed = Promise.withResolvers();
      const opened = Promise.withResolvers();

      using server = Bun.listen({
        unix: pipe,
        socket: {
          data() {},
          open(s) { s.end(); },
          close() {},
          error() {},
        },
      });

      const client = await Bun.connect({
        unix: pipe,
        socket: {
          data() {},
          open() { opened.resolve(); },
          close() { closed.resolve(); },
          error() {},
        },
      });

      await opened.promise;
      client.end();
      await closed.promise;
      server.stop(true);

      Bun.gc(true);
      console.log("OK");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
      signalCode: proc.signalCode ?? null,
    }).toMatchObject({
      stdout: "OK",
      exitCode: 0,
      signalCode: null,
    });
  });

  it("failed connect to a non-existent pipe rejects and cleans up", async () => {
    const src = /* js */ `
      const pipe = "\\\\\\\\.\\\\pipe\\\\bun-test-missing-" + Math.random().toString(36).slice(2);

      let rejected = false;
      await Bun.connect({
        unix: pipe,
        socket: {
          data() {},
          open() {},
          close() {},
          connectError() {},
          error() {},
        },
      }).catch(() => { rejected = true; });

      if (!rejected) {
        console.error("expected Bun.connect to reject for a non-existent pipe");
        process.exit(1);
      }

      Bun.gc(true);
      console.log("OK");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
      signalCode: proc.signalCode ?? null,
    }).toMatchObject({
      stdout: "OK",
      exitCode: 0,
      signalCode: null,
    });
  });
});

it("reload() backs out cleanly when a handler getter closes the socket mid-reload", async () => {
  // socket.reload() reads the new callbacks off the user object property by
  // property, so a getter can run arbitrary JS — including terminating the
  // very socket being reloaded, which releases its current handlers. The
  // reload must then back out instead of writing through the released
  // handlers, and reload() on a live socket must keep working.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        using server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open() {},
            data(s, buf) { s.write("polo"); },
            close() {},
            error() {},
          },
        });

        // 1) reload() whose "data" getter terminates the socket mid-reload.
        {
          const closed = Promise.withResolvers();
          const sock = await Bun.connect({
            hostname: "127.0.0.1",
            port: server.port,
            socket: {
              open() {},
              data() {},
              close() { closed.resolve(); },
              error() {},
            },
          });
          sock.reload({
            socket: {
              get data() {
                sock.terminate();
                return () => {};
              },
              open() {},
              drain() {},
              close() {},
              error() {},
            },
          });
          await closed.promise;
          console.log("reload-with-terminate-ok");
        }

        // 2) A normal reload() on a live socket still swaps the handlers.
        {
          const got = Promise.withResolvers();
          const closed = Promise.withResolvers();
          const sock = await Bun.connect({
            hostname: "127.0.0.1",
            port: server.port,
            socket: {
              open() {},
              data() { got.resolve("old-handler"); },
              close() { closed.resolve(); },
              error() {},
            },
          });
          sock.reload({
            socket: {
              data(_s, buf) { got.resolve(buf.toString()); },
              drain() {},
              close() { closed.resolve(); },
              error() {},
            },
          });
          sock.write("marco");
          console.log("second-reload:" + (await got.promise));
          sock.end();
          await closed.promise;
        }

        Bun.gc(true);
        console.log("DONE");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("reload-with-terminate-ok\nsecond-reload:polo\nDONE\n");
  expect(exitCode).toBe(0);
  void stderr;
});

it("node:net connect() reusing a server-accepted handle keeps the listener's handlers working", async () => {
  // A Bun.listen()-accepted socket wrapper does not own its handlers — they
  // live inside the listener. Reusing such a wrapper as the handle for an
  // outbound node:net connect must not release the listener's handlers: the
  // outbound connect gets its own handlers and works, and the listener keeps
  // accepting and dispatching new connections afterwards.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const net = require("node:net");

        // Target server for the outbound connect.
        using target = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open(s) { s.write("target-hello"); },
            data() {},
            close() {},
            error() {},
          },
        });

        // Listener whose accepted-socket wrapper is captured and reused.
        let accepted;
        let openCount = 0;
        const acceptedOpen = Promise.withResolvers();
        const acceptedClosed = Promise.withResolvers();
        const secondAccepted = Promise.withResolvers();
        using listener = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open(s) {
              openCount += 1;
              if (openCount === 1) {
                accepted = s;
                acceptedOpen.resolve();
              } else {
                s.write("second-accept");
                secondAccepted.resolve();
              }
            },
            data() {},
            close() {
              if (openCount === 1) acceptedClosed.resolve();
            },
            error() {},
          },
        });

        // First inbound connection, then the peer disconnects so the accepted
        // wrapper is left closed with no active connections on the listener.
        const firstClosed = Promise.withResolvers();
        const first = await Bun.connect({
          hostname: "127.0.0.1",
          port: listener.port,
          socket: {
            open() {},
            data() {},
            close() { firstClosed.resolve(); },
            error() {},
          },
        });
        await acceptedOpen.promise;
        first.end();
        await acceptedClosed.promise;
        await firstClosed.promise;
        await new Promise((r) => setImmediate(r));
        console.log("STEP1");

        // Reuse the closed server-accepted wrapper as the handle for an
        // outbound node:net connect.
        const outboundResult = Promise.withResolvers();
        let outboundData = "";
        const outbound = new net.Socket();
        outbound._handle = accepted;
        outbound.on("data", (d) => {
          outboundData += d.toString();
          if (outboundData.includes("target-hello")) outboundResult.resolve("connected+data");
        });
        outbound.on("error", (e) => outboundResult.resolve("error:" + (e && e.code)));
        outbound.on("close", () => outboundResult.resolve("closed:" + outboundData));
        outbound.connect(target.port, "127.0.0.1");
        console.log("STEP2:" + (await outboundResult.promise));

        // The original listener still dispatches to its own handlers.
        const verify = Promise.withResolvers();
        const verifyClient = await Bun.connect({
          hostname: "127.0.0.1",
          port: listener.port,
          socket: {
            open() {},
            data(_s, buf) { verify.resolve(buf.toString()); },
            close() {},
            error() {},
          },
        });
        await secondAccepted.promise;
        console.log("STEP3:" + (await verify.promise));

        outbound.destroy();
        verifyClient.end();
        console.log("DONE");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("STEP1\nSTEP2:connected+data\nSTEP3:second-accept\nDONE\n");
  expect(exitCode).toBe(0);
  void stderr;
});

it.concurrent("setTypeOfService validates its argument instead of asserting", async () => {
  // The unfixed native binding called JSValue::asInt32() on the raw argument,
  // which asserts isInt32() on assert builds and silently feeds garbage to
  // setsockopt on release builds. It must throw a TypeError/RangeError.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        using listener = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: { open() {}, data() {}, close() {}, error() {} },
        });
        const done = Promise.withResolvers();
        const client = await Bun.connect({
          hostname: "127.0.0.1",
          port: listener.port,
          socket: {
            open(s) {
              const results = [];
              const check = (label, fn) => {
                try {
                  fn();
                  results.push(label + "=no-throw");
                } catch (e) {
                  results.push(label + "=" + (e?.code ?? e?.constructor?.name));
                }
              };
              check("object", () => s.setTypeOfService({}));
              check("string", () => s.setTypeOfService("x"));
              check("nan", () => s.setTypeOfService(NaN));
              check("neg", () => s.setTypeOfService(-1));
              check("big", () => s.setTypeOfService(256));
              check("float", () => s.setTypeOfService(1.5));
              check("ok", () => s.setTypeOfService(0x10));
              check("get", () => {
                const v = s.getTypeOfService();
                if (!Number.isInteger(v)) throw new TypeError("not an int");
              });
              console.log(results.join("\\n"));
              done.resolve();
            },
            data() {},
            close() {},
            error(_s, e) { done.reject(e); },
            connectError(_s, e) { done.reject(e); },
          },
        });
        await done.promise;
        client.end();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), exitCode }).toEqual({
    stdout: [
      "object=ERR_INVALID_ARG_TYPE",
      "string=ERR_INVALID_ARG_TYPE",
      "nan=ERR_INVALID_ARG_TYPE",
      "neg=ERR_OUT_OF_RANGE",
      "big=ERR_OUT_OF_RANGE",
      "float=ERR_INVALID_ARG_TYPE",
      "ok=no-throw",
      "get=no-throw",
    ],
    exitCode: 0,
  });
  void stderr;
});

// initialDelay is ms; TCP_KEEPIDLE is seconds. 0 = enable SO_KEEPALIVE and
// leave the kernel-default idle. Verified via getsockopt(2) on the live fd.
it.concurrent.skipIf(isWindows)("setKeepAlive converts ms to seconds and treats 0 as success", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { dlopen, FFIType, ptr } = require("bun:ffi");
        const isDarwin = process.platform === "darwin";
        const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, {
          getsockopt: {
            args: [FFIType.int, FFIType.int, FFIType.int, FFIType.ptr, FFIType.ptr],
            returns: FFIType.int,
          },
        });
        const SOL_SOCKET = isDarwin ? 0xffff : 1;
        const SO_KEEPALIVE = isDarwin ? 0x0008 : 9;
        const IPPROTO_TCP = 6;
        // Linux TCP_KEEPIDLE = 4; Darwin names it TCP_KEEPALIVE = 0x10.
        const TCP_KEEPIDLE = isDarwin ? 0x10 : 4;
        function readIntOpt(fd, level, opt) {
          const val = new Int32Array(1);
          const len = new Uint32Array([4]);
          const rc = libc.symbols.getsockopt(fd, level, opt, ptr(val), ptr(len));
          if (rc !== 0) throw new Error("getsockopt(" + level + "," + opt + ") failed");
          return val[0];
        }
        // Darwin returns SO_KEEPALIVE as so_options & 0x0008 (= 8), Linux as 0/1.
        const readBoolOpt = (fd, level, opt) => (readIntOpt(fd, level, opt) ? 1 : 0);

        const open = Promise.withResolvers();
        using listener = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: { data() {}, open() {}, close() {}, error() {} },
        });
        await using client = await Bun.connect({
          hostname: "127.0.0.1",
          port: listener.port,
          socket: {
            data() {}, close() {},
            open: () => open.resolve(),
            error: (_s, e) => open.reject(e),
            connectError: (_s, e) => open.reject(e),
          },
        });
        await open.promise;
        const fd = client.fd;

        const out = {};
        // (a) ms -> seconds: 4000ms must land as TCP_KEEPIDLE=4.
        out.a_ret = client.setKeepAlive(true, 4000);
        out.a_keepalive = readBoolOpt(fd, SOL_SOCKET, SO_KEEPALIVE);
        out.a_keepidle = readIntOpt(fd, IPPROTO_TCP, TCP_KEEPIDLE);

        // (b) default shape: setKeepAlive(true) must report success, leave
        // SO_KEEPALIVE on, and not touch the previously-set TCP_KEEPIDLE.
        out.off_ret = client.setKeepAlive(false);
        out.off_keepalive = readBoolOpt(fd, SOL_SOCKET, SO_KEEPALIVE);
        out.b_ret = client.setKeepAlive(true);
        out.b_keepalive = readBoolOpt(fd, SOL_SOCKET, SO_KEEPALIVE);
        out.b_keepidle = readIntOpt(fd, IPPROTO_TCP, TCP_KEEPIDLE);

        // node:net on the same runtime must still write the right idle.
        const net = require("node:net");
        const srv = net.createServer(() => {});
        await new Promise(r => srv.listen(0, "127.0.0.1", r));
        const nc = net.connect(srv.address().port, "127.0.0.1");
        await new Promise((res, rej) => { nc.on("connect", res); nc.on("error", rej); });
        nc.setKeepAlive(true, 4000);
        out.net_keepidle = readIntOpt(nc._handle.fd, IPPROTO_TCP, TCP_KEEPIDLE);
        nc.destroy();
        srv.close();

        console.log(JSON.stringify(out));
        client.end();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
    out: {
      a_ret: true,
      a_keepalive: 1,
      a_keepidle: 4,
      off_ret: true,
      off_keepalive: 0,
      b_ret: true,
      b_keepalive: 1,
      b_keepidle: 4,
      net_keepidle: 4,
    },
    exitCode: 0,
  });
  void stderr;
});

it("socket handler validation errors throw instead of crashing", async () => {
  // Handlers protects its callbacks only after validation succeeds, so the
  // validation error paths must throw without tearing down a never-protected
  // Handlers (debug builds assert on the protect/unprotect balance). Run in
  // a subprocess so a panic is observable as a non-zero exit instead of
  // killing the test runner.
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        for (const socket of [{}, { data() {}, end: 123 }]) {
          for (const api of ["connect", "listen"]) {
            try {
              Bun[api]({ hostname: "localhost", port: 0, socket });
            } catch (e) {
              console.log(api + ":" + e.message);
            }
          }
        }
        Bun.gc(true);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe(
    'connect:Expected at least "data" or "drain" callback\n' +
      'listen:Expected at least "data" or "drain" callback\n' +
      'connect:Expected "onEnd" callback to be a function\n' +
      'listen:Expected "onEnd" callback to be a function\n',
  );
  expect(exitCode).toBe(0);
  void stderr;
});

// https://bun-p9.sentry.io/issues/7573683042/ (BUN-3PK7)
it("socket handler validation errors don't steal GC protection from live sockets sharing the same callbacks", async () => {
  // node:net passes one module-level handler table to every connection, so
  // every live socket protects the same JSFunction identities. A Handlers
  // dropped on a validation error before protect() ran must not gcUnprotect
  // those shared functions, or GC collects them while a live socket's
  // Handlers still points at the freed cells and the socket's finalizer
  // later dereferences cell->vm() inside Bun__JSValue__unprotect.
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let listener;
        let errors = 0;
        (function setup() {
          // Function expressions (not declarations) so this IIFE is their
          // only JS root; once setup() returns, the listener's Handlers'
          // gcProtect is the sole thing keeping them alive.
          const open = function (s) { s.write("hello"); };
          const close = function () {};
          const data = function (s) { s.end(); };
          const drain = function () {};
          const error = function () {};
          const handshake = function () {};

          listener = Bun.listen({
            hostname: "127.0.0.1",
            port: 0,
            socket: { open, close, data, drain, error, handshake },
          });

          // Each validation error drops a Handlers whose open/close/data/
          // drain/error/handshake slots were assigned from the shared
          // functions but never protect()ed. On an unguarded build each
          // such drop issues one gcUnprotect per shared callback and the
          // first one zeroes the listener's protection.
          for (let i = 0; i < 4; i++) {
            for (const api of ["connect", "listen"]) {
              try {
                Bun[api]({
                  hostname: "127.0.0.1",
                  port: api === "connect" ? listener.port : 0,
                  socket: { open, close, data, drain, error, handshake, session: 1 },
                });
              } catch { errors++; }
            }
          }
        })();
        console.log("errors=" + errors);

        // No JS roots remain for the shared callbacks; if protection was
        // stolen they are now collectible.
        for (let i = 0; i < 20; i++) Bun.gc(true);

        // The listener's Handlers still holds the shared callbacks; they
        // must be live for open -> data -> end to round-trip.
        const { promise, resolve, reject } = Promise.withResolvers();
        Bun.connect({
          hostname: "127.0.0.1",
          port: listener.port,
          socket: {
            open() {},
            data(s, b) { resolve(b.toString()); s.end(); },
            close() {},
            error(_s, e) { reject(e); },
            connectError(_s, e) { reject(e); },
          },
        }).then(s => { s; }, reject);
        console.log("received=" + (await promise));

        // And they must survive the listener's own teardown.
        listener.stop(true);
        listener = null;
        for (let i = 0; i < 20; i++) Bun.gc(true);
        console.log("done");
      `,
    ],
    env: { ...bunEnv, ...(isWindows ? {} : { Malloc: "1" }) },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("errors=8\nreceived=hello\ndone\n");
  expect(exitCode).toBe(0);
  void stderr;
});

describe("TLS rejectUnauthorized", () => {
  // Regenerate with: openssl req -x509 -newkey rsa:2048 -nodes -days 3650 for
  // each CA, then sign two "localhost" leaves (SAN localhost,127.0.0.1,::1):
  // one by CA_CRT (SERVER_*) and one by a second, untrusted CA (ROGUE_*).
  const CA_CRT = `-----BEGIN CERTIFICATE-----
MIIDHTCCAgWgAwIBAgIUdYbBJxXcjPYUU84754Rvyby/Wl8wDQYJKoZIhvcNAQEL
BQAwHjEcMBoGA1UEAwwTQnVuLVRlc3QtVHJ1c3RlZC1DQTAeFw0yNjA3MDkxMzA5
NTFaFw0zNjA3MDYxMzA5NTFaMB4xHDAaBgNVBAMME0J1bi1UZXN0LVRydXN0ZWQt
Q0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCTEqxdtRmWWEJejm0F
ZpClpYe2/xnRA1YV/aH/mEeDF47MjYHYwN3htbjd6B0JFk9UhWKoiKuHyLlr6Pu9
H1f2H4gAaqdkjbRJApXTk1AkDrJE2jZ+0CkMeycplpyjiQRqn0iUrUlbfNm97Wj/
rx98s0VIS62YYx7z5svBkrxdCmTo8eVZHBgGRcMy9npqJC2t9DdYBWbqjeZCyQsb
DRrJ46EF5anE1VkNtF6lX13rkjHY7syB+fVKfLFWcGgQCDyd14Ltb3myrfYdKsnZ
z1wtUDgw1AE80MmatcH3N6ev7bOu68OAsZb3D9i5Ngfs0hUdqhTtUQztkfK3J63m
5fVZAgMBAAGjUzBRMB0GA1UdDgQWBBQ+Ub20vshUFo+vQrymr9MLIh2NQDAfBgNV
HSMEGDAWgBQ+Ub20vshUFo+vQrymr9MLIh2NQDAPBgNVHRMBAf8EBTADAQH/MA0G
CSqGSIb3DQEBCwUAA4IBAQBzuL3k1AeP6WIsZp1ZsYWeC0VItwJXDKWItV5QlsX+
JysjqMmEmJk55f54gpDdwdovgtqHNSZ6tXMBCLEqm7EQAT17IeUP5jhMy2vhePbp
WU6KmAGYdack4r9oBk0bEUty/MfeH+poXDCBbZ6i010SEczDZt3X4NnmHHc50dMu
wNApO7EeiZVjHOzVLpUqM7YMtRiz4QdI5dydNZeB7R6oIM2o0Hx43tE9mZzFOuKb
KsbVnnD+mVj0e399Y+XxJ58eEvj/QVpYciLKBEvS9fREGbJ9EV7Pf3hy32WY26An
X9IuLMOkTY4boCoNf5Azw3IPnOCAt1tavdI2ChtYc4fF
-----END CERTIFICATE-----`;

  const SERVER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCf80SxHGevvLZP
ft7aHBHugflXvvX8ieCaVUtn/f8vhDuhs5UyZDrI64xW4ij5eBSteK7JbPY3BGgU
tzjzsZVR8v0W7Fsqbkd0NL08HKp7jaHcVhgMjNKWHIqzgr/f9lRnLdXfzrr2JG//
WApHevnNF1TpJJJ604uKkk5HmZcpqdwXgdJeBG1ZEc1pEe6EDUmQQXh4f4J8rmsu
8CvTVQXeKunZnawhVsY7dKkvH27wBKfOwuafM3q2SnrVqVJfaWN0sdRi7H75PrMl
Y358AGuxs/AeZ1IUV2XxpYjNI7gEtlK7Dv0kOxSTpJuVLd1J4Z9Sn6pr3MAUEHUz
nMCtYNP1AgMBAAECggEABNH49PltKn+eYuDo6FvGMpDaKcnIcfbZvOzrG9Qst4rd
nS7jRSR+HQX0Mb4ZDAORY/TqF4ngFaJdXJp07eshG9odxG4VBT9Tie348fHPNW/8
O76gdOhdhEaR63z6OU6cFovsERWSzs4kTeaiUKslEggs9+WxQGBVqTRlhYTcaFX4
39ad0B0MF1bWDFyHhhzzDRMlIEAiIDNs00sTPEPcCFlWBSsuF2MdzO+bWtS76mhI
JXJJlZe5SeteiudJXjDkpGzpDF32MHRj1Io591o7eYM97NuibxubKngnVArrOb2U
pBbrFptvhZOdpQ+4vUVnzM3EBjOND05h0wmP9b8xdQKBgQDaOHESKhT9CssLMCEp
kOehOLS8ZhsJdTH4GK8iQYAbshZ7T1d0AP+rkN2vs9f0eHqWngFCvDtatixfYFJj
DVW9EgHUVGhvg09PtUJPa3e8lgnx8kr5+4/Pgh3Rs3qBQZFFJf7Z4RKyDjUz9j8O
mL5YihOP5xVp4goCMYH/U5LrjwKBgQC7pEipjejuYE2UDVAvSOT0r2gn3VgcLYXo
jzPgkMhNkFus0nJi09Zd7reZ5Qmur4J6N9RNL6ob5hu21nKCP4HZSPN4kU0orsNp
BVCwWb5ehG8WqFgPrCcVEJtQamHjVLvAgEBVW3Vc0PxnJOml/fvc20TVsc/bl9l0
QANLWzXWOwKBgQCJ96Ntg5OvhJJpKW3eFNKNuQd0Ee5IJYOJQzn/I4B2gjr6jWhS
XItJEpdGjiMcWsvOzGkpo063hHQ7fO+51mV925OyhgddcZzEXWpmQiD657Wz9ad3
s5fx72cg/SOX8zeAi4w8frPORXNXvfmSJfo6ilnh4o1EW3hOeLSjFFjQewKBgQCM
qFbLuxQb9NbSn7Q27darUP2rvHG7Fajmrso9kWqFMix2fX6/dHqiCTtaQmWiq/AL
++PKRGuo5DJsOY628jI9FkFkZM9JKtBS3mgg+fUJVw8LFgCFJxBY6wzyF/zu82qW
n80Z7ygn/oTmMLZw9tYhNcEAy3y76LVaPk355BKUVwKBgAdhDA9DIFzpvIygaZId
5vbz7dRYQ5MnLT48DxUko33q7+qPQagZltFl+ICBPhVQ10FP1wpNJwPs0ap/XVlB
+wDT5l7WNe2r/XqkI9cwQtZHy+TLwFRygb9ko44wLoNKdYgPEHordKeyGXQQlt3Y
q7gf9VyYyWX6rkRsx/MV6hLf
-----END PRIVATE KEY-----`;

  const SERVER_CRT = `-----BEGIN CERTIFICATE-----
MIIDMDCCAhigAwIBAgIULV6Pt6CN+GC7Hhr9gkO1wFmEeIAwDQYJKoZIhvcNAQEL
BQAwHjEcMBoGA1UEAwwTQnVuLVRlc3QtVHJ1c3RlZC1DQTAeFw0yNjA3MDkxMzA5
NTFaFw0zNjA3MDYxMzA5NTFaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBAJ/zRLEcZ6+8tk9+3tocEe6B+Ve+9fyJ
4JpVS2f9/y+EO6GzlTJkOsjrjFbiKPl4FK14rsls9jcEaBS3OPOxlVHy/RbsWypu
R3Q0vTwcqnuNodxWGAyM0pYcirOCv9/2VGct1d/OuvYkb/9YCkd6+c0XVOkkknrT
i4qSTkeZlymp3BeB0l4EbVkRzWkR7oQNSZBBeHh/gnyuay7wK9NVBd4q6dmdrCFW
xjt0qS8fbvAEp87C5p8zerZKetWpUl9pY3Sx1GLsfvk+syVjfnwAa7Gz8B5nUhRX
ZfGliM0juAS2UrsO/SQ7FJOkm5Ut3Unhn1KfqmvcwBQQdTOcwK1g0/UCAwEAAaNw
MG4wLAYDVR0RBCUwI4IJbG9jYWxob3N0hwR/AAABhxAAAAAAAAAAAAAAAAAAAAAB
MB0GA1UdDgQWBBTfIEZmI/+0PcpH+jHkfBQc9jNOVzAfBgNVHSMEGDAWgBQ+Ub20
vshUFo+vQrymr9MLIh2NQDANBgkqhkiG9w0BAQsFAAOCAQEADLkbKVP3W+RYFYIg
A0bfgJrQ1MhebrYk4W95BktNKRHuYE+22Nao8ZJcWXASNAoj++8Z03Be3fY0jHVn
rY7Fd4p0u0J/IpNfOBbzeT17HvrXQ9cUi7CtaStBKmDpkl1NVmoJNBzwpUISDH/T
mlWKKg3D5qG0H+RTOAgxDKmc6+fZWt5v/TgQq5hc1NB2WoZAk52uhRD0V7hhfmPy
ZMdsndROjusArt/+ACRYcGN8g+aoON1RUq1lYeefb2uGtWk3AKd9+nsqTUQsPB/V
aJSYfdU6MExCjVaib8zV8hjA0hCU0kQ0PlVvPrQkMn3RPhPwRzixLWrIuI4hz9sB
sm8N1g==
-----END CERTIFICATE-----`;

  const ROGUE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQCN6OeCnDUVF9dC
ouDNaM8hhpuK4NBm51XN+nm79zEAKTYjoW1j8zFZYfb03dCuYqVQ0rxlvHUFrEm1
/oOmcDbKHm0VjGN9xkhvfcTRvMcoKW52r3WwRCSLFkYFw+SvFFrtvC9zxpojtFLx
YY1rfBrnOeCsC34B9Jjb50ioyQcP+aMAy8AUFbBd2+gpslkDuMzFigLkWxXV/6dP
ta1ZjUOsAjbebGlZ78tSfhVEWpXudnH73y1Wj6hCIg9gdggfDwLqOu0mZa8/+3M7
TvR5hDstzUOx7I+Q48I7g/du/BIn8CNDRWqWbtz1jPNIJc8g7OnuMsvvZqWgQG7a
5bxBWUHtAgMBAAECggEAEo+wGElOOCASK8kaFkPrM7tjhNq653rColpsqcU/R4Ic
brSiljws7EAACS8qKGUGsned5MCtnbxXN9K+bXqn7+/i3LqsGLtiphKRN821Tu98
X1G71v5SuU6EgiSJOM00x3uhyUbkyl6/qorT8IcfDbdoR5iJNsBDbh/mRQ1mOxR9
9hoIv5UGsKTYqzm2v4y/W0MITpfp9NyrmExrvg52q20fAQJsGzLhY6mv/HpAbiWx
dhXuKKDK2kYiv4/5CRgZxDsVbBODTDlwlRTQibZuzFGUxbOjdXJiFS/CxuiggL5L
x6OgQxLCmlx3gJSWyd1y2YQUfqwio2IvROkMJgYngQKBgQDFE6af59JwfKAZfQjj
1/CWmg/nvbJId+kCBeRReDPEG4PZVn/iMYQ9U8HMtIGJmR1qPkS479zIhmt3loM8
LEqLmAB+MUhLBr9w0Ww6E1NOvZYl188DKCHlkyWIgZxLulqcOgpaetZZ1LJGADDJ
MOtHMih0f14M2lcIPcvvDClPCQKBgQC4Vr8kbNY8PwXF1RZYV/8x/Q4/avuwrJ0k
e6Gxk9/eHolIcU276QSQTut66KiFVUjLqNXwFX+FsHRh3L3bzfCzKP1XNdVgaKMy
mYIJpPAK0XF/1F5/1WjhFyvnQws3Ro6VUDT5Nefm9lrM6AdwTUvq6yObU9KP8pCQ
VPAyxn/wxQKBgG3K39ZQEWYHmC37AZvlrqxIUjoZ7Zv/6bjtzWAx5i0H4zGOxhoe
2fxMkDhaC5y7x65r2F9rigXRFUf/e0dnqXQRj5y+GfdqX/cbRP8pywygBGk6zKKG
ljPPAWcGRivOOzK0BxaXPpm3LEZhTsyXS0xTvkQAvUXN0hTOULHxhYX5An8qe9OR
kYPOXrf14CZGNgGag7fE5eMb1KxivBuH0YzGpEL/bx17MTjcCVQ7/2LXV9BvH3ou
2sWJCiHIbBdVkSDoKYo5jy6eCX+TKc3OazTnSV3fGBKvY3/IYI69vbXYB2rU/qc2
yDWqBRzoHJGaUDYu7gJGygq9IiovGWRCT30tAoGAZQsZvzJnXtHwuSOqvAdKbddX
2skPfTcFExiX1IB5mGO3hflMWIOSN3hHyR59QxKWKbDqecfa3MJBkUGhrmNZD2Sj
/5X6E7YRbJWdP9yYSc39/2KOQMM1vKYuS6ggQcgdKWcLlrRP1VXI7xX/BEZ/K2hw
TEdUSMbWShRVjPciMwU=
-----END PRIVATE KEY-----`;

  const ROGUE_CRT = `-----BEGIN CERTIFICATE-----
MIIDLjCCAhagAwIBAgIUCD6d9Di7zLh2+19ZFKkuuU/oxMgwDQYJKoZIhvcNAQEL
BQAwHDEaMBgGA1UEAwwRQnVuLVRlc3QtUm9ndWUtQ0EwHhcNMjYwNzA5MTMwOTUx
WhcNMzYwNzA2MTMwOTUxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCN6OeCnDUVF9dCouDNaM8hhpuK4NBm51XN
+nm79zEAKTYjoW1j8zFZYfb03dCuYqVQ0rxlvHUFrEm1/oOmcDbKHm0VjGN9xkhv
fcTRvMcoKW52r3WwRCSLFkYFw+SvFFrtvC9zxpojtFLxYY1rfBrnOeCsC34B9Jjb
50ioyQcP+aMAy8AUFbBd2+gpslkDuMzFigLkWxXV/6dPta1ZjUOsAjbebGlZ78tS
fhVEWpXudnH73y1Wj6hCIg9gdggfDwLqOu0mZa8/+3M7TvR5hDstzUOx7I+Q48I7
g/du/BIn8CNDRWqWbtz1jPNIJc8g7OnuMsvvZqWgQG7a5bxBWUHtAgMBAAGjcDBu
MCwGA1UdEQQlMCOCCWxvY2FsaG9zdIcEfwAAAYcQAAAAAAAAAAAAAAAAAAAAATAd
BgNVHQ4EFgQUl5rCgVO/Wjb8QhyZnBLOwGvPZwYwHwYDVR0jBBgwFoAUimhDnL/h
FghNe5jeHKjRB6WbMF0wDQYJKoZIhvcNAQELBQADggEBAAVb8clHFZpkZF72j2u0
ulIQksCH4gSa5zamjsisnSlEh8j6jG4h8C5hGmGEh/zzHYKirR+Hqs8aiLA4BHlJ
mq2rP5gsSMPO1wkeu6ZOFIXsPKA7Tb2ZhNzL0W+xz4e9bbAXE9vSZQggQ2KstokV
uNg9oyZD5BBxvUGt3ZHSUu2k14HDhSyMnAEADTOAk4u28QxLaPcI7tyZ56Qy1Byf
UqDL36Xlwc8WG6xdgc3sU3oxGpqNx5Gb/nK2Oql+P8QDXBj2Ak2r5FtyuvzD0JZ4
ijlBfSKvj17k9aaZj8NI7cU/f1DhdxDutQgxZyikanCO3hOzoaNc6CiSQacYgEOm
Reo=
-----END CERTIFICATE-----`;

  const UNTRUSTED_MESSAGE = "unable to verify the first certificate";

  // https://github.com/oven-sh/bun/issues/33846
  describe.concurrent("Bun.connect (server certificate)", () => {
    async function connectTo(serverTls: { key: string; cert: string }, clientTls: Record<string, unknown> | boolean) {
      const received: string[] = [];
      const errors: Error[] = [];
      const handshake = Promise.withResolvers<{
        authorizedArg: boolean;
        authorizedGetter: boolean;
        callbackError: string | null;
        getterError: string | null;
      }>();
      const closed = Promise.withResolvers<void>();
      const echoed = Promise.withResolvers<void>();

      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: serverTls,
        socket: {
          open() {},
          handshake(socket) {
            socket.write("hello-from-server\n");
          },
          data(socket, data) {
            socket.write(data);
          },
          close() {},
          error() {},
        },
      });

      let client: Bun.Socket;
      try {
        client = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          tls: clientTls as Bun.TLSOptions,
          socket: {
            open() {},
            handshake(socket, authorized, authorizationError) {
              handshake.resolve({
                authorizedArg: authorized,
                authorizedGetter: socket.authorized,
                callbackError: authorizationError?.message ?? null,
                getterError: socket.getAuthorizationError()?.message ?? null,
              });
            },
            data(_socket, data) {
              received.push(data.toString());
              if (received.join("").includes("ping")) echoed.resolve();
            },
            close() {
              closed.resolve();
            },
            error(_socket, err) {
              errors.push(err);
              handshake.reject(err);
              echoed.reject(err);
            },
            connectError(_socket, err) {
              handshake.reject(err);
              closed.reject(err);
              echoed.reject(err);
            },
          },
        });
      } catch (e) {
        server.stop(true);
        throw e;
      }

      // Reject-path tests observe the error via `errors[]` and never await
      // `echoed`; swallow here so that rejection is not unhandled.
      echoed.promise.catch(() => {});

      return {
        server,
        client,
        received,
        errors,
        handshake,
        closed,
        echoed,
        [Symbol.dispose]() {
          client.end();
          server.stop(true);
        },
      };
    }

    it("closes a connection whose server certificate is not trusted", async () => {
      using t = await connectTo({ key: ROGUE_KEY, cert: ROGUE_CRT }, { ca: CA_CRT });
      expect(await t.handshake.promise).toEqual({
        authorizedArg: true,
        authorizedGetter: false,
        callbackError: UNTRUSTED_MESSAGE,
        getterError: UNTRUSTED_MESSAGE,
      });
      await t.closed.promise;
      expect(t.received).toEqual([]);
      // The verdict must stay readable after the forced close.
      expect(t.client.getAuthorizationError()?.message).toBe(UNTRUSTED_MESSAGE);
    });

    it("closes an untrusted connection with tls: true", async () => {
      using t = await connectTo({ key: ROGUE_KEY, cert: ROGUE_CRT }, true);
      expect(await t.handshake.promise).toEqual({
        authorizedArg: true,
        authorizedGetter: false,
        callbackError: UNTRUSTED_MESSAGE,
        getterError: UNTRUSTED_MESSAGE,
      });
      await t.closed.promise;
      expect(t.received).toEqual([]);
    });

    it("reports authorized=false but keeps the connection with rejectUnauthorized: false", async () => {
      using t = await connectTo({ key: ROGUE_KEY, cert: ROGUE_CRT }, { ca: CA_CRT, rejectUnauthorized: false });
      expect(await t.handshake.promise).toEqual({
        authorizedArg: true,
        authorizedGetter: false,
        callbackError: UNTRUSTED_MESSAGE,
        getterError: UNTRUSTED_MESSAGE,
      });
      t.client.write("ping");
      await t.echoed.promise;
      expect(t.received.join("")).toBe("hello-from-server\nping");
      expect(t.errors).toEqual([]);
    });

    it("closes an untrusted connection upgraded with only a secureContext", async () => {
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("hello-from-server\n");
          },
          data(socket, data) {
            socket.write(data);
          },
          close() {},
          error() {},
        },
      });

      const received: string[] = [];
      const handshake = Promise.withResolvers<{ authorized: boolean; error: string | null }>();
      const closed = Promise.withResolvers<void>();

      using tcp = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: { data() {}, close() {}, error() {} },
      });
      const { context } = createSecureContext({ ca: CA_CRT }) as any;
      const [raw, secure] = tcp.upgradeTLS({
        secureContext: context,
        socket: {
          handshake(socket: Socket, _success: boolean, authorizationError: Error | null) {
            handshake.resolve({
              authorized: socket.authorized,
              error: authorizationError?.message ?? null,
            });
          },
          data(_socket: Socket, data: Buffer) {
            received.push(data.toString());
          },
          close() {
            closed.resolve();
          },
          error() {},
        },
      } as any);
      using _raw = raw;
      using _secure = secure;

      expect(await handshake.promise).toEqual({ authorized: false, error: UNTRUSTED_MESSAGE });
      await closed.promise;
      expect(received).toEqual([]);
    });

    it("closes an untrusted connection upgraded with tls: true", async () => {
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("hello-from-server\n");
          },
          data(socket, data) {
            socket.write(data);
          },
          close() {},
          error() {},
        },
      });

      const received: string[] = [];
      const handshake = Promise.withResolvers<{ authorized: boolean; error: string | null; rawWrite: number }>();
      const closed = Promise.withResolvers<void>();

      using tcp = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: { data() {}, close() {}, error() {} },
      });
      const [raw, secure] = tcp.upgradeTLS({
        tls: true,
        socket: {
          handshake(socket: Socket, _success: boolean, authorizationError: Error | null) {
            handshake.resolve({
              authorized: socket.authorized,
              error: authorizationError?.message ?? null,
              // The raw twin shares the fd: its writes must refuse too.
              rawWrite: raw.write("must-not-reach-the-peer"),
            });
          },
          data(_socket: Socket, data: Buffer) {
            received.push(data.toString());
          },
          close() {
            closed.resolve();
          },
          error() {},
        },
      } as any);
      using _raw = raw;
      using _secure = secure;

      expect(await handshake.promise).toEqual({ authorized: false, error: UNTRUSTED_MESSAGE, rawWrite: -1 });
      await closed.promise;
      expect(received).toEqual([]);
    });

    it("keeps a connection whose server certificate is trusted", async () => {
      using t = await connectTo({ key: SERVER_KEY, cert: SERVER_CRT }, { ca: CA_CRT });
      expect(await t.handshake.promise).toEqual({
        authorizedArg: true,
        authorizedGetter: true,
        callbackError: null,
        getterError: null,
      });
      t.client.write("ping");
      await t.echoed.promise;
      expect(t.received.join("")).toBe("hello-from-server\nping");
    });

    it("closes an untrusted connection when no handshake callback is provided", async () => {
      const opened = Promise.withResolvers<{ authorized: boolean; error: string | null }>();
      const closed = Promise.withResolvers<void>();
      const received: string[] = [];
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("hello-from-server\n");
          },
          data() {},
          close() {},
          error() {},
        },
      });
      const errors: Error[] = [];
      using client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { ca: CA_CRT },
        socket: {
          open(socket) {
            opened.resolve({
              authorized: socket.authorized,
              error: socket.getAuthorizationError()?.message ?? null,
            });
          },
          data(_socket, data) {
            received.push(data.toString());
          },
          close() {
            closed.resolve();
          },
          error(_socket, err) {
            errors.push(err);
            opened.reject(err);
          },
          connectError(_socket, err) {
            opened.reject(err);
            closed.reject(err);
          },
        },
      });
      expect(await opened.promise).toEqual({ authorized: false, error: UNTRUSTED_MESSAGE });
      await closed.promise;
      expect(received).toEqual([]);
      expect(errors.map(e => e.message)).toEqual([UNTRUSTED_MESSAGE]);
    });

    it("delivers the verify error through error/close when rejectUnauthorized closes the connection (no handshake callback)", async () => {
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: { open() {}, data() {}, close() {}, error() {} },
      });
      using _client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: true,
        socket: {
          open() {
            events.push("open");
          },
          data() {
            events.push("data");
          },
          error(_socket, err) {
            events.push(`error:${(err as any)?.code}:${err?.message}`);
          },
          connectError(_socket, err) {
            events.push(`connectError:${(err as any)?.code}`);
            closed.resolve();
          },
          close(_socket, err) {
            events.push(`close:${(err as any)?.code}:${(err as any)?.message}`);
            closed.resolve();
          },
        },
      });
      await closed.promise;
      expect(events).toEqual([
        "open",
        `error:UNABLE_TO_VERIFY_LEAF_SIGNATURE:${UNTRUSTED_MESSAGE}`,
        `close:UNABLE_TO_VERIFY_LEAF_SIGNATURE:${UNTRUSTED_MESSAGE}`,
      ]);
    });

    it("delivers the verify error through error/close when rejectUnauthorized closes the connection (with handshake callback)", async () => {
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: { open() {}, data() {}, close() {}, error() {} },
      });
      using _client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { ca: CA_CRT },
        socket: {
          handshake(_socket, authorized, err) {
            events.push(`handshake:${authorized}:${(err as any)?.code}`);
          },
          data() {
            events.push("data");
          },
          error(_socket, err) {
            events.push(`error:${(err as any)?.code}:${err?.message}`);
          },
          connectError(_socket, err) {
            events.push(`connectError:${(err as any)?.code}`);
            closed.resolve();
          },
          close(_socket, err) {
            events.push(`close:${(err as any)?.code}:${(err as any)?.message}`);
            closed.resolve();
          },
        },
      });
      await closed.promise;
      expect(events).toEqual([
        "handshake:true:UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        `error:UNABLE_TO_VERIFY_LEAF_SIGNATURE:${UNTRUSTED_MESSAGE}`,
        `close:UNABLE_TO_VERIFY_LEAF_SIGNATURE:${UNTRUSTED_MESSAGE}`,
      ]);
    });

    it("delivers the verify error to close (not uncaughtException) when no error handler is defined", async () => {
      const script = `
        const events = [];
        process.on("uncaughtException", e => events.push("uncaught:" + e?.code));
        using server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          tls: { key: process.env.ROGUE_KEY, cert: process.env.ROGUE_CRT },
          socket: { open() {}, data() {}, close() {}, error() {} },
        });
        const closed = Promise.withResolvers();
        await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          tls: true,
          socket: {
            handshake(_s, authorized, err) {
              events.push("handshake:" + authorized + ":" + err?.code);
            },
            data() {},
            close(_s, err) {
              events.push("close:" + err?.code);
              closed.resolve();
            },
          },
        });
        await closed.promise;
        await new Promise(r => setImmediate(r));
        console.log(JSON.stringify(events));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, ROGUE_KEY, ROGUE_CRT },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ events: JSON.parse(stdout.trim()), stderr: normalizeBunSnapshot(stderr), exitCode }).toEqual({
        events: ["handshake:true:UNABLE_TO_VERIFY_LEAF_SIGNATURE", "close:UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
        stderr: "",
        exitCode: 0,
      });
    });

    it("delivers the hostname-mismatch error through error/close when rejectUnauthorized closes the connection", async () => {
      const events: string[] = [];
      const closed = Promise.withResolvers<void>();
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: SERVER_KEY, cert: SERVER_CRT },
        socket: { open() {}, data() {}, close() {}, error() {} },
      });
      using _client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { ca: CA_CRT, serverName: "wrong.example.com" },
        socket: {
          open() {
            events.push("open");
          },
          data() {
            events.push("data");
          },
          error(_socket, err) {
            events.push(`error:${(err as any)?.code}`);
          },
          connectError(_socket, err) {
            events.push(`connectError:${(err as any)?.code}`);
            closed.resolve();
          },
          close(_socket, err) {
            events.push(`close:${(err as any)?.code}`);
            closed.resolve();
          },
        },
      });
      await closed.promise;
      expect(events).toEqual(["open", "error:ERR_TLS_CERT_ALTNAME_INVALID", "close:ERR_TLS_CERT_ALTNAME_INVALID"]);
    });

    it("refuses writes issued from the handshake callback of a rejected connection", async () => {
      const serverReceived: string[] = [];
      const handshake = Promise.withResolvers<number>();
      const closed = Promise.withResolvers<void>();
      const serverClosed = Promise.withResolvers<void>();
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: {
          open() {},
          data(_socket, data) {
            serverReceived.push(data.toString());
          },
          close() {
            serverClosed.resolve();
          },
          error() {},
        },
      });
      const errors: Error[] = [];
      using client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { ca: CA_CRT },
        socket: {
          open() {},
          handshake(socket) {
            handshake.resolve(socket.write("token-that-must-never-reach-a-mitm"));
          },
          data() {},
          close() {
            closed.resolve();
          },
          error(_socket, err) {
            errors.push(err);
            handshake.reject(err);
          },
          connectError(_socket, err) {
            handshake.reject(err);
            closed.reject(err);
            serverClosed.reject(err);
          },
        },
      });
      expect(await handshake.promise).toBe(-1);
      await closed.promise;
      await serverClosed.promise;
      expect(serverReceived).toEqual([]);
      expect(errors.map(e => e.message)).toEqual([UNTRUSTED_MESSAGE]);
    });

    it("closes a connection whose certificate does not match the hostname", async () => {
      using t = await connectTo({ key: SERVER_KEY, cert: SERVER_CRT }, { ca: CA_CRT, serverName: "wrong.example.com" });
      expect(await t.handshake.promise).toEqual({
        authorizedArg: false,
        authorizedGetter: false,
        callbackError:
          "Hostname/IP does not match certificate's altnames: Host: wrong.example.com. is not in the cert's altnames: DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
        getterError:
          "Hostname/IP does not match certificate's altnames: Host: wrong.example.com. is not in the cert's altnames: DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
      });
      await t.closed.promise;
      expect(t.received).toEqual([]);
      // The verdict must stay readable after the forced close.
      expect(t.client.getAuthorizationError()?.message).toBe(
        "Hostname/IP does not match certificate's altnames: Host: wrong.example.com. is not in the cert's altnames: DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
      );
      expect((t.client.getAuthorizationError() as any)?.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    });

    // node:tls sockets own server-identity policy in JS: an accepting
    // checkServerIdentity override must keep a mismatched-hostname connection.
    it("does not enforce a hostname mismatch on node:tls sockets", async () => {
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: SERVER_KEY, cert: SERVER_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("hello-from-server\n");
          },
          data(socket, data) {
            socket.write(data);
          },
          close() {},
          error() {},
        },
      });
      const received: string[] = [];
      const echoed = Promise.withResolvers<void>();
      const client = tlsConnect({
        host: "127.0.0.1",
        port: server.port,
        ca: CA_CRT,
        servername: "wrong.example.com",
        checkServerIdentity: () => undefined,
      });
      client.on("secureConnect", () => client.write("ping"));
      client.on("data", d => {
        received.push(d.toString());
        if (received.join("").includes("ping")) echoed.resolve();
      });
      client.on("error", err => echoed.reject(err));
      client.on("close", () => echoed.reject(new Error("client closed before the echo completed")));
      try {
        await echoed.promise;
        expect(received.join("")).toBe("hello-from-server\nping");
      } finally {
        client.removeAllListeners("close");
        client.destroy();
      }
    });

    // Reverse tunnel: the peer dials in over TCP and the accepting side
    // becomes the TLS client over the accepted socket. Identity stays owned
    // by node:tls's JS layer on this path too.
    it("honors an accepting checkServerIdentity on a listener-accepted net.Socket", async () => {
      const done = Promise.withResolvers<string>();
      const srv = net.createServer(accepted => {
        const c = tlsConnect({
          socket: accepted,
          ca: CA_CRT,
          servername: "wrong.example.com",
          checkServerIdentity: () => undefined,
        });
        c.on("secureConnect", () => c.write("ping"));
        c.on("data", d => done.resolve(d.toString()));
        c.on("error", err => done.reject(err));
        c.on("close", () => done.reject(new Error("closed before the echo completed")));
      });
      await new Promise<void>(resolve => srv.listen(0, "127.0.0.1", () => resolve()));
      const raw = await Bun.connect({
        hostname: "127.0.0.1",
        port: (srv.address() as import("node:net").AddressInfo).port,
        socket: { data() {}, close() {}, error() {} },
      });
      raw.upgradeTLS({
        isServer: true,
        tls: { key: SERVER_KEY, cert: SERVER_CRT },
        socket: {
          handshake() {},
          data(s: Socket, d: Buffer) {
            s.write(d);
          },
          close() {},
          error() {},
        },
      } as any);
      try {
        expect(await done.promise).toBe("ping");
      } finally {
        raw.end();
        srv.close();
      }
    });

    it("rejects a hostname mismatch on a listener-accepted net.Socket with Node's error", async () => {
      const done = Promise.withResolvers<string>();
      const srv = net.createServer(accepted => {
        const c = tlsConnect({
          socket: accepted,
          ca: CA_CRT,
          servername: "wrong.example.com",
        });
        c.on("data", () => done.reject(new Error("data flowed to a mis-identified peer")));
        c.on("error", err => done.resolve((err as any).code ?? err.message));
        c.on("close", () => done.resolve("closed with no error"));
      });
      await new Promise<void>(resolve => srv.listen(0, "127.0.0.1", () => resolve()));
      const raw = await Bun.connect({
        hostname: "127.0.0.1",
        port: (srv.address() as import("node:net").AddressInfo).port,
        socket: { data() {}, close() {}, error() {} },
      });
      raw.upgradeTLS({
        isServer: true,
        tls: { key: SERVER_KEY, cert: SERVER_CRT },
        socket: {
          handshake() {},
          data() {},
          close() {},
          error() {},
        },
      } as any);
      try {
        expect(await done.promise).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      } finally {
        raw.end();
        srv.close();
      }
    });

    it("does not enforce a hostname mismatch on a node:tls socket wrapping an existing net.Socket", async () => {
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: SERVER_KEY, cert: SERVER_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("hello-from-server\n");
          },
          data(socket, data) {
            socket.write(data);
          },
          close() {},
          error() {},
        },
      });
      const received: string[] = [];
      const echoed = Promise.withResolvers<void>();
      const raw = net.connect(server.port, "127.0.0.1");
      await new Promise<void>(resolve => raw.once("connect", resolve));
      const client = tlsConnect({
        socket: raw,
        ca: CA_CRT,
        servername: "wrong.example.com",
        checkServerIdentity: () => undefined,
      });
      client.on("secureConnect", () => client.write("ping"));
      client.on("data", d => {
        received.push(d.toString());
        if (received.join("").includes("ping")) echoed.resolve();
      });
      client.on("error", err => echoed.reject(err));
      client.on("close", () => echoed.reject(new Error("client closed before the echo completed")));
      try {
        await echoed.promise;
        expect(received.join("")).toBe("hello-from-server\nping");
      } finally {
        client.removeAllListeners("close");
        client.destroy();
        raw.destroy();
      }
    });

    it("keeps a hostname mismatch with rejectUnauthorized: false", async () => {
      using t = await connectTo(
        { key: SERVER_KEY, cert: SERVER_CRT },
        { ca: CA_CRT, serverName: "wrong.example.com", rejectUnauthorized: false },
      );
      expect(await t.handshake.promise).toEqual({
        authorizedArg: false,
        authorizedGetter: false,
        callbackError:
          "Hostname/IP does not match certificate's altnames: Host: wrong.example.com. is not in the cert's altnames: DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
        getterError:
          "Hostname/IP does not match certificate's altnames: Host: wrong.example.com. is not in the cert's altnames: DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
      });
      t.client.write("ping");
      await t.echoed.promise;
      expect(t.received.join("")).toBe("hello-from-server\nping");
    });
  });

  // https://github.com/oven-sh/bun/issues/33754
  describe.concurrent("Bun.listen (client certificate)", () => {
    async function acceptFrom(serverTlsExtra: Record<string, unknown>, clientCert?: { key: string; cert: string }) {
      const serverReceived: string[] = [];
      const clientReceived: string[] = [];
      const handshake = Promise.withResolvers<{
        successArg: boolean;
        authorizedGetter: boolean;
        callbackError: string | null;
        getterError: string | null;
        writeResult: number;
      }>();
      const serverClosed = Promise.withResolvers<void>();
      const clientClosed = Promise.withResolvers<void>();
      const echoed = Promise.withResolvers<void>();

      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: SERVER_KEY, cert: SERVER_CRT, ...serverTlsExtra },
        socket: {
          open() {},
          handshake(socket, success, authorizationError) {
            handshake.resolve({
              successArg: success,
              authorizedGetter: socket.authorized,
              callbackError: authorizationError?.message ?? null,
              getterError: socket.getAuthorizationError()?.message ?? null,
              writeResult: socket.write("hello-from-server\n"),
            });
          },
          data(socket, data) {
            serverReceived.push(data.toString());
            socket.write(data);
          },
          close() {
            serverClosed.resolve();
          },
          error() {},
        },
      });

      let client: Bun.Socket;
      try {
        client = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          tls: { ca: CA_CRT, serverName: "localhost", ...(clientCert ?? {}) },
          socket: {
            open() {},
            handshake(socket) {
              socket.write("client-app-data\n");
            },
            data(_socket, data) {
              clientReceived.push(data.toString());
              if (clientReceived.join("").includes("client-app-data\n")) echoed.resolve();
            },
            close() {
              clientClosed.resolve();
            },
            error(_socket, err) {
              handshake.reject(err);
              echoed.reject(err);
            },
            connectError(_socket, err) {
              handshake.reject(err);
              serverClosed.reject(err);
              clientClosed.reject(err);
              echoed.reject(err);
            },
          },
        });
      } catch (e) {
        server.stop(true);
        throw e;
      }

      return {
        server,
        client,
        serverReceived,
        clientReceived,
        handshake,
        serverClosed,
        clientClosed,
        echoed,
        [Symbol.dispose]() {
          client.end();
          server.stop(true);
        },
      };
    }

    it("closes a connection whose client certificate is not trusted", async () => {
      using t = await acceptFrom({ ca: CA_CRT, requestCert: true }, { key: ROGUE_KEY, cert: ROGUE_CRT });
      expect(await t.handshake.promise).toEqual({
        successArg: true,
        authorizedGetter: false,
        callbackError: UNTRUSTED_MESSAGE,
        getterError: UNTRUSTED_MESSAGE,
        writeResult: -1,
      });
      await t.serverClosed.promise;
      await t.clientClosed.promise;
      expect(t.serverReceived).toEqual([]);
      expect(t.clientReceived).toEqual([]);
    });

    it("keeps a connection whose client certificate is trusted", async () => {
      using t = await acceptFrom({ ca: CA_CRT, requestCert: true }, { key: SERVER_KEY, cert: SERVER_CRT });
      expect(await t.handshake.promise).toEqual({
        successArg: true,
        authorizedGetter: true,
        callbackError: null,
        getterError: null,
        writeResult: "hello-from-server\n".length,
      });
      await t.echoed.promise;
      expect(t.serverReceived.join("")).toBe("client-app-data\n");
    });

    it("keeps an untrusted client certificate with rejectUnauthorized: false but reports authorized=false", async () => {
      using t = await acceptFrom(
        { ca: CA_CRT, requestCert: true, rejectUnauthorized: false },
        { key: ROGUE_KEY, cert: ROGUE_CRT },
      );
      expect(await t.handshake.promise).toEqual({
        successArg: true,
        authorizedGetter: false,
        callbackError: UNTRUSTED_MESSAGE,
        getterError: UNTRUSTED_MESSAGE,
        writeResult: "hello-from-server\n".length,
      });
      await t.echoed.promise;
      expect(t.serverReceived.join("")).toBe("client-app-data\n");
    });

    // A bare `secureContext` carries no parsed config; the policy comes from
    // the context's own verify mode.
    it("closes an untrusted client certificate on an isServer upgrade with only a secureContext", async () => {
      const serverReceived: string[] = [];
      const handshake = Promise.withResolvers<{ authorized: boolean; error: string | null; writeResult: number }>();
      const serverClosed = Promise.withResolvers<void>();
      const clientClosed = Promise.withResolvers<void>();
      const { context } = createSecureContext({
        key: SERVER_KEY,
        cert: SERVER_CRT,
        ca: CA_CRT,
        requestCert: true,
        rejectUnauthorized: true,
      } as any) as any;
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open() {},
          data(raw, chunk) {
            raw.upgradeTLS({
              isServer: true,
              initialData: chunk,
              secureContext: context,
              socket: {
                handshake(secure: Socket, _success: boolean, authorizationError: Error | null) {
                  handshake.resolve({
                    authorized: secure.authorized,
                    error: authorizationError?.message ?? null,
                    writeResult: secure.write("hello-from-server\n"),
                  });
                },
                data(_secure: Socket, payload: Buffer) {
                  serverReceived.push(payload.toString());
                },
                close() {
                  serverClosed.resolve();
                },
                error() {},
              },
            } as any);
          },
          error(_raw, err) {
            handshake.reject(err);
            serverClosed.reject(err);
          },
          close() {},
        },
      });
      using client = await Bun.connect({
        hostname: "127.0.0.1",
        port: listener.port,
        tls: { ca: CA_CRT, serverName: "localhost", key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("client-app-data\n");
          },
          data() {},
          close() {
            clientClosed.resolve();
          },
          error() {},
          connectError(_socket, err) {
            handshake.reject(err);
            clientClosed.reject(err);
            serverClosed.reject(err);
          },
        },
      });
      void client;
      expect(await handshake.promise).toEqual({ authorized: false, error: UNTRUSTED_MESSAGE, writeResult: -1 });
      await serverClosed.promise;
      expect(serverReceived).toEqual([]);
      await clientClosed.promise;
    });

    it("closes an untrusted client certificate on a socket upgraded with isServer: true", async () => {
      const serverReceived: string[] = [];
      const handshake = Promise.withResolvers<{ authorized: boolean; error: string | null; writeResult: number }>();
      const serverClosed = Promise.withResolvers<void>();
      const clientClosed = Promise.withResolvers<void>();
      const serverTls = { key: SERVER_KEY, cert: SERVER_CRT, ca: CA_CRT, requestCert: true };
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open() {},
          data(raw, chunk) {
            raw.upgradeTLS({
              isServer: true,
              initialData: chunk,
              tls: serverTls,
              socket: {
                open() {},
                handshake(secure: Socket, _success: boolean, authorizationError: Error | null) {
                  handshake.resolve({
                    authorized: secure.authorized,
                    error: authorizationError?.message ?? null,
                    writeResult: secure.write("hello-from-server\n"),
                  });
                },
                data(_secure: Socket, payload: Buffer) {
                  serverReceived.push(payload.toString());
                },
                close() {
                  serverClosed.resolve();
                },
                error() {},
              },
            } as any);
          },
          error(_raw, err) {
            handshake.reject(err);
            serverClosed.reject(err);
          },
          close() {},
        },
      });
      using client = await Bun.connect({
        hostname: "127.0.0.1",
        port: listener.port,
        tls: { ca: CA_CRT, serverName: "localhost", key: ROGUE_KEY, cert: ROGUE_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("client-app-data\n");
          },
          data() {},
          close() {
            clientClosed.resolve();
          },
          error() {},
          connectError(_socket, err) {
            handshake.reject(err);
            clientClosed.reject(err);
            serverClosed.reject(err);
          },
        },
      });
      expect(await handshake.promise).toEqual({ authorized: false, error: UNTRUSTED_MESSAGE, writeResult: -1 });
      await serverClosed.promise;
      expect(serverReceived).toEqual([]);
      await clientClosed.promise;
    });

    // upgradeTLS({ isServer: true }) sockets act as the TLS server: the
    // client-only server-identity check must not run against the peer's
    // client certificate.
    it("keeps a valid client certificate on an isServer upgrade with an unrelated serverName", async () => {
      const handshake = Promise.withResolvers<{ authorized: boolean; error: string | null }>();
      const echoed = Promise.withResolvers<void>();
      const serverReceived: string[] = [];
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open() {},
          data(raw, chunk) {
            raw.upgradeTLS({
              isServer: true,
              initialData: chunk,
              tls: {
                key: SERVER_KEY,
                cert: SERVER_CRT,
                ca: CA_CRT,
                requestCert: true,
                serverName: "wrong.example.com",
              },
              socket: {
                handshake(secure: Socket, _success: boolean, authorizationError: Error | null) {
                  handshake.resolve({
                    authorized: secure.authorized,
                    error: authorizationError?.message ?? null,
                  });
                },
                data(secure: Socket, payload: Buffer) {
                  serverReceived.push(payload.toString());
                  secure.write(payload);
                },
                close() {},
                error() {},
              },
            } as any);
          },
          error(_raw, err) {
            handshake.reject(err);
            echoed.reject(err);
          },
          close() {},
        },
      });
      using client = await Bun.connect({
        hostname: "127.0.0.1",
        port: listener.port,
        tls: { ca: CA_CRT, serverName: "localhost", key: SERVER_KEY, cert: SERVER_CRT },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("valid-mtls-data");
          },
          data() {
            echoed.resolve();
          },
          close() {},
          error() {},
          connectError(_socket, err) {
            handshake.reject(err);
            echoed.reject(err);
          },
        },
      });
      void client;
      expect(await handshake.promise).toEqual({ authorized: true, error: null });
      await echoed.promise;
      expect(serverReceived.join("")).toBe("valid-mtls-data");
    });

    it("rejects a client that presents no certificate when one is required", async () => {
      const serverReceived: string[] = [];
      const clientClosed = Promise.withResolvers<void>();
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: { key: SERVER_KEY, cert: SERVER_CRT, ca: CA_CRT, requestCert: true },
        socket: {
          open() {},
          handshake() {},
          data(_socket, data) {
            serverReceived.push(data.toString());
          },
          close() {},
          error() {},
        },
      });
      using client = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        tls: { ca: CA_CRT, serverName: "localhost" },
        socket: {
          open() {},
          handshake(socket) {
            socket.write("client-app-data\n");
          },
          data() {},
          close() {
            clientClosed.resolve();
          },
          error() {},
          connectError(_socket, err) {
            clientClosed.reject(err);
          },
        },
      });
      await clientClosed.promise;
      expect(serverReceived).toEqual([]);
    });

    it("reports authorized=false on a server that never requested a client certificate", async () => {
      using t = await acceptFrom({});
      expect(await t.handshake.promise).toEqual({
        successArg: true,
        authorizedGetter: false,
        callbackError: "unable to get issuer certificate",
        getterError: "unable to get issuer certificate",
        writeResult: "hello-from-server\n".length,
      });
      await t.echoed.promise;
      expect(t.serverReceived.join("")).toBe("client-app-data\n");
    });
  });
});
