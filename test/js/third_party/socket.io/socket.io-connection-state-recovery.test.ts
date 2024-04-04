import { describe, it, expect } from "bun:test";

import { Server, Socket } from "socket.io";
import { waitFor, eioHandshake, eioPush, eioPoll, fail, success } from "./support/util.ts";
import { createServer, Server as HttpServer } from "http";
import { Adapter } from "socket.io-adapter";

async function init(httpServer: HttpServer, io: Server) {
  // Engine.IO handshake
  const sid = await eioHandshake(httpServer);

  // Socket.IO handshake
  await eioPush(httpServer, sid, "40");
  const handshakeBody = await eioPoll(httpServer, sid);

  expect(handshakeBody.startsWith("40")).toBe(true);

  const handshake = JSON.parse(handshakeBody.substring(2));

  expect(handshake.sid).not.toBe(undefined);
  // in that case, the handshake also contains a private session ID
  expect(handshake.pid).not.toBe(undefined);

  io.emit("hello");

  const message = await eioPoll(httpServer, sid);

  expect(message.startsWith('42["hello"')).toBe(true);

  const offset = JSON.parse(message.substring(2))[1];
  // in that case, each packet also includes an offset in the data array
  expect(offset).not.toBe(undefined);

  await eioPush(httpServer, sid, "1");
  return [handshake.sid, handshake.pid, offset];
}

describe("connection state recovery", () => {
  it("should restore session and missed packets", done => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    let serverSocket: Socket | undefined;

    io.once("connection", socket => {
      socket.join("room1");
      serverSocket = socket;
    });

    (async () => {
      try {
        const [sid, pid, offset] = await init(httpServer, io);

        io.emit("hello1"); // broadcast
        io.to("room1").emit("hello2"); // broadcast to room
        serverSocket?.emit("hello3"); // direct message

        const newSid = await eioHandshake(httpServer);
        await eioPush(httpServer, newSid, `40{"pid":"${pid}","offset":"${offset}"}`);

        const payload = await eioPoll(httpServer, newSid);
        clearTimeout(timeout);

        const packets = payload.split("\x1e");

        expect(packets.length).toBe(4);

        // note: EVENT packets are received before the CONNECT packet, which is a bit weird
        // see also: https://github.com/socketio/socket.io-deno/commit/518f534e1c205b746b1cb21fe76b187dabc96f34
        expect(packets[0].startsWith('42["hello1"')).toBe(true);
        expect(packets[1].startsWith('42["hello2"')).toBe(true);
        expect(packets[2].startsWith('42["hello3"')).toBe(true);
        expect(packets[3]).toBe(`40{"sid":"${sid}","pid":"${pid}"}`);
        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    })();
  });

  it("should restore rooms and data attributes", done => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    io.once("connection", socket => {
      expect(socket.recovered).toBe(false);

      socket.join("room1");
      socket.join("room2");
      socket.data.foo = "bar";
    });
    (async () => {
      try {
        const [sid, pid, offset] = await init(httpServer, io);

        const newSid = await eioHandshake(httpServer);

        const [socket] = await Promise.all([
          waitFor<Socket>(io, "connection"),
          eioPush(httpServer, newSid, `40{"pid":"${pid}","offset":"${offset}"}`),
        ]);

        clearTimeout(timeout);
        expect(socket.id).toBe(sid);
        expect(socket.recovered).toBe(true);

        expect(socket.rooms.has(socket.id)).toBe(true);
        expect(socket.rooms.has("room1")).toBe(true);
        expect(socket.rooms.has("room2")).toBe(true);

        expect(socket.data.foo).toBe("bar");

        await eioPoll(httpServer, newSid); // drain buffer
        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    })();
  });

  it("should not run middlewares upon recovery by default", done => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    (async () => {
      try {
        const [_, pid, offset] = await init(httpServer, io);

        io.use((socket, next) => {
          socket.data.middlewareWasCalled = true;

          next();
        });

        const newSid = await eioHandshake(httpServer);

        const [socket] = await Promise.all([
          waitFor<Socket>(io, "connection"),
          eioPush(httpServer, newSid, `40{"pid":"${pid}","offset":"${offset}"}`),
        ]);

        clearTimeout(timeout);
        expect(socket.recovered).toBe(true);
        expect(socket.data.middlewareWasCalled).toBe(undefined);

        await eioPoll(httpServer, newSid); // drain buffer
        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    })();
  });

  it("should run middlewares even upon recovery", done => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {
        skipMiddlewares: false,
      },
    });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    (async () => {
      try {
        const [_, pid, offset] = await init(httpServer, io);

        io.use((socket, next) => {
          socket.data.middlewareWasCalled = true;

          next();
        });

        const newSid = await eioHandshake(httpServer);

        const [socket] = await Promise.all([
          waitFor<Socket>(io, "connection"),
          eioPush(httpServer, newSid, `40{"pid":"${pid}","offset":"${offset}"}`),
        ]);

        clearTimeout(timeout);

        expect(socket.recovered).toBe(true);
        expect(socket.data.middlewareWasCalled).toBe(true);

        await eioPoll(httpServer, newSid); // drain buffer
        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    })();
  });

  it("should fail to restore an unknown session", done => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    (async () => {
      try {
        // Engine.IO handshake
        const sid = await eioHandshake(httpServer);

        // Socket.IO handshake
        await eioPush(httpServer, sid, '40{"pid":"foo","offset":"bar"}');

        const handshakeBody = await eioPoll(httpServer, sid);

        clearTimeout(timeout);

        expect(handshakeBody.startsWith("40")).toBe(true);

        const handshake = JSON.parse(handshakeBody.substring(2));

        expect(handshake.sid).not.toBe("foo");
        expect(handshake.pid).not.toBe("bar");

        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    })();
  });

  it("should be disabled by default", done => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer);
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    (async () => {
      try {
        // Engine.IO handshake
        const sid = await eioHandshake(httpServer);

        // Socket.IO handshake
        await eioPush(httpServer, sid, "40");

        const handshakeBody = await eioPoll(httpServer, sid);

        clearTimeout(timeout);
        expect(handshakeBody.startsWith("40")).toBe(true);

        const handshake = JSON.parse(handshakeBody.substring(2));

        expect(handshake.sid).not.toBe(undefined);
        expect(handshake.pid).toBe(undefined);

        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    })();
  });

  it("should not call adapter#persistSession or adapter#restoreSession if disabled", done => {
    const httpServer = createServer().listen(0);

    let io: Server;
    class DummyAdapter extends Adapter {
      override persistSession() {
        fail(done, io, new Error("should not happen"));
        return Promise.reject("should not happen");
      }

      override restoreSession() {
        fail(done, io, new Error("should not happen"));
        return Promise.reject("should not happen");
      }
    }

    io = new Server(httpServer, {
      adapter: DummyAdapter,
    });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    (async () => {
      try {
        // Engine.IO handshake
        const sid = await eioHandshake(httpServer);

        await eioPush(httpServer, sid, '40{"pid":"foo","offset":"bar"}');
        await eioPoll(httpServer, sid);
        await eioPush(httpServer, sid, "1");
        clearTimeout(timeout);
        success(done, io);
      } catch (err) {
        fail(done, io, err);
      }
    })();
  });
});
