import { expect, it } from "bun:test";
import { bunEnv, bunExe, expectMaxObjectTypeCount } from "harness";
import { connect, SocketHandler, spawn } from "bun";

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
        expect(error.name).toBe("SystemError");
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
      expect(err.name).toBe("SystemError");
      expect(err.message).toBe("Failed to connect");

      done();
    },
  );
});

it("should not leak memory when connect() fails", async () => {
  await expectMaxObjectTypeCount(expect, "TCPSocket", 1, 100);
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
        expect(error.name).toBe("SystemError");
        expect(error.message).toBe("Failed to connect");
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
  await expectMaxObjectTypeCount(expect, "TCPSocket", 1, 100);
});
