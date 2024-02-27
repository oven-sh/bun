// @known-failing-on-windows: 1 failing
import { expect, it } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount } from "harness";
import { connect, fileURLToPath, SocketHandler, spawn } from "bun";

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
    cmd: [bunExe(), "keep-event-loop-alive.js", String(server.port)],
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
        expect(error.name).toBe("ECONNREFUSED");
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
      expect(err.name).toBe("ECONNREFUSED");
      expect(err.message).toBe("Failed to connect");

      done();
    },
  );
});

it("should not leak memory when connect() fails", async () => {
  await (async () => {
    var promises = new Array(100);
    for (let i = 0; i < 100; i++) {
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

  await expectMaxObjectTypeCount(expect, "TCPSocket", 50, 100);
});

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
        expect(error.name).toBe("ECONNREFUSED");
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
  await expectMaxObjectTypeCount(expect, "TCPSocket", 5, 100);
});

it("should allow large amounts of data to be sent and received", async () => {
  expect([fileURLToPath(new URL("./socket-huge-fixture.js", import.meta.url))]).toRun();
}, 10_000);

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
      hostname: "localhost",
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
