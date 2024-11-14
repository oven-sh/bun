import { describe, expect, it } from "bun:test";

import fs from "fs";
import { join } from "path";
import { Server } from "socket.io";
import { createClient, createPartialDone, fail, getPort, success } from "./support/util.ts";

// skipped due to a macOS bug
describe.skip("socket.io", () => {
  it.skip("should not fire events more than once after manually reconnecting", done => {
    const io = new Server(0);
    const clientSocket = createClient(io, "/", { reconnection: false });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);
    clientSocket.on("connect", function init() {
      clientSocket.off("connect", init);
      clientSocket.io.engine.close();

      process.nextTick(() => {
        clientSocket.connect();
      });
      clientSocket.on("connect", () => {
        clearTimeout(timeout);
        success(done, io, clientSocket);
      });
    });
  });

  it.skip("should not fire reconnect_failed event more than once when server closed", done => {
    const io = new Server(0);
    const clientSocket = createClient(io, "/", {
      reconnectionAttempts: 3,
      reconnectionDelay: 100,
    });

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);

    clientSocket.on("connect", () => {
      io.close();
    });

    clientSocket.io.on("reconnect_failed", () => {
      clearTimeout(timeout);
      success(done, io, clientSocket);
    });
  });

  it("should receive events", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      s.on("random", (a, b, c) => {
        clearTimeout(timeout);
        try {
          expect(a).toBe(1);
          expect(b).toBe("2");
          expect(c).toStrictEqual([3]);

          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      socket.emit("random", 1, "2", [3]);
    });
  });

  it("should receive message events through `send`", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      s.on("message", a => {
        clearInterval(timeout);
        try {
          expect(a).toBe(1337);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      socket.send(1337);
    });
  });

  it("should error with null messages", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    io.on("connection", s => {
      s.on("message", a => {
        clearTimeout(timeout);
        try {
          expect(a).toBe(null);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      socket.send(null);
    });
  });

  it("should handle transport null messages", done => {
    const io = new Server(0);
    const socket = createClient(io, "/", { reconnection: false });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    io.on("connection", s => {
      s.on("error", err => {
        try {
          expect(err).toBeInstanceOf(Error);
        } catch (err) {
          fail(done, io, err, socket);
          return;
        }
        s.on("disconnect", reason => {
          clearTimeout(timeout);
          try {
            expect(reason).toBe("forced close");
            success(done, io, socket);
          } catch (err) {
            fail(done, io, err, socket);
          }
        });
      });
      (s as any).client.ondata(null);
    });
  });

  it("should emit events", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    socket.on("woot", a => {
      clearTimeout(timeout);

      try {
        expect(a).toBe("tobi");
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
    io.on("connection", s => {
      s.emit("woot", "tobi");
    });
  });

  it("should emit events with utf8 multibyte character", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let i = 0;
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    socket.on("hoot", a => {
      try {
        expect(a).toBe("utf8 — string");
        i++;

        if (3 == i) {
          clearTimeout(timeout);
          success(done, io, socket);
        }
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
    io.on("connection", s => {
      s.emit("hoot", "utf8 — string");
      s.emit("hoot", "utf8 — string");
      s.emit("hoot", "utf8 — string");
    });
  });

  it("should emit events with binary data", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    let imageData: any;
    socket.on("bun", a => {
      clearTimeout(timeout);
      try {
        expect(Buffer.isBuffer(a)).toBe(true);
        expect(imageData.length).toStrictEqual(a.length);
        expect(imageData[0]).toStrictEqual(a[0]);
        expect(imageData[imageData.length - 1]).toStrictEqual(a[a.length - 1]);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
    io.on("connection", s => {
      fs.readFile(join(__dirname, "support", "bun.png"), (err, data) => {
        if (err) return done(err);
        imageData = data;
        s.emit("bun", data);
      });
    });
  });

  it.skip("should emit events with several types of data (including binary)", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    socket.on("multiple", (a, b, c, d, e, f) => {
      clearTimeout(timeout);
      try {
        expect(a).toBe(1);
        expect(Buffer.isBuffer(b)).toBe(true);
        expect(c).toBe("3");
        expect(d).toStrictEqual([4]);
        expect(Buffer.isBuffer(e)).toBe(true);
        expect(Buffer.isBuffer(f[0])).toBe(true);
        expect(f[1]).toBe("swag");
        expect(Buffer.isBuffer(f[2])).toBe(true);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
    io.on("connection", s => {
      fs.readFile(join(__dirname, "support", "bun.png"), (err, data) => {
        if (err) return done(err);
        const buf = Buffer.from("asdfasdf", "utf8");
        s.emit("multiple", 1, data, "3", [4], buf, [data, "swag", buf]);
      });
    });
  });

  it("should receive events with binary data", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      s.on("buff", a => {
        clearTimeout(timeout);
        try {
          expect(Buffer.isBuffer(a)).toBe(true);

          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      const buf = Buffer.from("abcdefg", "utf8");
      socket.emit("buff", buf);
    });
  });

  it("should receive events with several types of data (including binary)", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      s.on("multiple", (a, b, c, d, e, f) => {
        clearTimeout(timeout);
        try {
          expect(a).toBe(1);
          expect(Buffer.isBuffer(b)).toBe(true);
          expect(c).toBe("3");
          expect(d).toStrictEqual([4]);
          expect(Buffer.isBuffer(e)).toBe(true);
          expect(Buffer.isBuffer(f[0])).toBe(true);
          expect(f[1]).toBe("swag");
          expect(Buffer.isBuffer(f[2])).toBe(true);

          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      fs.readFile(join(__dirname, "support", "bun.png"), (err, data) => {
        if (err) return done(err);
        const buf = Buffer.from("asdfasdf", "utf8");
        socket.emit("multiple", 1, data, "3", [4], buf, [data, "swag", buf]);
      });
    });
  });

  it("should not emit volatile event after regular event (polling)", done => {
    const io = new Server(0, { transports: ["polling"] });

    let counter = 0;
    io.on("connection", s => {
      s.emit("ev", "data");
      s.volatile.emit("ev", "data");
    });

    const socket = createClient(io, "/", { transports: ["polling"] });
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
    }, 200);
  });

  it.skip("should not emit volatile event after regular event (ws)", done => {
    const io = new Server(0, { transports: ["websocket"] });

    let counter = 0;
    io.on("connection", s => {
      s.emit("ev", "data");
      s.volatile.emit("ev", "data");
    });

    const socket = createClient(io, "/", { transports: ["websocket"] });
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
    }, 200);
  });

  it("should emit volatile event (polling)", done => {
    const io = new Server(0, { transports: ["polling"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        s.volatile.emit("ev", "data");
      }, 100);
    });

    const socket = createClient(io, "/", { transports: ["polling"] });
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
    }, 500);
  });

  it.skip("should emit volatile event (ws)", done => {
    const io = new Server(0, { transports: ["websocket"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        s.volatile.emit("ev", "data");
      }, 20);
    });

    const socket = createClient(io, "/", { transports: ["websocket"] });
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
    }, 200);
  });

  it("should emit only one consecutive volatile event (polling)", done => {
    const io = new Server(0, { transports: ["polling"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        s.volatile.emit("ev", "data");
        s.volatile.emit("ev", "data");
      }, 100);
    });

    const socket = createClient(io, "/", { transports: ["polling"] });
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
    }, 500);
  });

  it.skip("should emit only one consecutive volatile event (ws)", done => {
    const io = new Server(0, { transports: ["websocket"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        s.volatile.emit("ev", "data");
        s.volatile.emit("ev", "data");
      }, 20);
    });

    const socket = createClient(io, "/", { transports: ["websocket"] });
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
    }, 200);
  });

  it.skip("should emit only one consecutive volatile event with binary (ws)", done => {
    const io = new Server(0, { transports: ["websocket"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        s.volatile.emit("ev", Buffer.from([1, 2, 3]));
        s.volatile.emit("ev", Buffer.from([4, 5, 6]));
      }, 20);
    });

    const socket = createClient(io, "/", { transports: ["websocket"] });
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
    }, 200);
  });

  it.skip("should broadcast only one consecutive volatile event with binary (ws)", done => {
    const io = new Server(0, { transports: ["websocket"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        io.volatile.emit("ev", Buffer.from([1, 2, 3]));
        io.volatile.emit("ev", Buffer.from([4, 5, 6]));
      }, 20);
    });

    const socket = createClient(io, "/", { transports: ["websocket"] });
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
    }, 2000);
  });

  it("should emit regular events after trying a failed volatile event (polling)", done => {
    const io = new Server(0, { transports: ["polling"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        s.emit("ev", "data");
        s.volatile.emit("ev", "data");
        s.emit("ev", "data");
      }, 20);
    });

    const socket = createClient(io, "/", { transports: ["polling"] });
    socket.on("ev", () => {
      counter++;
    });

    setTimeout(() => {
      try {
        expect(counter).toBe(2);
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    }, 200);
  });

  it.skip("should emit regular events after trying a failed volatile event (ws)", done => {
    const io = new Server(0, { transports: ["websocket"] });

    let counter = 0;
    io.on("connection", s => {
      // Wait to make sure there are no packets being sent for opening the connection
      setTimeout(() => {
        s.emit("ev", "data");
        s.volatile.emit("ev", "data");
        s.emit("ev", "data");
      }, 20);
    });

    const socket = createClient(io, "/", { transports: ["websocket"] });
    socket.on("ev", () => {
      counter++;
    });

    setTimeout(() => {
      try {
        expect(counter).toBe(2);
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    }, 200);
  });

  it("should emit message events through `send`", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    socket.on("message", a => {
      clearTimeout(timeout);
      try {
        expect(a).toBe("a");
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
    io.on("connection", s => {
      s.send("a");
    });
  });

  it("should receive event with callbacks", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);
    io.on("connection", s => {
      s.on("woot", fn => {
        fn(1, 2);
      });
      socket.emit("woot", (a, b) => {
        clearTimeout(timeout);
        try {
          expect(a).toBe(1);
          expect(b).toBe(2);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
    });
  });

  it("should receive all events emitted from namespaced client immediately and in order", done => {
    const io = new Server(0);
    let total = 0;
    let timeout: any;
    io.of("/chat", s => {
      s.on("hi", letter => {
        total++;
        if (total == 2) {
          clearInterval(timeout);
          expect(letter).toBe("b");
          success(done, io, chat);
        } else if (total == 1 && letter != "a") {
          fail(done, io, new Error("events out of order"), chat);
        }
      });
    });

    const chat = createClient(io, "/chat");
    timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), chat);
    }, 2000);

    chat.emit("hi", "a");
    setTimeout(() => {
      chat.emit("hi", "b");
    }, 50);
  });

  it("should emit events with callbacks", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      socket.on("hi", fn => {
        fn();
      });
      s.emit("hi", () => {
        clearTimeout(timeout);
        success(done, io, socket);
      });
    });
  });

  it("should receive events with args and callback", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      s.on("woot", (a, b, fn) => {
        try {
          expect(a).toBe(1);
          expect(b).toBe(2);
          fn();
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      socket.emit("woot", 1, 2, () => {
        clearTimeout(timeout);
        success(done, io, socket);
      });
    });
  });

  it("should emit events with args and callback", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      socket.on("hi", (a, b, fn) => {
        try {
          expect(a).toBe(1);
          expect(b).toBe(2);
          fn();
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      s.emit("hi", 1, 2, () => {
        clearTimeout(timeout);
        success(done, io, socket);
      });
    });
  });

  it("should receive events with binary args and callbacks", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      s.on("woot", (buf, fn) => {
        try {
          expect(Buffer.isBuffer(buf)).toBe(true);
          fn(1, 2);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      socket.emit("woot", Buffer.alloc(3), (a, b) => {
        clearTimeout(timeout);
        try {
          expect(a).toBe(1);
          expect(b).toBe(2);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
    });
  });

  it("should emit events with binary args and callback", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      socket.on("hi", (a, fn) => {
        try {
          expect(Buffer.isBuffer(a)).toBe(true);
          fn();
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      s.emit("hi", Buffer.alloc(4), () => {
        clearTimeout(timeout);
        success(done, io, socket);
      });
    });
  });

  it("should emit events and receive binary data in a callback", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      socket.on("hi", fn => {
        fn(Buffer.alloc(1));
      });
      s.emit("hi", a => {
        clearTimeout(timeout);
        try {
          expect(Buffer.isBuffer(a)).toBe(true);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
    });
  });

  it("should receive events and pass binary data in a callback", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      s.on("woot", fn => {
        fn(Buffer.alloc(2));
      });
      socket.emit("woot", a => {
        clearTimeout(timeout);
        try {
          expect(Buffer.isBuffer(a)).toBe(true);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
    });
  });

  it("should emit an event and wait for the acknowledgement", done => {
    const io = new Server(0);
    const socket = createClient(io);

    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", async s => {
      socket.on("hi", (a, b, fn) => {
        try {
          expect(a).toBe(1);
          expect(b).toBe(2);
          fn(3);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });

      const val = await s.emitWithAck("hi", 1, 2);
      clearTimeout(timeout);
      try {
        expect(val).toBe(3);

        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should have access to the client", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        expect(typeof s.client).toBe("object");
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should have access to the connection", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        expect(typeof s.client.conn).toBe("object");
        expect(typeof s.conn).toBe("object");
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should have access to the request", done => {
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        expect(typeof s.client.request.headers).toBe("object");
        expect(typeof s.request.headers).toBe("object");
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should see query parameters in the request", done => {
    const io = new Server(0);
    const socket = createClient(io, "/", { query: { key1: 1, key2: 2 } });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 200);

    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        const parsed = require("url").parse(s.request.url);
        const query = require("querystring").parse(parsed.query);
        expect(query.key1).toBe("1");
        expect(query.key2).toBe("2");
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  it("should see query parameters sent from secondary namespace connections in handshake object", done => {
    const io = new Server(0);
    const client1 = createClient(io);
    const client2 = createClient(io, "/connection2", {
      auth: { key1: "aa", key2: "&=bb" },
    });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), client1, client2);
    }, 200);

    io.on("connection", s => {});
    io.of("/connection2").on("connection", s => {
      clearTimeout(timeout);

      try {
        expect(s.handshake.query.key1).toBe(undefined);
        expect(s.handshake.query.EIO).toBe("4");
        expect(s.handshake.auth.key1).toBe("aa");
        expect(s.handshake.auth.key2).toBe("&=bb");
        success(done, io, client1, client2);
      } catch (err) {
        fail(done, io, err, client1, client2);
      }
    });
  });

  it.skip("should handle very large json", function (done) {
    const io = new Server(0, { perMessageDeflate: false });
    let received = 0;

    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 30000);

    socket.on("big", a => {
      try {
        expect(Buffer.isBuffer(a.json)).toBe(false);
        if (++received == 3) {
          clearTimeout(timeout);
          success(done, io, socket);
        } else socket.emit("big", a);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
    io.on("connection", s => {
      fs.readFile(join(__dirname, "fixtures", "big.json"), (err, data: any) => {
        if (err) return done(err);
        data = JSON.parse(data);
        s.emit("big", { hello: "friend", json: data });
      });
      s.on("big", a => {
        s.emit("big", a);
      });
    });
  });

  it.skip("should handle very large binary data", function (done) {
    const io = new Server(0, { perMessageDeflate: false });
    let received = 0;

    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 30000);

    socket.on("big", a => {
      try {
        expect(Buffer.isBuffer(a.image)).toBe(true);
        if (++received == 3) {
          clearTimeout(timeout);
          success(done, io, socket);
        } else socket.emit("big", a);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
    io.on("connection", s => {
      fs.readFile(join(__dirname, "fixtures", "big.jpg"), (err, data) => {
        if (err) return done(err);
        s.emit("big", { hello: "friend", image: data });
      });
      s.on("big", a => {
        expect(Buffer.isBuffer(a.image)).toBe(true);
        s.emit("big", a);
      });
    });
  });

  it.skip("should be able to emit after server close and restart", done => {
    const io = new Server(0);
    let timeout: any;
    io.on("connection", socket => {
      socket.on("ev", data => {
        clearTimeout(timeout);
        try {
          expect(data).toBe("payload");
          success(done, io, clientSocket);
        } catch (err) {
          fail(done, io, err, clientSocket);
        }
      });
    });

    const port = getPort(io);
    const clientSocket = createClient(io, "/", {
      reconnectionAttempts: 10,
      reconnectionDelay: 100,
    });
    timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 300);
    clientSocket.once("connect", () => {
      io.close(() => {
        clientSocket.io.on("reconnect", () => {
          clientSocket.emit("ev", "payload");
        });
        io.listen(port);
      });
    });
  });

  it("should enable compression by default", done => {
    const io = new Server(0);
    const socket = createClient(io, "/chat");
    let timeout = setTimeout(() => {
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
      s.emit("woot", "hi");
    });
  });

  it("should disable compression", done => {
    const io = new Server(0);
    const socket = createClient(io, "/chat");
    let timeout = setTimeout(() => {
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
      s.compress(false).emit("woot", "hi");
    });
  });

  it.skip("should error with raw binary and warn", done => {
    const io = new Server(0);
    const socket = createClient(io, "/", { reconnection: false });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.on("connection", s => {
      s.conn.on("upgrade", () => {
        console.log("\u001b[96mNote: warning expected and normal in test.\u001b[39m");
        // @ts-ignore
        socket.io.engine.write("5woooot");
        setTimeout(() => {
          clearTimeout(timeout);
          success(done, io, socket);
        }, 100);
      });
    });
  });

  // TODO: investigate IOT
  it.skip("should not crash when receiving an error packet without handler", done => {
    const io = new Server(0);
    const socket = createClient(io, "/", { reconnection: false });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.on("connection", s => {
      s.conn.on("upgrade", () => {
        console.log("\u001b[96mNote: warning expected and normal in test.\u001b[39m");
        // @ts-ignore
        socket.io.engine.write('44["handle me please"]');
        setTimeout(() => {
          clearTimeout(timeout);
          success(done, io, socket);
        }, 100);
      });
    });
  });

  it.skip("should not crash with raw binary", done => {
    const io = new Server(0);
    const socket = createClient(io, "/", { reconnection: false });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.on("connection", s => {
      s.once("error", err => {
        clearTimeout(timeout);
        try {
          expect(err.message).toMatch(/Illegal attachments/);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      s.conn.on("upgrade", () => {
        // @ts-ignore
        socket.io.engine.write("5woooot");
      });
    });
  });

  it.skip("should handle empty binary packet", done => {
    const io = new Server(0);
    const socket = createClient(io, "/", { reconnection: false });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.on("connection", s => {
      s.once("error", err => {
        clearTimeout(timeout);
        try {
          expect(err.message).toMatch(/Illegal attachments/);
          success(done, io, socket);
        } catch (err) {
          fail(done, io, err, socket);
        }
      });
      s.conn.on("upgrade", () => {
        // @ts-ignore
        socket.io.engine.write("5");
      });
    });
  });

  it.skip("should not crash when messing with Object prototype (and other globals)", done => {
    // @ts-ignore
    Object.prototype.foo = "bar";
    // @ts-ignore
    global.File = "";
    // @ts-ignore
    global.Blob = [];
    const io = new Server(0);
    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.on("connection", () => {
      clearTimeout(timeout);
      success(done, io, socket);
    });
  });

  it.skip("should throw on reserved event", done => {
    const io = new Server(0);

    const socket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), socket);
    }, 300);

    io.on("connection", s => {
      clearTimeout(timeout);
      try {
        expect(() => s.emit("connect_error")).toThrow(/"connect_error" is a reserved event name/);
        socket.close();
        success(done, io, socket);
      } catch (err) {
        fail(done, io, err, socket);
      }
    });
  });

  // // TODO: investigate weird error here
  it.skip("should ignore a packet received after disconnection", done => {
    const io = new Server(0);
    const clientSocket = createClient(io);
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 300);

    io.on("connection", socket => {
      socket.on("test", () => {
        fail(done, io, new Error("should not happen"), clientSocket);
      });
      socket.on("disconnect", () => {
        clearTimeout(timeout);
        success(done, io, clientSocket);
      });
    });

    clientSocket.on("connect", () => {
      clientSocket.emit("test", Buffer.alloc(10));
      clientSocket.disconnect();
    });
  });

  it("should leave all rooms joined after a middleware failure", done => {
    const io = new Server(0);
    const client = createClient(io, "/");
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), client);
    }, 300);

    io.use((socket, next) => {
      socket.join("room1");
      next(new Error("nope"));
    });

    client.on("connect_error", () => {
      clearTimeout(timeout);
      try {
        expect(io.of("/").adapter.rooms.size).toStrictEqual(0);

        io.close();
        success(done, io, client);
      } catch (err) {
        fail(done, io, err, client);
      }
    });
  });

  it("should not join rooms after disconnection", done => {
    const io = new Server(0);
    const client = createClient(io, "/");
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), client);
    }, 300);

    io.on("connection", socket => {
      socket.disconnect();
      socket.join("room1");
    });

    client.on("disconnect", () => {
      clearTimeout(timeout);
      try {
        expect(io.of("/").adapter.rooms.size).toStrictEqual(0);

        io.close();
        success(done, io, client);
      } catch (err) {
        fail(done, io, err, client);
      }
    });
  });

  describe("onAny", () => {
    it("should call listener", done => {
      const io = new Server(0);
      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);

      clientSocket.emit("my-event", "123");

      io.on("connection", socket => {
        socket.onAny((event, arg1) => {
          clearTimeout(timeout);
          try {
            expect(event).toBe("my-event");
            expect(arg1).toBe("123");
            success(done, io, clientSocket);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });
      });
    });

    it("should prepend listener", done => {
      const io = new Server(0);
      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);

      clientSocket.emit("my-event", "123");

      io.on("connection", socket => {
        let count = 0;

        socket.onAny((event, arg1) => {
          clearTimeout(timeout);
          try {
            expect(count).toBe(2);
            success(done, io, clientSocket);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        socket.prependAny(() => {
          try {
            expect(count++).toBe(1);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        socket.prependAny(() => {
          try {
            expect(count++).toBe(0);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });
      });
    });

    it("should remove listener", done => {
      const io = new Server(0);
      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);

      clientSocket.emit("my-event", "123");

      io.on("connection", socket => {
        const _fail = () => fail(done, io, new Error("should not happen"), clientSocket);

        socket.onAny(_fail);
        socket.offAny(_fail);
        try {
          expect(socket.listenersAny.length).toBe(0);
        } catch (err) {
          fail(done, io, err, clientSocket);
        }
        socket.onAny(() => {
          clearTimeout(timeout);

          success(done, io, clientSocket);
        });
      });
    });
  });

  describe("onAnyOutgoing", () => {
    it("should call listener", done => {
      const io = new Server(0);
      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);

      io.on("connection", socket => {
        socket.onAnyOutgoing((event, arg1) => {
          clearTimeout(timeout);

          try {
            expect(event).toBe("my-event");
            expect(arg1).toBe("123");

            success(done, io, clientSocket);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        socket.emit("my-event", "123");
      });
    });

    it("should call listener when broadcasting", done => {
      const io = new Server(0);
      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);
      io.on("connection", socket => {
        socket.onAnyOutgoing((event, arg1) => {
          clearTimeout(timeout);
          try {
            expect(event).toBe("my-event");
            expect(arg1).toBe("123");

            success(done, io, clientSocket);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        io.emit("my-event", "123");
      });
    });

    it("should call listener when broadcasting binary data", done => {
      const io = new Server(0);
      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);
      io.on("connection", socket => {
        socket.onAnyOutgoing((event, arg1) => {
          clearTimeout(timeout);
          try {
            expect(event).toBe("my-event");
            expect(arg1).toBeInstanceOf(Uint8Array);

            success(done, io, clientSocket);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        io.emit("my-event", Uint8Array.of(1, 2, 3));
      });
    });

    it("should prepend listener", done => {
      const io = new Server(0);
      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);

      io.on("connection", socket => {
        let count = 0;

        socket.onAnyOutgoing((event, arg1) => {
          clearTimeout(timeout);
          try {
            expect(count).toBe(2);

            success(done, io, clientSocket);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        socket.prependAnyOutgoing(() => {
          try {
            expect(count++).toBe(1);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        socket.prependAnyOutgoing(() => {
          try {
            expect(count++).toBe(0);
          } catch (err) {
            fail(done, io, err, clientSocket);
          }
        });

        socket.emit("my-event", "123");
      });
    });

    it("should remove listener", done => {
      const io = new Server(0);

      const clientSocket = createClient(io, "/", { multiplex: false });
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), clientSocket);
      }, 300);

      io.on("connection", socket => {
        const _fail = () => fail(done, io, new Error("fail"), clientSocket);

        socket.onAnyOutgoing(_fail);
        socket.offAnyOutgoing(_fail);
        try {
          expect(socket.listenersAnyOutgoing.length).toBe(0);
        } catch (err) {
          fail(done, io, err, clientSocket);
        }

        socket.onAnyOutgoing(() => {
          clearTimeout(timeout);
          success(done, io, clientSocket);
        });

        socket.emit("my-event", "123");
      });
    });

    it.skip("should disconnect all namespaces when calling disconnect(true)", done => {
      const io = new Server(0);
      io.of("/foo");
      io.of("/bar");

      const socket1 = createClient(io, "/", {
        transports: ["websocket"],
      });
      const socket2 = createClient(io, "/foo");
      const socket3 = createClient(io, "/bar");

      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), socket1, socket2, socket3);
      }, 300);

      io.of("/bar").on("connection", socket => {
        socket.disconnect(true);
      });

      const partialDone = createPartialDone(3, () => {
        clearTimeout(timeout);
        success(done, io, socket1, socket2, socket3);
      });

      socket1.on("disconnect", partialDone);
      socket2.on("disconnect", partialDone);
      socket3.on("disconnect", partialDone);
    });
  });
});
