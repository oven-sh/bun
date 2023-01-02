import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { isIP, isIPv4, isIPv6, Socket } from "net";

it("should support net.isIP()", () => {
  expect(isIP("::1")).toBe(6);
  expect(isIP("foobar")).toBe(0);
  expect(isIP("127.0.0.1")).toBe(4);
  expect(isIP("127.0.0.1/24")).toBe(0);
  expect(isIP("127.000.000.001")).toBe(0);
});

it("should support net.isIPv4()", () => {
  expect(isIPv4("::1")).toBe(false);
  expect(isIPv4("foobar")).toBe(false);
  expect(isIPv4("127.0.0.1")).toBe(true);
  expect(isIPv4("127.0.0.1/24")).toBe(false);
  expect(isIPv4("127.000.000.001")).toBe(false);
});

it("should support net.isIPv6()", () => {
  expect(isIPv6("::1")).toBe(true);
  expect(isIPv6("foobar")).toBe(false);
  expect(isIPv6("127.0.0.1")).toBe(false);
  expect(isIPv6("127.0.0.1/24")).toBe(false);
  expect(isIPv6("127.000.000.001")).toBe(false);
});

describe("net.Socket read", () => {
  const message = "Hello World!".repeat(1024);
  const port = 12345;
  let erred, server;

  beforeAll(() => {
    function drain(socket) {
      const message = socket.data.message;
      const written = socket.write(message);
      if (written < message.length) {
        socket.data.message = message.slice(written);
      } else {
        socket.end();
      }
    }

    server = Bun.listen({
      hostname: "localhost",
      port: port,
      socket: {
        open(socket) {
          socket.data.message = message;
          drain(socket);
        },
        drain,
        error(socket, err) {
          erred = err;
        },
      },
      data: {
        message: "",
      },
    });
  });

  beforeEach(() => {
    erred = undefined;
  });

  it("should work with .connect(port)", done => {
    var data = "";
    const socket = new Socket().connect(port).on("connect", () => {
      expect(socket).toBeDefined();
      expect(socket.connecting).toBe(false);
    }).setEncoding("utf8").on("data", chunk => {
      data += chunk;
    }).on("end", () => {
      expect(data).toBe(message);
      done(erred);
    }).on("error", done);
  });

  it("should work with .connect(port, listener)", done => {
    var data = "";
    const socket = new Socket().connect(port, () => {
      expect(socket).toBeDefined();
      expect(socket.connecting).toBe(false);
    }).setEncoding("utf8").on("data", chunk => {
      data += chunk;
    }).on("end", () => {
      expect(data).toBe(message);
      done(erred);
    }).on("error", done);
  });

  it("should work with .connect(port, host, listener)", done => {
    var data = "";
    const socket = new Socket().connect(port, "localhost", () => {
      expect(socket).toBeDefined();
      expect(socket.connecting).toBe(false);
    }).setEncoding("utf8").on("data", chunk => {
      data += chunk;
    }).on("end", () => {
      expect(data).toBe(message);
      done(erred);
    }).on("error", done);
  });

  afterAll(() => server.stop());
});

describe("net.Socket write", () => {
  const message = "Hello World!".repeat(1024);
  const port = 54321;
  let onClose, server;

  beforeAll(() => {
    function close(socket) {
      if (onClose) {
        const done = onClose;
        onClose = null;
        expect(Buffer.concat(socket.data).toString("utf8")).toBe(message);
        done();
      }
    }

    server = Bun.listen({
      hostname: "localhost",
      port: port,
      socket: {
        close,
        data(socket, buffer) {
          socket.data.push(buffer);
        },
        end: close,
        error(socket, err) {
          onClose(err);
        },
        open(socket) {
          socket.data = [];
        },
      },
    });
  });

  it("should work with .end(data)", done => {
    onClose = done;
    const socket = new Socket().connect(port).on("ready", () => {
      expect(socket).toBeDefined();
      expect(socket.connecting).toBe(false);
    }).on("error", done).end(message);
  });

  it("should work with .write(data).end()", done => {
    onClose = done;
    const socket = new Socket().connect(port, () => {
      expect(socket).toBeDefined();
      expect(socket.connecting).toBe(false);
    }).on("error", done);
    socket.write(message);
    socket.end();
  });

  it("should work with multiple .write()s", done => {
    onClose = done;
    const socket = new Socket().connect(port, "localhost", () => {
      expect(socket).toBeDefined();
      expect(socket.connecting).toBe(false);
    }).on("error", done);
    const size = 10;
    for (let i = 0; i < message.length; i += size) {
      socket.write(message.slice(i, i + size));
    }
    socket.end();
  });

  afterAll(() => server.stop());
});
