import { describe, expect, it } from "bun:test";

import { createServer, Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { Adapter } from "socket.io-adapter";
import { eioHandshake, eioPoll, eioPush, waitFor } from "./support/util.ts";

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

// These tests exercise the Engine.IO HTTP long-polling transport directly via
// supertest (8 sequential round trips in the heaviest case). They await the
// protocol events themselves; the test runner's own timeout bounds hangs.
describe("connection state recovery", () => {
  it("should restore session and missed packets", async () => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });

    try {
      let serverSocket: Socket | undefined;

      io.once("connection", socket => {
        socket.join("room1");
        serverSocket = socket;
      });

      const [sid, pid, offset] = await init(httpServer, io);

      io.emit("hello1"); // broadcast
      io.to("room1").emit("hello2"); // broadcast to room
      serverSocket?.emit("hello3"); // direct message

      const newSid = await eioHandshake(httpServer);
      await eioPush(httpServer, newSid, `40{"pid":"${pid}","offset":"${offset}"}`);

      const payload = await eioPoll(httpServer, newSid);

      const packets = payload.split("\x1e");

      expect(packets.length).toBe(4);

      // note: EVENT packets are received before the CONNECT packet, which is a bit weird
      // see also: https://github.com/socketio/socket.io-deno/commit/518f534e1c205b746b1cb21fe76b187dabc96f34
      expect(packets[0].startsWith('42["hello1"')).toBe(true);
      expect(packets[1].startsWith('42["hello2"')).toBe(true);
      expect(packets[2].startsWith('42["hello3"')).toBe(true);
      expect(packets[3]).toBe(`40{"sid":"${sid}","pid":"${pid}"}`);
    } finally {
      io.close();
    }
  });

  it("should restore rooms and data attributes", async () => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });

    try {
      io.once("connection", socket => {
        expect(socket.recovered).toBe(false);

        socket.join("room1");
        socket.join("room2");
        socket.data.foo = "bar";
      });

      const [sid, pid, offset] = await init(httpServer, io);

      const newSid = await eioHandshake(httpServer);

      const [socket] = await Promise.all([
        waitFor<Socket>(io, "connection"),
        eioPush(httpServer, newSid, `40{"pid":"${pid}","offset":"${offset}"}`),
      ]);

      expect(socket.id).toBe(sid);
      expect(socket.recovered).toBe(true);

      expect(socket.rooms.has(socket.id)).toBe(true);
      expect(socket.rooms.has("room1")).toBe(true);
      expect(socket.rooms.has("room2")).toBe(true);

      expect(socket.data.foo).toBe("bar");

      await eioPoll(httpServer, newSid); // drain buffer
    } finally {
      io.close();
    }
  });

  it("should not run middlewares upon recovery by default", async () => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });

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

      expect(socket.recovered).toBe(true);
      expect(socket.data.middlewareWasCalled).toBe(undefined);

      await eioPoll(httpServer, newSid); // drain buffer
    } finally {
      io.close();
    }
  });

  it("should run middlewares even upon recovery", async () => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {
        skipMiddlewares: false,
      },
    });

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

      expect(socket.recovered).toBe(true);
      expect(socket.data.middlewareWasCalled).toBe(true);

      await eioPoll(httpServer, newSid); // drain buffer
    } finally {
      io.close();
    }
  });

  it("should fail to restore an unknown session", async () => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer, {
      connectionStateRecovery: {},
    });

    try {
      // Engine.IO handshake
      const sid = await eioHandshake(httpServer);

      // Socket.IO handshake
      await eioPush(httpServer, sid, '40{"pid":"foo","offset":"bar"}');

      const handshakeBody = await eioPoll(httpServer, sid);

      expect(handshakeBody.startsWith("40")).toBe(true);

      const handshake = JSON.parse(handshakeBody.substring(2));

      expect(handshake.sid).not.toBe("foo");
      expect(handshake.pid).not.toBe("bar");
    } finally {
      io.close();
    }
  });

  it("should be disabled by default", async () => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer);

    try {
      // Engine.IO handshake
      const sid = await eioHandshake(httpServer);

      // Socket.IO handshake
      await eioPush(httpServer, sid, "40");

      const handshakeBody = await eioPoll(httpServer, sid);

      expect(handshakeBody.startsWith("40")).toBe(true);

      const handshake = JSON.parse(handshakeBody.substring(2));

      expect(handshake.sid).not.toBe(undefined);
      expect(handshake.pid).toBe(undefined);
    } finally {
      io.close();
    }
  });

  it("should not call adapter#persistSession or adapter#restoreSession if disabled", async () => {
    const httpServer = createServer().listen(0);

    let io: Server;
    let called = "";
    class DummyAdapter extends Adapter {
      override persistSession() {
        called = "persistSession";
        return Promise.reject("should not happen");
      }

      override restoreSession() {
        called = "restoreSession";
        return Promise.reject("should not happen");
      }
    }

    io = new Server(httpServer, {
      adapter: DummyAdapter,
    });

    try {
      // Engine.IO handshake
      const sid = await eioHandshake(httpServer);

      await eioPush(httpServer, sid, '40{"pid":"foo","offset":"bar"}');
      await eioPoll(httpServer, sid);
      await eioPush(httpServer, sid, "1");

      expect(called).toBe("");
    } finally {
      io.close();
    }
  });
});
