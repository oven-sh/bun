import { describe, expect, it } from "bun:test";
import { Server, Socket } from "socket.io";

import { createClient, createPartialDone, fail, success } from "./support/util.ts";

// Hanging tests are disabled because they cause the test suite to hang
describe.skip("middleware", () => {
  it.skip("should call functions", done => {
    const io = new Server(0);
    let timeout: Timer;

    let run = 0;
    io.use((socket, next) => {
      try {
        expect(socket).toBeInstanceOf(Socket);
        run++;
        next();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err);
      }
    });
    io.use((socket, next) => {
      try {
        expect(socket).toBeInstanceOf(Socket);
        run++;
        next();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err);
      }
    });

    const socket = createClient(io);
    timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    socket.on("connect", () => {
      try {
        clearTimeout(timeout);
        expect(run).toBe(2);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should pass errors", done => {
    const io = new Server(0);
    let timeout: Timer;
    let socket;
    io.use((socket, next) => {
      next(new Error("Authentication error"));
    });
    io.use((socket, next) => {
      clearTimeout(timeout);
      fail(done, io, new Error("nope"), socket);
    });

    socket = createClient(io);
    timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    socket.on("connect", () => {
      done(new Error("nope"));
    });
    socket.on("connect_error", err => {
      try {
        clearTimeout(timeout);
        expect(err.message).toBe("Authentication error");

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should pass an object", done => {
    const io = new Server(0);

    io.use((socket, next) => {
      const err = new Error("Authentication error");
      // @ts-ignore
      err.data = { a: "b", c: 3 };
      next(err);
    });

    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    socket.on("connect", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("nope"), socket);
    });

    socket.on("connect_error", err => {
      try {
        clearTimeout(timeout);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe("Authentication error");
        // @ts-ignore
        expect(err.data).toStrictEqual({ a: "b", c: 3 });

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should only call connection after fns", done => {
    const io = new Server(0);

    io.use((socket: any, next) => {
      socket.name = "guillermo";
      next();
    });

    const clientSocket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);

    io.on("connection", socket => {
      try {
        clearTimeout(timeout);
        expect((socket as any).name).toBe("guillermo");

        success(done, io, clientSocket);
      } catch (err) {
        fail(done, io, err, clientSocket);
      }
    });
  });

  it("should only call connection after (lengthy) fns", done => {
    const io = new Server(0);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 2000);

    let authenticated = false;

    io.use((socket, next) => {
      setTimeout(() => {
        authenticated = true;
        next();
      }, 300);
    });

    const socket = createClient(io);
    socket.on("connect", () => {
      try {
        clearTimeout(timeout);
        expect(authenticated).toBe(true);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should be ignored if socket gets closed", done => {
    const io = new Server(0);
    let timeout: Timer;
    let socket;
    io.use((s, next) => {
      socket.io.engine.close();
      s.client.conn.on("close", () => {
        process.nextTick(next);
        setTimeout(() => {
          clearTimeout(timeout);
          success(done, io, socket);
        }, 50);
      });
    });

    socket = createClient(io);
    timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", socket => {
      clearTimeout(timeout);
      fail(done, io, new Error("should not fire"), socket);
    });
  });

  it("should call functions in expected order", done => {
    const io = new Server(0);

    const result: number[] = [];

    io.use(() => {
      fail(done, io, new Error("should not fire"));
    });
    io.of("/chat").use((socket, next) => {
      result.push(1);
      setTimeout(next, 50);
    });
    io.of("/chat").use((socket, next) => {
      result.push(2);
      setTimeout(next, 50);
    });
    io.of("/chat").use((socket, next) => {
      result.push(3);
      setTimeout(next, 50);
    });

    const chat = createClient(io, "/chat");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), chat);
    }, 1000);

    chat.on("connect", () => {
      clearTimeout(timeout);
      try {
        expect(result).toStrictEqual([1, 2, 3]);

        success(done, io, chat);
      } catch (err) {
        fail(done, io, err, chat);
      }
    });
  });

  it("should disable the merge of handshake packets", done => {
    const io = new Server(0);
    io.use((socket, next) => {
      next();
    });

    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    socket.on("connect", () => {
      clearTimeout(timeout);
      success(done, io, socket);
    });
  });

  it("should work with a custom namespace", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/");
    const socket2 = createClient(io, "/chat");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2);
    }, 200);

    const partialDone = createPartialDone(2, () => {
      clearTimeout(timeout);
      success(done, io, socket1, socket2);
    });

    io.of("/chat").use((socket, next) => {
      next();
    });

    socket1.on("connect", partialDone);
    socket2.on("connect", partialDone);
  });

  it("should only set `connected` to true after the middleware execution", done => {
    const io = new Server(0);
    const clientSocket = createClient(io, "/");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);
    io.use((socket, next) => {
      try {
        expect(socket.connected).toBe(false);
        expect(socket.disconnected).toBe(true);
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, clientSocket);
      }
      next();
    });

    io.on("connection", socket => {
      try {
        clearTimeout(timeout);
        expect(socket.connected).toBe(true);
        expect(socket.disconnected).toBe(false);

        success(done, io, clientSocket);
      } catch (err) {
        fail(done, io, err, clientSocket);
      }
    });
  });
});
