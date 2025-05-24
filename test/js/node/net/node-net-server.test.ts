import { realpathSync } from "fs";
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

  it("should listen on IPv6 by default", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

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
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

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
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };

    server.on("error", closeAndFail).on(
      "listening",
      mustCall(() => {
        clearTimeout(timeout);
        server.close();
        done();
      }),
    );

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0");
  });

  it("should provide listening property", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    expect(server.listening).toBeFalse();

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };

    server.on("error", closeAndFail).on(
      "listening",
      mustCall(() => {
        expect(server.listening).toBeTrue();
        clearTimeout(timeout);
        server.close();
        expect(server.listening).toBeFalse();
        done();
      }),
    );

    timeout = setTimeout(closeAndFail, 100);

    server.listen(0, "0.0.0.0");
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

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
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

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
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

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
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();

    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

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
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server: Server = createServer();
    let timeout: Timer;
    const closeAndFail = () => {
      clearTimeout(timeout);
      server.close();
      mustNotCall()();
    };
    server.on("error", closeAndFail);
    timeout = setTimeout(closeAndFail, 100);

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

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

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

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);
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

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

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

    //should be faster than 100ms
    timeout = setTimeout(closeAndFail, 100);

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
