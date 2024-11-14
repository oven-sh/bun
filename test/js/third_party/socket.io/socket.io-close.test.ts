import { describe, expect, it } from "bun:test";
import { ChildProcess, exec } from "child_process";
import { createServer } from "http";
import { join } from "path";
import { Server } from "socket.io";
import { io as ioc } from "socket.io-client";
import { createClient, eioHandshake, eioPoll, eioPush, fail, getPort, success } from "./support/util.ts";

// Hanging tests are disabled because they cause the test suite to hang
describe("close", () => {
  it.skip("should be able to close sio sending a srv", done => {
    const httpServer = createServer().listen(0);
    const io = new Server(httpServer);
    const port = getPort(io);
    const net = require("net");
    const server = net.createServer();

    const clientSocket = createClient(io, "/", { reconnection: false });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);

    clientSocket.on("disconnect", () => {
      try {
        expect(io.sockets.sockets.size).toBe(0);
      } catch (err) {
        fail(done, io, err, clientSocket);
      }
      server.listen(port);
    });

    clientSocket.on("connect", () => {
      try {
        expect(io.sockets.sockets.size).toBe(1);
        io.close();
      } catch (err) {
        fail(done, io, err, clientSocket);
      }
    });

    server.once("listening", () => {
      // PORT should be free
      server.close((error: any) => {
        clearTimeout(timeout);
        try {
          expect(error).toBe(undefined);
          success(done, io, clientSocket);
        } catch (err) {
          fail(done, io, err, clientSocket);
        }
      });
    });
  });

  it.skip("should be able to close sio sending a srv", done => {
    const io = new Server(0);
    const port = getPort(io);
    const net = require("net");
    const server = net.createServer();

    const clientSocket = ioc("ws://0.0.0.0:" + port, {
      reconnection: false,
    });
    let timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);

    clientSocket.on("disconnect", () => {
      try {
        expect(io.sockets.sockets.size).toBe(0);
      } catch (err) {
        fail(done, io, err, clientSocket);
      }
      server.listen(port);
    });

    clientSocket.on("connect", () => {
      try {
        expect(io.sockets.sockets.size).toBe(1);
        io.close();
      } catch (err) {
        fail(done, io, err, clientSocket);
      }
    });

    server.once("listening", () => {
      // PORT should be free
      server.close((error: any) => {
        clearTimeout(timeout);
        try {
          expect(error).toBe(undefined);
          success(done, io, clientSocket);
        } catch (err) {
          fail(done, io, err, clientSocket);
        }
      });
    });
  });

  describe("graceful close", () => {
    function fixture(filename: string) {
      return '"' + process.execPath + '" "' + join(__dirname, "fixtures", filename) + '"';
    }
    // TODO failing on macOS
    it.skip("should stop socket and timers", done => {
      let process: ChildProcess;
      const timeout = setTimeout(() => {
        process?.kill();
        done(new Error("timeout"));
      }, 3000);

      process = exec(fixture("server-close.ts"), err => {
        clearTimeout(timeout);
        done(err);
      });
    });
  });

  describe("protocol violations", () => {
    it("should close the connection when receiving several CONNECT packets", async () => {
      const { promise, resolve, reject } = Promise.withResolvers();
      const httpServer = createServer();
      const io = new Server(httpServer);

      httpServer.listen(0);

      let timeout = setTimeout(() => {
        fail(reject, io, new Error("timeout"));
      }, 1500);

      await (async () => {
        const sid = await eioHandshake(httpServer);
        // send a first CONNECT packet
        await eioPush(httpServer, sid, "40");
        // send another CONNECT packet
        await eioPush(httpServer, sid, "40");
        // session is cleanly closed (not discarded, see 'client.close()')
        // first, we receive the Socket.IO handshake response
        await eioPoll(httpServer, sid);
        // then a close packet
        return await eioPoll(httpServer, sid);
      })().then(body => {
        clearTimeout(timeout);
        try {
          expect(body).toBe("6\u001e1");

          io.close();
          success(resolve, io);
        } catch (err) {
          fail(reject, io, err);
        }
        return promise;
      });
    });

    it("should close the connection when receiving an EVENT packet while not connected", async () => {
      const { promise, resolve, reject } = Promise.withResolvers();
      const httpServer = createServer();
      const io = new Server(httpServer);

      httpServer.listen(0);
      let timeout = setTimeout(() => {
        fail(reject, io, new Error("timeout"));
      }, 1500);

      (async () => {
        const sid = await eioHandshake(httpServer);
        // send an EVENT packet
        await eioPush(httpServer, sid, '42["some event"]');
        // session is cleanly closed, we receive a close packet
        return await eioPoll(httpServer, sid);
      })().then(body => {
        clearTimeout(timeout);
        try {
          expect(body).toBe("6\u001e1");

          io.close();
          success(resolve, io);
        } catch (err) {
          fail(reject, io, err);
        }
        return promise;
      });
    });

    it.skip("should close the connection when receiving an invalid packet", done => {
      const httpServer = createServer();
      const io = new Server(httpServer);

      httpServer.listen(0);
      let timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 1500);

      (async () => {
        const sid = await eioHandshake(httpServer);
        // send a CONNECT packet
        await eioPush(httpServer, sid, "40");
        // send an invalid packet
        await eioPush(httpServer, sid, "4abc");
        // session is cleanly closed (not discarded, see 'client.close()')
        // first, we receive the Socket.IO handshake response
        await eioPoll(httpServer, sid);
        // then a close packet
        return await eioPoll(httpServer, sid);
      })().then(body => {
        clearTimeout(timeout);
        try {
          expect(body).toBe("6\u001e1");

          io.close();
          success(done, io);
        } catch (err) {
          fail(done, io, err);
        }
      });
    });
  });
});
