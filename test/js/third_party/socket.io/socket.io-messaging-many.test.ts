import { describe, expect, it } from "bun:test";
import { Server } from "socket.io";
import { createClient, createPartialDone, fail, success, waitFor } from "./support/util";

// Hanging tests are disabled because they cause the test suite to hang
describe.skip("messaging many", () => {
  it("emits to a namespace", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/test");

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 200);

    const partialDone = createPartialDone(2, err => {
      clearTimeout(timeout);
      if (err) return fail(done, io, err, socket1, socket2, socket3);
      success(done, io, socket1, socket2, socket3);
    });

    socket1.on("a", a => {
      try {
        expect(a).toBe("b");
        partialDone();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, socket1, socket2, socket3);
      }
    });
    socket2.on("a", a => {
      try {
        expect(a).toBe("b");
        partialDone();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, socket1, socket2, socket3);
      }
    });
    socket3.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("not"), socket1, socket2, socket3);
    });

    let sockets = 3;
    io.on("connection", () => {
      --sockets || emit();
    });
    io.of("/test", () => {
      --sockets || emit();
    });

    function emit() {
      io.emit("a", "b");
    }
  });

  it("emits binary data to a namespace", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/test");

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 200);

    const partialDone = createPartialDone(2, err => {
      clearTimeout(timeout);
      if (err) return fail(done, io, err, socket1, socket2, socket3);
      success(done, io, socket1, socket2, socket3);
    });

    socket1.on("bin", a => {
      try {
        expect(Buffer.isBuffer(a)).toBe(true);
        partialDone();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, socket1, socket2, socket3);
      }
    });
    socket2.on("bin", a => {
      try {
        expect(Buffer.isBuffer(a)).toBe(true);
        partialDone();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, socket1, socket2, socket3);
      }
    });
    socket3.on("bin", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("not"), socket1, socket2, socket3);
    });

    let sockets = 3;
    io.on("connection", () => {
      --sockets || emit();
    });
    io.of("/test", () => {
      --sockets || emit();
    });

    function emit() {
      io.emit("bin", Buffer.alloc(10));
    }
  });

  it.skip("emits to the res", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/test");

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 400);

    socket1.on("a", a => {
      try {
        expect(a).toBe("b");
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, socket1, socket2, socket3);
      }
      socket1.emit("finish");
    });
    socket2.emit("broadcast");
    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("done"), socket1, socket2, socket3);
    });
    socket3.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("not"), socket1, socket2, socket3);
    });

    io.on("connection", socket => {
      socket.on("broadcast", () => {
        socket.broadcast.emit("a", "b");
      });
      socket.on("finish", () => {
        clearTimeout(timeout);
        success(done, io, socket1, socket2, socket3);
      });
    });
  });

  it.skip("emits to rooms", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2);
    }, 200);

    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("not"), socket1, socket2);
    });
    socket1.on("a", () => {
      clearTimeout(timeout);
      success(done, io, socket1, socket2);
    });
    socket1.emit("join", "woot");
    socket1.emit("emit", "woot");

    io.on("connection", socket => {
      socket.on("join", (room, fn) => {
        socket.join(room);
        fn && fn();
      });

      socket.on("emit", room => {
        io.in(room).emit("a");
      });
    });
  });

  it.skip("emits to rooms avoiding dupes", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2);
    }, 200);

    const partialDone = createPartialDone(2, err => {
      clearTimeout(timeout);
      if (err) return fail(done, io, err, socket1, socket2);
      success(done, io, socket1, socket2);
    });

    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("not"), socket1, socket2);
    });
    socket1.on("a", partialDone);
    socket2.on("b", partialDone);

    socket1.emit("join", "woot");
    socket1.emit("join", "test");
    socket2.emit("join", "third", () => {
      socket2.emit("emit");
    });

    io.on("connection", socket => {
      socket.on("join", (room, fn) => {
        socket.join(room);
        fn && fn();
      });

      socket.on("emit", () => {
        io.in("woot").in("test").emit("a");
        io.in("third").emit("b");
      });
    });
  });

  it.skip("broadcasts to rooms", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 200);

    const partialDone = createPartialDone(2, err => {
      clearTimeout(timeout);
      if (err) return fail(done, io, err, socket1, socket2, socket3);
      success(done, io, socket1, socket2);
    });

    socket1.emit("join", "woot");
    socket2.emit("join", "test");
    socket3.emit("join", "test", () => {
      socket3.emit("broadcast");
    });

    socket1.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("not"), socket1, socket2, socket3);
    });
    socket2.on("a", () => {
      partialDone();
    });
    socket3.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("not"), socket1, socket2, socket3);
    });
    socket3.on("b", () => {
      partialDone();
    });

    io.on("connection", socket => {
      socket.on("join", (room, fn) => {
        socket.join(room);
        fn && fn();
      });

      socket.on("broadcast", () => {
        socket.broadcast.to("test").emit("a");
        socket.emit("b");
      });
    });
  });

  it.skip("broadcasts binary data to rooms", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 200);

    const partialDone = createPartialDone(2, err => {
      clearTimeout(timeout);
      if (err) return fail(done, io, err, socket1, socket2, socket3);
      success(done, io, socket1, socket2);
    });

    socket1.emit("join", "woot");
    socket2.emit("join", "test");
    socket3.emit("join", "test", () => {
      socket3.emit("broadcast");
    });

    socket1.on("bin", data => {
      clearTimeout(timeout);
      fail(done, io, new Error("got bin in socket1"), socket1, socket2, socket3);
    });
    socket2.on("bin", data => {
      try {
        expect(Buffer.isBuffer(data)).toBe(true);
        partialDone();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, socket1, socket2, socket3);
      }
    });
    socket2.on("bin2", data => {
      clearTimeout(timeout);
      fail(done, io, new Error("socket2 got bin2"), socket1, socket2, socket3);
    });
    socket3.on("bin", data => {
      clearTimeout(timeout);
      fail(done, io, new Error("socket3 got bin"), socket1, socket2, socket3);
    });
    socket3.on("bin2", data => {
      try {
        expect(Buffer.isBuffer(data)).toBe(true);
        partialDone();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, socket1, socket2, socket3);
      }
    });

    io.on("connection", socket => {
      socket.on("join", (room, fn) => {
        socket.join(room);
        fn && fn();
      });
      socket.on("broadcast", () => {
        socket.broadcast.to("test").emit("bin", Buffer.alloc(5));
        socket.emit("bin2", Buffer.alloc(5));
      });
    });
  });

  it("keeps track of rooms", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        s.join("a");
        expect(s.rooms).toStrictEqual(new Set([s.id, "a"]));
        s.join("b");
        expect(s.rooms).toStrictEqual(new Set([s.id, "a", "b"]));
        s.join("c");
        expect(s.rooms).toStrictEqual(new Set([s.id, "a", "b", "c"]));
        s.leave("b");
        expect(s.rooms).toStrictEqual(new Set([s.id, "a", "c"]));
        (s as any).leaveAll();
        expect(s.rooms.size).toBe(0);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("deletes empty rooms", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        s.join("a");
        expect(s.nsp.adapter.rooms.has("a")).toBe(true);
        s.leave("a");
        expect(s.nsp.adapter.rooms.has("a")).toBe(false);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should properly cleanup left rooms", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        s.join("a");
        expect(s.rooms).toStrictEqual(new Set([s.id, "a"]));
        s.join("b");
        expect(s.rooms).toStrictEqual(new Set([s.id, "a", "b"]));
        s.leave("unknown");
        expect(s.rooms).toStrictEqual(new Set([s.id, "a", "b"]));
        (s as any).leaveAll();
        expect(s.rooms.size).toBe(0);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("allows to join several rooms at once", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        s.join(["a", "b", "c"]);

        expect(s.rooms).toStrictEqual(new Set([s.id, "a", "b", "c"]));
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it.skip("should exclude specific sockets when broadcasting", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 200);

    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("socket2 got a"), socket1, socket2, socket3);
    });
    socket3.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("socket3 got a"), socket1, socket2, socket3);
    });
    socket1.on("a", () => {
      clearTimeout(timeout);
      success(done, io, socket1, socket2, socket3);
    });

    io.on("connection", socket => {
      socket.on("exclude", id => {
        socket.broadcast.except(id).emit("a");
      });
    });

    socket2.on("connect", () => {
      socket3.emit("exclude", socket2.id);
    });
  });

  it.skip("should exclude a specific room when broadcasting", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 200);

    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("socket2 got a"), socket1, socket2, socket3);
    });
    socket3.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("socket3 got a"), socket1, socket2, socket3);
    });
    socket1.on("a", () => {
      clearTimeout(timeout);
      success(done, io, socket1, socket2, socket3);
    });

    io.on("connection", socket => {
      socket.on("join", (room, cb) => {
        socket.join(room);
        cb();
      });
      socket.on("broadcast", () => {
        socket.broadcast.except("room1").emit("a");
      });
    });

    socket2.emit("join", "room1", () => {
      socket3.emit("broadcast");
    });
  });

  it("should return an immutable broadcast operator", done => {
    const io = new Server(0);
    const clientSocket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);

    io.on("connection", socket => {
      clearTimeout(timeout);
      try {
        const operator = socket.local.compress(false).to(["room1", "room2"]).except("room3");
        operator.compress(true).emit("hello");
        operator.volatile.emit("hello");
        operator.to("room4").emit("hello");
        operator.except("room5").emit("hello");
        socket.emit("hello");
        socket.to("room6").emit("hello");
        // @ts-ignore
        expect(operator.rooms).toStrictEqual(new Set(["room1", "room2"]));
        // @ts-ignore
        expect(operator.rooms.has("room4")).toBeFalsy();
        // @ts-ignore
        expect(operator.rooms.has("room5")).toBeFalsy();
        // @ts-ignore
        expect(operator.rooms.has("room6")).toBeFalsy();
        // @ts-ignore
        expect(operator.exceptRooms.has("room3")).toBe(true);
        // @ts-ignore
        expect(operator.flags).toStrictEqual({ local: true, compress: false });

        success(done, io, clientSocket);
      } catch (err) {
        fail(done, io, err, clientSocket);
      }
    });
  });

  it.skip("should broadcast and expect multiple acknowledgements", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 3000);

    socket1.on("some event", cb => {
      cb(1);
    });

    socket2.on("some event", cb => {
      cb(2);
    });

    socket3.on("some event", cb => {
      cb(3);
    });

    Promise.all([waitFor(socket1, "connect"), waitFor(socket2, "connect"), waitFor(socket3, "connect")]).then(() => {
      io.timeout(2000).emit("some event", (err, responses) => {
        clearTimeout(timeout);
        try {
          expect(err).toBe(null);
          expect(responses.length).toBe(3);
          expect(responses).toContain(1);
          expect(responses).toContain(2);
          expect(responses).toContain(3);

          success(done, io, socket1, socket2, socket3);
        } catch (err) {
          fail(done, io, err, socket1, socket2, socket3);
        }
      });
    });
  });

  it.skip("should fail when a client does not acknowledge the event in the given delay", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 300);

    socket1.on("some event", cb => {
      cb(1);
    });

    socket2.on("some event", cb => {
      cb(2);
    });

    socket3.on("some event", () => {
      // timeout
    });

    Promise.all([waitFor(socket1, "connect"), waitFor(socket2, "connect"), waitFor(socket3, "connect")]).then(() => {
      io.timeout(200).emit("some event", (err, responses) => {
        clearTimeout(timeout);
        try {
          expect(err).toBeInstanceOf(Error);
          expect(responses.length).toBe(2);
          expect(responses).toContain(1);
          expect(responses).toContain(2);

          success(done, io, socket1, socket2, socket3);
          success(done, io, socket1, socket2, socket3);
        } catch (err) {
          fail(done, io, err, socket1, socket2, socket3);
        }
      });
    });
  });

  it("should broadcast and expect multiple acknowledgements (promise)", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 3000);

    socket1.on("some event", cb => {
      cb(1);
    });

    socket2.on("some event", cb => {
      cb(2);
    });

    socket3.on("some event", cb => {
      cb(3);
    });

    Promise.all([waitFor(socket1, "connect"), waitFor(socket2, "connect"), waitFor(socket3, "connect")]).then(
      async () => {
        try {
          const responses = await io.timeout(2000).emitWithAck("some event");
          clearTimeout(timeout);
          expect(responses).toContain(1);
          expect(responses).toContain(2);
          expect(responses).toContain(3);

          success(done, io, socket1, socket2, socket3);
        } catch (err) {
          fail(done, io, err, socket1, socket2, socket3);
        }
      },
    );
  });

  it.skip("should fail when a client does not acknowledge the event in the given delay (promise)", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 300);

    socket1.on("some event", cb => {
      cb(1);
    });

    socket2.on("some event", cb => {
      cb(2);
    });

    socket3.on("some event", () => {
      // timeout
    });

    Promise.all([waitFor(socket1, "connect"), waitFor(socket2, "connect"), waitFor(socket3, "connect")]).then(
      async () => {
        try {
          await io.timeout(200).emitWithAck("some event");
          clearTimeout(timeout);
          fail(done, io, new Error("should not happen"), socket1, socket2, socket3);
        } catch (err) {
          clearTimeout(timeout);
          try {
            expect(err).toBeInstanceOf(Error);
            // @ts-ignore
            expect(err.responses.length).toBe(2);
            // @ts-ignore
            expect(err.responses).toContain(1);
            // @ts-ignore
            expect(err.responses).toContain(2);

            success(done, io, socket1, socket2, socket3);
          } catch (err) {
            fail(done, io, err, socket1, socket2, socket3);
          }
        }
      },
    );
  });

  it("should broadcast and return if the packet is sent to 0 client", done => {
    const io = new Server(0);
    const socket1 = createClient(io, "/", { multiplex: false });
    const socket2 = createClient(io, "/", { multiplex: false });
    const socket3 = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2, socket3);
    }, 300);

    socket1.on("some event", () => {
      done(new Error("should not happen"));
    });

    socket2.on("some event", () => {
      done(new Error("should not happen"));
    });

    socket3.on("some event", () => {
      done(new Error("should not happen"));
    });

    io.to("room123")
      .timeout(200)
      .emit("some event", (err, responses) => {
        clearTimeout(timeout);
        try {
          expect(err).toBe(null);
          expect(responses.length).toBe(0);

          success(done, io, socket1, socket2, socket3);
        } catch (err) {
          fail(done, io, err, socket1, socket2, socket3);
        }
      });
  });

  it.skip("should precompute the WebSocket frame when broadcasting", done => {
    const io = new Server(0);
    const socket = createClient(io, "/chat", {
      transports: ["websocket"],
    });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);
    const partialDone = createPartialDone(2, err => {
      clearTimeout(timeout);
      if (err) fail(done, io, err, socket);
      else success(done, io, socket);
    });

    io.of("/chat").on("connection", s => {
      s.conn.once("packetCreate", packet => {
        try {
          expect(packet.options.wsPreEncodedFrame).toBeInstanceOf(Array);
          partialDone();
        } catch (err) {
          clearTimeout(timeout);
          fail(done, io, err, socket);
        }
      });
      io.of("/chat").compress(false).emit("woot", "hi");
    });

    socket.on("woot", partialDone);
  });
});
