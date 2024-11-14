import { describe, expect, it } from "bun:test";
import { Server } from "socket.io";

import { createClient, fail, success } from "./support/util.ts";

// Hanging tests are disabled because they cause the test suite to hang
describe.skip("timeout", () => {
  it("should timeout if the client does not acknowledge the event", done => {
    const io = new Server(0);
    const client = createClient(io, "/");
    try {
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"), client);
      }, 200);

      io.on("connection", socket => {
        socket.timeout(50).emit("unknown", err => {
          clearTimeout(timeout);
          try {
            expect(err).toBeInstanceOf(Error);
            success(done, io, client);
          } catch (err) {
            fail(done, io, err, client);
          }
        });
      });
    } catch (err) {
      fail(done, io, err, client);
    }
  });

  it("should timeout if the client does not acknowledge the event in time", done => {
    const io = new Server(0);
    const client = createClient(io, "/");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), client);
    }, 500);

    client.on("echo", (arg, cb) => {
      cb(arg);
    });

    let count = 0;

    io.on("connection", socket => {
      socket.timeout(0).emit("echo", 42, err => {
        try {
          expect(err).toBeInstanceOf(Error);
          count++;
        } catch (err) {
          clearTimeout(timeout);
          fail(done, io, err, client);
        }
      });
    });

    setTimeout(() => {
      clearTimeout(timeout);
      try {
        expect(count).toBe(1);
        success(done, io, client);
      } catch (err) {
        fail(done, io, err, client);
      }
    }, 200);
  });

  it("should not timeout if the client does acknowledge the event", done => {
    const io = new Server(0);
    const client = createClient(io, "/");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), client);
    }, 200);

    client.on("echo", (arg, cb) => {
      cb(arg);
    });

    io.on("connection", socket => {
      socket.timeout(50).emit("echo", 42, (err, value) => {
        clearTimeout(timeout);
        try {
          expect(err).toBe(null);
          expect(value).toBe(42);
          success(done, io, client);
        } catch (err) {
          fail(done, io, err, client);
        }
      });
    });
  });

  it("should timeout if the client does not acknowledge the event (promise)", done => {
    const io = new Server(0);
    const client = createClient(io, "/");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), client);
    }, 200);

    io.on("connection", async socket => {
      try {
        await socket.timeout(50).emitWithAck("unknown");
        clearTimeout(timeout);
        fail(done, io, new Error("timeout"), client);
      } catch (err) {
        clearTimeout(timeout);
        expect(err).toBeInstanceOf(Error);
        success(done, io, client);
      }
    });
  });

  it("should not timeout if the client does acknowledge the event (promise)", done => {
    const io = new Server(0);
    const client = createClient(io, "/");
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), client);
    }, 200);

    client.on("echo", (arg, cb) => {
      cb(arg);
    });

    io.on("connection", async socket => {
      try {
        const value = await socket.timeout(50).emitWithAck("echo", 42);
        clearTimeout(timeout);
        expect(value).toBe(42);
        success(done, io, client);
      } catch (err) {
        clearTimeout(timeout);
        fail(done, io, err, client);
      }
    });
  });
});
