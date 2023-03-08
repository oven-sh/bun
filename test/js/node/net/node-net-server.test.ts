import { describe, expect, it } from "bun:test";
import { createServer } from "net";
import { createCallCheckCtx } from "node-harness";

describe("net.createServer listen", () => {
  it("should listen on IPv6 by default", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on IPv4", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      "127.0.0.1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("127.0.0.1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
      }),
    );
    done();
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::1");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on localhost", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      0,
      "::1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::1");
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen without port or host", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::");
        //system should provide an port when 0 or no port is passed
        expect(address.port).toBeGreaterThan(100);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on the correct port", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      65535,
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("::");
        expect(address.port).toStrictEqual(65535);
        expect(address.family).toStrictEqual("IPv6");
        server.close();
      }),
    );
    done();
  });

  it("should listen on the correct port with IPV4", done => {
    const { mustCall, mustNotCall } = createCallCheckCtx(done);

    const server = createServer();

    server.on("error", mustNotCall());

    server.listen(
      65534,
      "127.0.0.1",
      mustCall(() => {
        const address = server.address();
        expect(address.address).toStrictEqual("127.0.0.1");
        expect(address.port).toStrictEqual(65534);
        expect(address.family).toStrictEqual("IPv4");
        server.close();
      }),
    );
    done();
  });
});

it("should receive data", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);
  let timeout;

  const onData = mustCall(data => {
    clearTimeout(timeout);
    server.close();
    expect(data.byteLength).toBe(5);
    expect(data.toString("utf8")).toBe("Hello");
    done();
  });

  const server = createServer(socket => {
    socket.on("data", onData);
  });

  const closeAndFail = mustNotCall("no data received (timeout)", () => {
    clearTimeout(timeout);
    server.close();
  });

  server.on("error", mustNotCall("no data received"));

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server.listen(
    mustCall(() => {
      const address = server.address();
      Bun.connect({
        hostname: address.address,
        port: address.port,
        socket: {
          data(socket) {},
          open(socket) {
            socket.write("Hello");
            socket.end();
          },
          connectError: closeAndFail, // connection failed
        },
      }).catch(closeAndFail);
    }),
  );
});

it("should call end", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);
  let timeout;

  const onEnd = mustCall(() => {
    clearTimeout(timeout);
    server.close();
    done();
  });

  const server = createServer(socket => {
    socket.on("end", onEnd);
    socket.end();
  });

  const closeAndFail = mustNotCall("end not called (timeout)", () => {
    clearTimeout(timeout);
    server.close();
  });
  server.on("error", mustNotCall("end not called"));

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server.listen(
    mustCall(() => {
      const address = server.address();
      Bun.connect({
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

it("should call close", done => {
  let closed = false;
  const server = createServer();
  server.listen().on("close", () => {
    closed = true;
  });
  server.close();
  expect(closed).toBe(true);
  done();
});

it("should call drop", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);

  let timeout;
  const server = createServer();
  let maxClients = 2;
  server.maxConnections = maxClients - 1;

  const closeAndFail = mustNotCall("drop not called (timeout)", () => {
    clearTimeout(timeout);
    server.close();
    done();
  });

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server
    .on(
      "drop",
      mustCall(data => {
        server.close();
        clearTimeout(timeout);
        expect(data.localPort).toBeDefined();
        expect(data.remotePort).toBeDefined();
        expect(data.remoteFamily).toBeDefined();
        expect(data.localFamily).toBeDefined();
        expect(data.localAddress).toBeDefined();
        done();
      }),
    )
    .listen(() => {
      const address = server.address();

      function spawnClient() {
        Bun.connect({
          port: address.port,
          hostname: address.address,
          socket: {
            data(socket) {},
            open(socket) {
              socket.end();
            },
          },
        });
      }
      for (let i = 0; i < maxClients; i++) {
        spawnClient();
        spawnClient();
      }
    });
});

it("should call connection", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);

  let timeout;
  const server = createServer();
  let maxClients = 2;
  server.maxConnections = maxClients - 1;

  const closeAndFail = mustNotCall("connection not called (timeout)", () => {
    clearTimeout(timeout);
    server.close();
    done();
  });

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server
    .on(
      "connection",
      mustCall(() => {
        server.close();
        clearTimeout(timeout);
        done();
      }),
    )
    .listen(() => {
      const address = server.address();

      Bun.connect({
        port: address.port,
        hostname: address.address,
        socket: {
          data(socket) {},
          open(socket) {
            socket.end();
          },
        },
      });
    });
});

it("should call listening", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);

  let timeout;
  const server = createServer();
  let maxClients = 2;
  server.maxConnections = maxClients - 1;

  const closeAndFail = mustNotCall("listening not called (timeout)", () => {
    clearTimeout(timeout);
    server.close();
    done();
  });

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server
    .on(
      "listening",
      mustCall(() => {
        server.close();
        clearTimeout(timeout);
        done();
      }),
    )
    .listen();
});

it("should call error", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);

  let timeout;
  const server = createServer();
  let maxClients = 2;
  server.maxConnections = maxClients - 1;

  const closeAndFail = mustNotCall("error not called (timeout)", () => {
    clearTimeout(timeout);
    server.close();
    done();
  });

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server
    .on(
      "error",
      mustCall(err => {
        server.close();
        clearTimeout(timeout);
        expect(err).toBeDefined();
        done();
      }),
    )
    .listen(123456);
});

it("should call abort with signal", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);

  const controller = new AbortController();
  let timeout;
  const server = createServer();
  let maxClients = 2;
  server.maxConnections = maxClients - 1;

  const closeAndFail = mustNotCall("close not called (timeout)", () => {
    clearTimeout(timeout);
    server.close();
    done();
  });

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server
    .on(
      "close",
      mustCall(() => {
        clearImmediate(timeout);
        done();
      }),
    )
    .listen({ signal: controller.signal }, () => {
      controller.abort();
    });
});

it("should echo data", done => {
  const { mustCall, mustNotCall } = createCallCheckCtx(done);
  let timeout;

  const server = createServer(socket => {
    socket.pipe(socket);
  });

  const closeAndFail = mustNotCall("no data received (timeout)", () => {
    clearTimeout(timeout);
    server.close();
  });

  server.on("error", mustNotCall("no data received"));

  //should be faster than 100ms
  timeout = setTimeout(() => {
    closeAndFail();
  }, 100);

  server.listen(
    mustCall(() => {
      const address = server.address();
      Bun.connect({
        hostname: address.address,
        port: address.port,
        socket: {
          data(socket, data) {
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
    }),
  );
});
