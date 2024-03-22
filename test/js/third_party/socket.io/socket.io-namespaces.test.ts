import { describe, it, expect } from "bun:test";
import type { SocketId } from "socket.io-adapter";
import { Server, Namespace, Socket } from "socket.io";
import { success, fail, createClient, createPartialDone } from "./support/util.ts";

// Hanging tests are disabled because they cause the test suite to hang
describe.skip("namespaces", () => {
  it("should be accessible through .sockets", done => {
    const io = new Server();
    expect(io.sockets).toBeInstanceOf(Namespace);
    done();
  });

  it("should be aliased", done => {
    const io = new Server();
    expect(typeof io.use).toBe("function");
    expect(typeof io.to).toBe("function");
    expect(typeof io["in"]).toBe("function");
    expect(typeof io.emit).toBe("function");
    expect(typeof io.send).toBe("function");
    expect(typeof io.write).toBe("function");
    expect(typeof io.allSockets).toBe("function");
    expect(typeof io.compress).toBe("function");
    done();
  });

  it("should return an immutable broadcast operator", done => {
    const io = new Server();
    const operator = io.local.to(["room1", "room2"]).except("room3");
    operator.compress(true).emit("hello");
    operator.volatile.emit("hello");
    operator.to("room4").emit("hello");
    operator.except("room5").emit("hello");
    io.to("room6").emit("hello");
    // @ts-ignore
    expect(operator.rooms).toStrictEqual(new Set(["room1", "room2"]));
    // @ts-ignore
    expect(operator.exceptRooms).toStrictEqual(new Set(["room3"]));
    // @ts-ignore
    expect(operator.flags).toStrictEqual({ local: true });

    done();
  });

  it("should automatically connect", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    socket.on("connect", () => {
      clearTimeout(timeout);
      success(done, io, socket);
    });
  });

  it("should fire a `connection` event", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);
    io.on("connection", s => {
      clearTimeout(timeout);
      expect(s).toBeInstanceOf(Socket);
      success(done, io, socket);
    });
  });

  it("should fire a `connect` event", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);
    io.on("connect", s => {
      clearTimeout(timeout);
      expect(s).toBeInstanceOf(Socket);
      success(done, io, socket);
    });
  });

  it("should work with many sockets", done => {
    const io = new Server(0);
    io.of("/chat");
    io.of("/news");
    const chat = createClient(io, "/chat");
    const news = createClient(io, "/news");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), chat, news);
    }, 300);

    let total = 2;
    function _success() {
      clearTimeout(timeout);
      success(done, io, chat, news);
    }

    chat.on("connect", () => {
      --total || _success();
    });
    news.on("connect", () => {
      --total || _success();
    });
  });

  it('should be able to equivalently start with "" or "/" on server', done => {
    const io = new Server(0);
    const c1 = createClient(io, "/");
    const c2 = createClient(io, "/abc");

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), c1, c2);
    }, 300);

    let total = 2;
    function _success() {
      clearTimeout(timeout);
      success(done, io, c1, c2);
    }

    io.of("").on("connection", () => {
      --total || _success();
    });
    io.of("abc").on("connection", () => {
      --total || _success();
    });
  });

  it('should be equivalent for "" and "/" on client', done => {
    const io = new Server(0);
    const c1 = createClient(io, "");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), c1);
    }, 300);
    io.of("/").on("connection", () => {
      clearTimeout(timeout);
      success(done, io, c1);
    });
  });

  it("should work with `of` and many sockets", done => {
    const io = new Server(0);
    const chat = createClient(io, "/chat");
    const news = createClient(io, "/news");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), chat, news);
    }, 300);

    let total = 2;
    function _success() {
      clearTimeout(timeout);
      success(done, io, chat, news);
    }
    io.of("/news").on("connection", socket => {
      try {
        expect(socket).toBeInstanceOf(Socket);
        --total || _success();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, chat, news);
      }
    });
    io.of("/news").on("connection", socket => {
      try {
        expect(socket).toBeInstanceOf(Socket);
        --total || _success();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, chat, news);
      }
    });
  });

  it.skip("should work with `of` second param", done => {
    const io = new Server(0);
    const chat = createClient(io, "/chat");
    const news = createClient(io, "/news");

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), chat, news);
    }, 300);

    let total = 2;
    function _success() {
      clearTimeout(timeout);
      success(done, io, chat, news);
    }
    io.of("/news", socket => {
      try {
        expect(socket).toBeInstanceOf(Socket);
        --total || _success();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, chat, news);
      }
    });
    io.of("/news", socket => {
      try {
        expect(socket).toBeInstanceOf(Socket);
        --total || _success();
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, chat, news);
      }
    });
  });

  it.skip("should disconnect upon transport disconnection", done => {
    const io = new Server(0);
    const chat = createClient(io, "/chat");
    const news = createClient(io, "/news");

    let total = 2;
    let totald = 2;
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), chat, news);
    }, 300);

    function _success() {
      clearTimeout(timeout);
      success(done, io, chat, news);
    }

    function close() {
      s.disconnect(true);
    }

    let s: Socket;
    io.of("/news", socket => {
      socket.on("disconnect", reason => {
        --totald || _success();
      });
      --total || close();
    });
    io.of("/chat", socket => {
      s = socket;
      socket.on("disconnect", reason => {
        --totald || _success();
      });
      --total || close();
    });
  });

  it.skip("should fire a `disconnecting` event just before leaving all rooms", done => {
    const io = new Server(0);
    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.on("connection", s => {
      s.join("a");
      // FIXME not sure why process.nextTick() is needed here
      process.nextTick(() => s.disconnect());

      let total = 2;

      function _success() {
        clearTimeout(timeout);
        success(done, io, socket);
      }

      s.on("disconnecting", reason => {
        try {
          expect(s.rooms).toStrictEqual(new Set([s.id, "a"]));
          total--;
        } catch (err) {
          clearTimeout(timeout);
          fail(done, io, err, socket);
        }
      });

      s.on("disconnect", reason => {
        try {
          expect(s.rooms.size).toBe(0);
          --total || _success();
        } catch (err) {
          clearTimeout(timeout);
          fail(done, io, err, socket);
        }
      });
    });
  });

  it.skip("should return error connecting to non-existent namespace", done => {
    const io = new Server(0);
    const socket = createClient(io, "/doesnotexist");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    socket.on("connect_error", err => {
      clearTimeout(timeout);
      try {
        expect(err.message).toBe("Invalid namespace");
        success(done, io);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it.skip("should not reuse same-namespace connections", done => {
    const io = new Server(0);
    const clientSocket1 = createClient(io);
    const clientSocket2 = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket1, clientSocket2);
    }, 300);

    let connections = 0;
    io.on("connection", () => {
      connections++;
      if (connections === 2) {
        clearTimeout(timeout);
        success(done, io, clientSocket1, clientSocket2);
      }
    });
  });

  it.skip("should find all clients in a namespace", done => {
    const io = new Server(0);
    const chatSids: string[] = [];
    let otherSid: SocketId | null = null;

    const c1 = createClient(io, "/chat");
    const c2 = createClient(io, "/chat", { forceNew: true });
    const c3 = createClient(io, "/other", { forceNew: true });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), c1, c2, c3);
    }, 300);

    let total = 3;
    io.of("/chat").on("connection", socket => {
      chatSids.push(socket.id);
      --total || getSockets();
    });
    io.of("/other").on("connection", socket => {
      otherSid = socket.id;
      --total || getSockets();
    });

    async function getSockets() {
      const sids = await io.of("/chat").allSockets();
      clearTimeout(timeout);
      try {
        expect(sids).toStrictEqual(new Set([chatSids[0], chatSids[1]]));
        expect(sids).not.toContain(otherSid);
        success(done, io, c1, c2, c3);
      } catch (err) {
        fail(done, io, err, c1, c2, c3);
      }
    }
  });

  it.skip("should find all clients in a namespace room", done => {
    const io = new Server(0);
    let chatFooSid: SocketId | null = null;
    let chatBarSid: SocketId | null = null;
    let otherSid: SocketId | null = null;

    const c1 = createClient(io, "/chat");
    const c2 = createClient(io, "/chat", { forceNew: true });
    const c3 = createClient(io, "/other", { forceNew: true });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), c1, c2, c3);
    }, 300);

    let chatIndex = 0;
    let total = 3;
    io.of("/chat").on("connection", socket => {
      if (chatIndex++) {
        socket.join("foo");
        chatFooSid = socket.id;
        --total || getSockets();
      } else {
        socket.join("bar");
        chatBarSid = socket.id;
        --total || getSockets();
      }
    });
    io.of("/other").on("connection", socket => {
      socket.join("foo");
      otherSid = socket.id;
      --total || getSockets();
    });

    async function getSockets() {
      const sids = await io.of("/chat").in("foo").allSockets();
      clearTimeout(timeout);
      try {
        expect(sids).toStrictEqual(new Set([chatFooSid]));
        expect(sids).not.toContain(chatBarSid);
        expect(sids).not.toContain(otherSid);
        success(done, io, c1, c2, c3);
      } catch (err) {
        fail(done, io, err, c1, c2, c3);
      }
    }
  });

  it.skip("should find all clients across namespace rooms", done => {
    const io = new Server(0);
    let chatFooSid: SocketId | null = null;
    let chatBarSid: SocketId | null = null;
    let otherSid: SocketId | null = null;

    const c1 = createClient(io, "/chat");
    const c2 = createClient(io, "/chat", { forceNew: true });
    const c3 = createClient(io, "/other", { forceNew: true });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), c1, c2, c3);
    }, 300);

    let chatIndex = 0;
    let total = 3;
    io.of("/chat").on("connection", socket => {
      if (chatIndex++) {
        socket.join("foo");
        chatFooSid = socket.id;
        --total || getSockets();
      } else {
        socket.join("bar");
        chatBarSid = socket.id;
        --total || getSockets();
      }
    });
    io.of("/other").on("connection", socket => {
      socket.join("foo");
      otherSid = socket.id;
      --total || getSockets();
    });

    async function getSockets() {
      const sids = await io.of("/chat").allSockets();
      clearTimeout(timeout);
      try {
        expect(sids).toStrictEqual(new Set([chatFooSid, chatBarSid]));
        expect(sids).not.toContain(otherSid);
        success(done, io, c1, c2, c3);
      } catch (err) {
        fail(done, io, err, c1, c2, c3);
      }
    }
  });

  it("should not emit volatile event after regular event", done => {
    const io = new Server(0);

    let counter = 0;
    io.of("/chat").on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        io.of("/chat").emit("ev", "data");
        io.of("/chat").volatile.emit("ev", "data");
      }, 50);
    });

    const socket = createClient(io, "/chat");
    socket.on("ev", () => {
      counter++;
    });

    setTimeout(() => {
      try {
        expect(counter).toBe(1);
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    }, 300);
  });

  it("should emit volatile event", done => {
    const io = new Server(0);

    let counter = 0;
    io.of("/chat").on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        io.of("/chat").volatile.emit("ev", "data");
      }, 100);
    });

    const socket = createClient(io, "/chat");
    socket.on("ev", () => {
      counter++;
    });

    setTimeout(() => {
      try {
        expect(counter).toBe(1);
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    }, 300);
  });

  it("should enable compression by default", done => {
    const io = new Server(0);
    const socket = createClient(io, "/chat");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.of("/chat").on("connection", s => {
      s.conn.once("packetCreate", packet => {
        clearTimeout(timeout);
        try {
          expect(packet.options.compress).toBe(true);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      io.of("/chat").emit("woot", "hi");
    });
  });

  it("should disable compression", done => {
    const io = new Server(0);
    const socket = createClient(io, "/chat");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.of("/chat").on("connection", s => {
      s.conn.once("packetCreate", packet => {
        clearTimeout(timeout);
        try {
          expect(packet.options.compress).toBe(false);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      io.of("/chat").compress(false).emit("woot", "hi");
    });
  });

  it("should throw on reserved event", () => {
    const io = new Server();

    expect(() => io.emit("connect")).toThrow(/"connect" is a reserved event name/);
  });

  it("should close a client without namespace", done => {
    const io = new Server(0, {
      connectTimeout: 10,
    });

    const socket = createClient(io);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    // @ts-ignore
    socket.io.engine.write = () => {}; // prevent the client from sending a CONNECT packet

    socket.on("disconnect", () => {
      clearTimeout(timeout);
      success(done, io, socket);
    });
  });

  it("should exclude a specific socket when emitting", done => {
    const io = new Server(0);

    const socket1 = createClient(io, "/");
    const socket2 = createClient(io, "/");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2);
    }, 300);

    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("should not happen"), socket1, socket2);
    });
    socket1.on("a", () => {
      clearTimeout(timeout);
      success(done, io, socket1, socket2);
    });

    socket2.on("connect", () => {
      io.except(socket2.id).emit("a");
    });
  });

  it("should exclude a specific socket when emitting (in a namespace)", done => {
    const io = new Server(0);

    const nsp = io.of("/nsp");

    const socket1 = createClient(io, "/nsp");
    const socket2 = createClient(io, "/nsp");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2);
    }, 300);

    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("should not happen"), socket1, socket2);
    });
    socket1.on("a", () => {
      clearTimeout(timeout);
      success(done, io, socket1, socket2);
    });

    socket2.on("connect", () => {
      nsp.except(socket2.id).emit("a");
    });
  });

  it("should exclude a specific room when emitting", done => {
    const io = new Server(0);

    const nsp = io.of("/nsp");

    const socket1 = createClient(io, "/nsp");
    const socket2 = createClient(io, "/nsp");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket1, socket2);
    }, 300);

    socket1.on("a", () => {
      clearTimeout(timeout);
      success(done, io, socket1, socket2);
    });
    socket2.on("a", () => {
      clearTimeout(timeout);
      fail(done, io, new Error("should not happen"), socket1, socket2);
    });

    nsp.on("connection", socket => {
      socket.on("broadcast", () => {
        socket.join("room1");
        nsp.except("room1").emit("a");
      });
    });

    socket2.emit("broadcast");
  });

  it("should emit an 'new_namespace' event", done => {
    const io = new Server();

    io.on("new_namespace", namespace => {
      expect(namespace.name).toBe("/nsp");
      done();
    });

    io.of("/nsp");
  });

  it("should not clean up a non-dynamic namespace", done => {
    const io = new Server(0, { cleanupEmptyChildNamespaces: true });
    const c1 = createClient(io, "/chat");

    c1.on("connect", () => {
      c1.disconnect();

      // Give it some time to disconnect the client
      setTimeout(() => {
        try {
          expect(io._nsps.has("/chat")).toBe(true);
          expect(io._nsps.get("/chat")!.sockets.size).toBe(0);
          success(done, io);
        } catch (err) {
          fail(done, io, err);
        }
      }, 100);
    });

    io.of("/chat");
  });

  describe("dynamic namespaces", () => {
    it.skip("should allow connections to dynamic namespaces with a regex", done => {
      const io = new Server(0);
      const socket = createClient(io, "/dynamic-101");
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), socket);
      }, 300);

      const partialDone = createPartialDone(4, () => {
        clearTimeout(timeout);
        success(done, io, socket);
      });

      let dynamicNsp = io
        .of(/^\/dynamic-\d+$/)
        .on("connect", socket => {
          try {
            expect(socket.nsp.name).toBe("/dynamic-101");
            dynamicNsp.emit("hello", 1, "2", { 3: "4" });
            partialDone();
          } catch (err) {
            fail(done, io, err, socket);
          }
        })
        .use((socket, next) => {
          next();
          partialDone();
        });
      socket.on("connect_error", err => {
        clearTimeout(timeout);
        fail(done, io, err, socket);
      });
      socket.on("connect", () => {
        partialDone();
      });
      socket.on("hello", (a, b, c) => {
        try {
          expect(a).toBe(1);
          expect(b).toBe("2");
          expect(c).toStrictEqual({ 3: "4" });
          partialDone();
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
    });

    it.skip("should allow connections to dynamic namespaces with a function", done => {
      const io = new Server(0);
      const socket = createClient(io, "/dynamic-101");
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), socket);
      }, 300);

      io.of((name, query, next) => next(null, "/dynamic-101" === name));
      socket.on("connect", () => {
        clearTimeout(timeout);
        success(done, io, socket);
      });
    });

    it("should disallow connections when no dynamic namespace matches", done => {
      const io = new Server(0);
      const socket = createClient(io, "/abc");
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), socket);
      }, 300);

      io.of(/^\/dynamic-\d+$/);
      io.of((name, query, next) => next(null, "/dynamic-101" === name));

      socket.on("connect_error", err => {
        clearTimeout(timeout);
        try {
          expect(err.message).toBe("Invalid namespace");
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
    });

    it("should emit an 'new_namespace' event for a dynamic namespace", done => {
      const io = new Server(0);
      io.of(/^\/dynamic-\d+$/);
      const socket = createClient(io, "/dynamic-101");
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), socket);
      }, 300);
      io.on("new_namespace", namespace => {
        clearTimeout(timeout);
        try {
          expect(namespace.name).toBe("/dynamic-101");

          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
    });

    it("should handle race conditions with dynamic namespaces (#4136)", done => {
      const io = new Server(0);
      let timeout: Timer;
      const counters = {
        connected: 0,
        created: 0,
        events: 0,
      };
      const buffer: Function[] = [];
      io.on("new_namespace", namespace => {
        counters.created++;
      });

      const handler = () => {
        if (++counters.events === 2) {
          clearTimeout(timeout);
          try {
            expect(counters.created).toBe(1);
            success(done, io, one, two);
          } catch (err) {
            fail(done, io, err, one, two);
          }
        }
      };

      io.of((name, query, next) => {
        buffer.push(next);
        if (buffer.length === 2) {
          buffer.forEach(next => next(null, true));
        }
      }).on("connection", socket => {
        if (++counters.connected === 2) {
          io.of("/dynamic-101").emit("message");
        }
      });

      let one = createClient(io, "/dynamic-101");
      let two = createClient(io, "/dynamic-101");
      timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), one, two);
      }, 300);
      one.on("message", handler);
      two.on("message", handler);
    });

    it("should clean up namespace when cleanupEmptyChildNamespaces is on and there are no more sockets in a namespace", done => {
      const io = new Server(0, { cleanupEmptyChildNamespaces: true });
      const c1 = createClient(io, "/dynamic-101");
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), c1);
      }, 300);

      c1.on("connect", () => {
        c1.disconnect();

        // Give it some time to disconnect and clean up the namespace
        setTimeout(() => {
          clearTimeout(timeout);
          try {
            expect(io._nsps.has("/dynamic-101")).toBe(false);
            success(done, io);
          } catch (err) {
            fail(done, io, err, c1);
          }
        }, 100);
      });

      io.of(/^\/dynamic-\d+$/);
    });

    it.skip("should allow a client to connect to a cleaned up namespace", done => {
      const io = new Server(0, { cleanupEmptyChildNamespaces: true });
      const c1 = createClient(io, "/dynamic-101");
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), c1);
      }, 300);
      c1.on("connect", () => {
        c1.disconnect();

        // Give it some time to disconnect and clean up the namespace
        setTimeout(() => {
          try {
            expect(io._nsps.has("/dynamic-101")).toBe(false);

            const c2 = createClient(io, "/dynamic-101");

            c2.on("connect", () => {
              clearTimeout(timeout);
              success(done, io, c2);
            });

            c2.on("connect_error", () => {
              clearTimeout(timeout);
              fail(done, io, new Error("Client got error when connecting to dynamic namespace"), c1);
            });
          } catch (err) {
            clearTimeout(timeout);
            fail(done, io, err, c1);
          }
        }, 100);
      });

      io.of(/^\/dynamic-\d+$/);
    });

    it("should not clean up namespace when cleanupEmptyChildNamespaces is off and there are no more sockets in a namespace", done => {
      const io = new Server(0);
      const c1 = createClient(io, "/dynamic-101");
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), c1);
      }, 300);
      c1.on("connect", () => {
        c1.disconnect();

        // Give it some time to disconnect and clean up the namespace
        setTimeout(() => {
          clearTimeout(timeout);
          try {
            expect(io._nsps.has("/dynamic-101")).toBe(true);
            expect(io._nsps.get("/dynamic-101")!.sockets.size).toBe(0);
            success(done, io);
          } catch (err) {
            fail(done, io, err, c1);
          }
        }, 100);
      });

      io.of(/^\/dynamic-\d+$/);
    });

    it("should attach a child namespace to its parent upon manual creation", done => {
      const io = new Server(0);
      const parentNamespace = io.of(/^\/dynamic-\d+$/);
      const childNamespace = io.of("/dynamic-101");

      try {
        // @ts-ignore
        expect(parentNamespace.children.has(childNamespace)).toBe(true);
        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    });
  });
});
