import { realpathSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { AddressInfo, createServer, Server, Socket } from "net";
import { createTest } from "node-harness";
import { once } from "node:events";
import { tmpdir } from "os";
import { join } from "path";

const { describe, expect, it, createCallCheckCtx } = createTest(import.meta.path);

const socket_domain = join(realpathSync(tmpdir()), "node-net-server.sock");

describe("net.createServer listen", () => {
  it("should throw when no port or path when using options", done => {
    expect(() => createServer().listen({ exclusive: true })).toThrow(
      'The argument \'options\' must have the property "port" or "path". Received {"exclusive":true}',
    );
    done();
  });

  // No secondary setTimeout deadline: the test runner already bounds each test,
  // and a real listen failure reaches done() via the 'error' listener below.
  const failOnError = (server: Server, done: (err?: unknown) => void) => (err: unknown) => {
    server.close();
    done(err);
  };

  it("should listen on IPv6 by default", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on IPv4", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "0.0.0.0",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("0.0.0.0");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
        done();
      }),
    );
  });

  it("should call listening", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    server.on("error", failOnError(server, done)).on(
      "listening",
      mustCall(() => {
        server.close();
        done();
      }),
    );

    server.listen(0, "0.0.0.0");
  });

  it("should provide listening property", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    expect(server.listening).toBeFalse();

    server.on("error", failOnError(server, done)).on(
      "listening",
      mustCall(() => {
        expect(server.listening).toBeTrue();
        server.close();
        expect(server.listening).toBeFalse();
        done();
      }),
    );

    server.listen(0, "0.0.0.0");
  });

  it("should listen on localhost", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on localhost", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::1");
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen without port or host", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      mustCall(() => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
        done();
      }),
    );
  });

  it("should listen on unix domain socket", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      socket_domain,
      mustCall(() => {
        const address = server.address();
        expect(address).toStrictEqual(socket_domain);
        server.close();
        done();
      }),
    );
  });

  it("should bind IPv4 0.0.0.0 when listen on 0.0.0.0, issue#7355", done => {
    const { mustCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    server.on("error", failOnError(server, done));

    server.listen(
      0,
      "0.0.0.0",
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        expect(address.address).toStrictEqual("0.0.0.0");
        expect(address.family).toStrictEqual("IPv4");

        let err: Error | null = null;
        try {
          await Bun.connect({
            hostname: "0.0.0.0",
            port: address.port,
            socket: {
              data(socket) {},
            },
          });
        } catch (e) {
          err = e as Error;
        }
        expect(err).toBeNull();

        try {
          await Bun.connect({
            hostname: "::",
            port: address.port,
            socket: {
              data(socket) {},
            },
          });
        } catch (e) {
          err = e as Error;
        }

        expect(err).not.toBeNull();
        expect(err!.message).toBe("Failed to connect");
        expect(err!.name).toBe("Error");
        expect((err as { code?: string }).code).toBe("ECONNREFUSED");

        server.close();
        done();
      }),
    );
  });

  it("emits 'listening' on the next tick, before the event loop polls", async () => {
    const server: Server = createServer();
    const order: string[] = [];
    server.on("listening", () => order.push("listening"));
    server.listen(0);
    process.nextTick(() => order.push("nextTick"));
    await once(server, "listening");
    server.close();
    await once(server, "close");
    expect(order).toEqual(["listening", "nextTick"]);
  });

  // The error twin of the test above: a listen() that fails reports on the same tick as one that succeeds.
  // No host argument: with one, Node resolves it through dns.lookup first, which adds a tick.
  it("emits a listen() error on the next tick, before the event loop polls", async () => {
    const occupant: Server = createServer();
    occupant.listen(0);
    await once(occupant, "listening");
    const { port } = occupant.address() as AddressInfo;

    const server: Server = createServer();
    const order: string[] = [];
    server.on("error", (err: NodeJS.ErrnoException) => order.push("error:" + err.code));
    server.listen(port);
    process.nextTick(() => order.push("nextTick"));
    await once(server, "error");
    occupant.close();
    await once(occupant, "close");
    expect(order).toEqual(["error:EADDRINUSE", "nextTick"]);
  });

  // How vite, get-port and friends probe for a free port: listen, then close()
  // from the 'listening' handler. A peer that connects in between must be reset
  // by the kernel when the listening fd closes, not accepted into the closing
  // server, whose close() would then wait on a connection nobody is reading.
  it("close() from 'listening' does not accept a peer that connected in between", async () => {
    const server: Server = createServer();
    let accepted = 0;
    server.on("connection", () => accepted++);
    const { promise: closed, resolve: onClosed, reject } = Promise.withResolvers<void>();
    server.on("error", reject);
    server.listen(0, "127.0.0.1");

    // Bun.connect() issues connect(2) synchronously, so the peer is already
    // sitting in the listen backlog when the 'listening' handler runs.
    const { port } = server.address() as AddressInfo;
    const peer = Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
        error() {},
        connectError() {},
      },
    }).catch(() => null);

    server.once("listening", () => {
      server.close(() => onClosed());
      peer.then(socket => socket?.end());
    });

    await closed;
    expect(accepted).toBe(0);
  });

  // Node's server.close() completes the handle's uv_close() on the next loop
  // turn, so a server listened and closed from a 'beforeExit' handler brings
  // the loop back to life once more and 'beforeExit' fires again
  // (upstream test-process-beforeexit). 'listening' itself is only a nextTick
  // now, so close() has to hold the loop for that turn on its own.
  it("closing a server listened from 'beforeExit' re-emits 'beforeExit'", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          process.once("beforeExit", () => {
            net
              .createServer()
              .listen(0)
              .on("listening", function () {
                this.close();
                process.once("beforeExit", () => console.log("beforeExit again"));
              });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "beforeExit again\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

describe("net.createServer events", () => {
  it("should receive data", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    let is_done = false;
    const onData = mustCall(data => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      expect(data.byteLength).toBe(5);
      expect(data.toString("utf8")).toBe("Hello");
      done();
    });

    const server: Server = createServer((socket: Socket) => {
      socket.on("data", onData);
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    //should be faster than 500ms (this was previously 100 but the test was flaky on local machine -@alii)
    timeout = setTimeout(closeAndFail, 500);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        client = await Bun.connect({
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            open(socket) {
              if (socket.write("Hello")) {
                socket.end();
              }
            },
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call end", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let is_done = false;
    const onEnd = mustCall(() => {
      is_done = true;
      clearTimeout(timeout);
      server.close();
      done();
    });

    const server: Server = createServer((socket: Socket) => {
      socket.on("end", onEnd);
      socket.end();
    });

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("end not called")();
    };
    server.on("error", closeAndFail);

    timeout = setTimeout(closeAndFail, 500);

    server.listen(
      mustCall(async () => {
        const address = server.address() as AddressInfo;
        await Bun.connect({
          hostname: address.address,
          port: address.port,
          socket: {
            data(socket) {},
            open(socket) {},
            connectError: closeAndFail, // connection failed
          },
        }).catch(closeAndFail);
      }),
    );
  });

  it("should call close", async () => {
    const { promise, reject, resolve } = Promise.withResolvers();
    const server: Server = createServer();
    server.listen().on("close", resolve).on("error", reject);
    server.close();
    await promise;
  });

  it("should call connection and drop", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    let timeout: Timer;
    let is_done = false;
    const server = createServer();
    let maxClients = 2;
    server.maxConnections = maxClients - 1;

    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      mustNotCall("drop not called")();
    };

    timeout = setTimeout(closeAndFail, 500);
    let connection_called = false;
    server
      .on(
        "connection",
        mustCall(() => {
          connection_called = true;
        }),
      )
      .on(
        "drop",
        mustCall(data => {
          is_done = true;
          server.close();
          clearTimeout(timeout);
          expect(data.localPort).toBeDefined();
          expect(data.remotePort).toBeDefined();
          expect(data.remoteFamily).toBeDefined();
          expect(data.localFamily).toBeDefined();
          expect(data.localAddress).toBeDefined();
          expect(connection_called).toBe(true);
          done();
        }),
      )
      .listen(async () => {
        const address = server.address() as AddressInfo;

        async function spawnClient() {
          await Bun.connect({
            port: address?.port,
            hostname: address?.address,
            socket: {
              data(socket) {},
              open(socket) {
                socket.end();
              },
            },
          });
        }

        const promises: Promise<void>[] = [];
        for (let i = 0; i < maxClients; i++) {
          promises.push(spawnClient());
        }
        await Promise.all(promises).catch(closeAndFail);
      });
  });

  it("should error on an invalid port", () => {
    const server = createServer();

    expect(() => server.listen(123456)).toThrow(
      expect.objectContaining({
        code: "ERR_SOCKET_BAD_PORT",
      }),
    );
  });

  it("should call abort with signal", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const controller = new AbortController();
    let timeout: Timer;
    const server = createServer();

    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall("close not called")();
    };

    timeout = setTimeout(closeAndFail, 500);

    server
      .on(
        "close",
        mustCall(() => {
          clearTimeout(timeout);
          done();
        }),
      )
      .listen({ port: 0, signal: controller.signal }, () => {
        controller.abort();
      });
  });

  it("should stop listening to the signal once the server has closed", async () => {
    const controller = new AbortController();
    const server = createServer();
    let closeEvents = 0;
    server.on("close", () => closeEvents++);

    await new Promise<void>(resolve => server.listen({ port: 0, signal: controller.signal }, resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(closeEvents).toBe(1);

    // Aborting now must not call close() again, which would emit a second 'close'.
    controller.abort();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closeEvents).toBe(1);
  });

  it("should echo data", done => {
    const { mustNotCall } = createCallCheckCtx(done);
    let timeout: Timer;
    let client: any = null;
    const server: Server = createServer((socket: Socket) => {
      socket.pipe(socket);
    });
    let is_done = false;
    const closeAndFail = () => {
      if (is_done) return;
      clearTimeout(timeout);
      server.close();
      client?.end();
      mustNotCall("no data received")();
    };

    server.on("error", closeAndFail);

    timeout = setTimeout(closeAndFail, 500);

    server.listen(async () => {
      const address = server.address() as AddressInfo;
      client = await Bun.connect({
        hostname: address.address,
        port: address.port,
        socket: {
          drain(socket) {
            socket.write("Hello");
          },
          data(socket, data) {
            is_done = true;
            clearTimeout(timeout);
            server.close();
            socket.end();
            expect(data.byteLength).toBe(5);
            expect(data.toString("utf8")).toBe("Hello");
            done();
          },
          open(socket) {
            socket.write("Hello");
          },
          connectError: closeAndFail, // connection failed
        },
      }).catch(closeAndFail);
    });
  });

  it("#8374", async () => {
    const server = createServer();
    const socketPath = join(tmpdir(), "test-unix-socket");

    server.listen({ path: socketPath });
    await once(server, "listening");

    try {
      const address = server.address() as string;
      expect(address).toBe(socketPath);

      const client = await Bun.connect({
        unix: socketPath,
        socket: {
          data() {},
        },
      });
      client.end();
    } finally {
      server.close();
    }
  });
});

// Node gives each accepted handle its own uv_stream_t ref; Bun's Listener used
// to hold ONE KeepAlive for the listening socket and all its connections, so an
// accepted socket's unref() was a no-op and server.unref() dropped live
// connections. Both directions are covered below via Bun.listen to bypass
// node:net's onconnection (whose resume() on main would paper over case 1).
describe("accepted socket event-loop hold matches Node (per-connection KeepAlive)", () => {
  async function run(body: string) {
    // Spawned so "process exits naturally" is the observable.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", body],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr is drained but only surfaced on failure: debug builds may emit
    // benign warnings, so it is not asserted empty.
    return { stdout, exitCode, failureDetail: exitCode === 0 ? "" : stderr };
  }

  it("server.stop() + accepted socket.unref() lets the process exit", async () => {
    // do_stop used to gate the listener's KeepAlive release on
    // active_connections == 0, and the accepted socket's own KeepAlive was
    // never activated, so neither unref reached the loop counter and the
    // process hung even though nothing wanted it alive.
    expect(
      await run(`
        const accepted = Promise.withResolvers();
        const server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: { open(s) { accepted.resolve(s); }, data() {}, close() {} },
        });
        const client = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: { open() {}, data() {}, close() {} },
        });
        const srvSock = await accepted.promise;
        server.stop();
        client.unref();
        srvSock.unref();
        setTimeout(() => { process.stdout.write("HUNG"); process.exit(1); }, 4000).unref();
      `),
    ).toEqual({ stdout: "", exitCode: 0, failureDetail: "" });
  });

  it("server.unref() alone does not drop a ref'd accepted connection's hold", async () => {
    // Before the fix the Listener's single KeepAlive covered the listening
    // socket AND every accepted socket; server.unref() released the lot and
    // the process exited immediately, dropping the live ref'd connection
    // before the 300ms timer could observe it. Node keeps the loop alive for
    // the accepted handle on its own (as does this fix) so "alive" prints.
    expect(
      await run(`
        const accepted = Promise.withResolvers();
        const server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: { open(s) { accepted.resolve(s); }, data() {}, close() {} },
        });
        const client = await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: { open() {}, data() {}, close() {} },
        });
        const srvSock = await accepted.promise;
        server.unref();
        client.unref();
        // srvSock is NOT unref'd: it must keep the process alive on its own.
        setTimeout(() => {
          process.stdout.write(srvSock ? "alive" : "dead");
          srvSock.end();
          client.end();
          server.stop();
        }, 300).unref();
        setTimeout(() => { process.stdout.write("|HUNG"); process.exit(1); }, 4000).unref();
      `),
    ).toEqual({ stdout: "alive", exitCode: 0, failureDetail: "" });
  });

  it("half-open accepted sockets after peer FIN do not busy-poll the event loop (Windows AFD DISCONNECT)", async () => {
    // A write-only connection handler whose peer sends data+FIN leaves the
    // accepted socket half-open with bytes buffered (Node's flowing=null
    // accept state). On Windows AFD keeps reporting DISCONNECT for such a
    // socket; reporting it as READABLE each time makes recv() find the same
    // EOF and on_end fire once per loop turn per half-open socket. 40 such
    // sockets make a 2000-setImmediate spin take seconds instead of tens of ms.
    expect(
      await run(`
        const net = require("net");
        (async () => {
          for (let i = 0; i < 40; i++) {
            const srv = net.createServer(conn => { conn.write("x"); });
            await new Promise(r => srv.listen(0, "127.0.0.1", r));
            await new Promise(r => {
              const c = net.connect(srv.address().port, "127.0.0.1", () => {
                c.write("y".repeat(50));
                c.end();
                r();
              });
              c.on("data", () => {});
            });
            srv.close();
          }
          // Half-open sockets are now sitting with end delivered and 50 bytes
          // buffered; the loop must not be paying per-iteration cost for them.
          await new Promise(r => setTimeout(r, 50));
          const t0 = Date.now();
          let n = 0;
          await new Promise(r => {
            function tick() { if (++n >= 2000) return r(); setImmediate(tick); }
            tick();
          });
          const ms = Date.now() - t0;
          // Well under 200ms when quiescent (release ~5ms, debug ~50ms); the
          // busy-poll made 40 sockets x 2000 turns cost multiple seconds.
          process.stdout.write(ms < 800 ? "fast" : "busy-poll " + ms + "ms");
          process.exit(0);
        })();
      `),
    ).toEqual({ stdout: "fast", exitCode: 0, failureDetail: "" });
  });
});

// server.unref() on a Windows named-pipe listener must drop everything that
// keeps the loop alive, as it does for TCP and unix-socket listeners.
it("server.unref() on a pipe/unix-socket listener lets the process exit", async () => {
  // The child exits without close() (natural exit is the observable), so the
  // unix socket file must live in a tempDir the parent disposes.
  using dir = tempDir("server-unref", {});
  const listenPath =
    process.platform === "win32"
      ? "\\\\.\\pipe\\bun-server-unref-" + process.pid + "-" + Math.random().toString(36).slice(2)
      : join(String(dir), "server-unref.sock");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const server = require("net").createServer();
      server.listen(process.env.SERVER_UNREF_LISTEN_PATH, () => server.unref());
      setTimeout(() => { process.stdout.write("HUNG"); process.exit(1); }, 4000).unref();
      `,
    ],
    env: { ...bunEnv, SERVER_UNREF_LISTEN_PATH: listenPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(exitCode === 0 ? "" : stderr).toBe("");
  expect(exitCode).toBe(0);
});

// Every waiting instance of the pipe is taken at once, and the pipe's DACL is
// emptied before the server gets to replace them, so it cannot: it has no
// instance left to wait on and no connection that could end. Like Node it
// reports nothing and keeps trying; once the DACL is back, clients connect.
it.skipIf(process.platform !== "win32")(
  "a pipe server that cannot create instances recovers without an 'error'",
  async () => {
    using dir = tempDir("pipe-server-starved", {
      "fixture.js": `
        const { dlopen, FFIType, ptr } = require("bun:ffi");
        const net = require("node:net");
        const { once } = require("node:events");

        const { symbols: k32 } = dlopen("kernel32.dll", {
          CreateFileW: {
            args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
            // INVALID_HANDLE_VALUE is -1 this way; as a \`ptr\` it is 2n ** 64n - 1n.
            returns: FFIType.i64_fast,
          },
          CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
        });
        const { symbols: advapi } = dlopen("advapi32.dll", {
          GetSecurityInfo: {
            args: [FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.u32,
          },
          SetSecurityInfo: {
            args: [FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
            returns: FFIType.u32,
          },
        });
        const GENERIC_READ_WRITE = 0xc0000000, READ_CONTROL = 0x20000, WRITE_DAC = 0x40000, OPEN_EXISTING = 3;
        const SE_KERNEL_OBJECT = 6, DACL_SECURITY_INFORMATION = 4, PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;

        const name = process.env.PIPE_NAME;
        const wide = Buffer.from(name + "\\0", "utf16le");
        const errors = [];
        let connections = 0;
        let onConnection;
        const server = net.createServer(socket => {
          socket.on("error", () => {});
          connections++;
          onConnection?.();
        });
        server.on("error", error => errors.push(error.code));
        server.listen(name);
        await once(server, "listening");

        // Nothing here returns to the event loop: the server hears of the four
        // clients only after the DACL is empty.
        const clients = [];
        for (let i = 0; i < 4; i++) {
          const handle = k32.CreateFileW(ptr(wide), (GENERIC_READ_WRITE | READ_CONTROL | WRITE_DAC) >>> 0, 0, null, OPEN_EXISTING, 0, null);
          if (handle === -1) throw new Error("CreateFileW failed");
          clients.push(handle);
        }
        const dacl = new BigUint64Array(1);
        const descriptor = new BigUint64Array(1);
        let rc = advapi.GetSecurityInfo(clients[0], SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, null, null, ptr(dacl), null, ptr(descriptor));
        if (rc !== 0) throw new Error("GetSecurityInfo: " + rc);
        // Revision 2, 8 bytes, no entries: nobody may do anything, the owner
        // may still change it.
        const empty = new Uint8Array([2, 0, 8, 0, 0, 0, 0, 0]);
        rc = advapi.SetSecurityInfo(clients[0], SE_KERNEL_OBJECT, (DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION) >>> 0, null, null, ptr(empty), null);
        if (rc !== 0) throw new Error("SetSecurityInfo(empty): " + rc);

        while (connections < 4) await new Promise(resolve => (onConnection = resolve));
        console.log("connections", connections, "errors", JSON.stringify(errors));

        rc = advapi.SetSecurityInfo(clients[0], SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, null, null, Number(dacl[0]), null);
        if (rc !== 0) throw new Error("SetSecurityInfo(restore): " + rc);
        const client = net.connect(name);
        await once(client, "connect");
        while (connections < 5) await new Promise(resolve => (onConnection = resolve));
        console.log("connections", connections, "errors", JSON.stringify(errors));

        client.destroy();
        for (const handle of clients) k32.CloseHandle(handle);
        server.close();
        process.exit(0);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.js"],
      env: { ...bunEnv, PIPE_NAME: "\\\\.\\pipe\\bun-pipe-server-starved-" + process.pid + "-" + Date.now() },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("connections 4 errors []\nconnections 5 errors []\n");
    expect(exitCode).toBe(0);
  },
);
