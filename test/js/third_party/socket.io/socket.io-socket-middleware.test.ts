// TODO: uncomment when Blob bug in isBinary is fixed

import { Server } from "socket.io";
import { describe, it, expect } from "bun:test";

import { success, fail, createClient } from "./support/util.ts";

describe("socket middleware", () => {
  it.skip("should call functions", done => {
    const io = new Server(0);
    const clientSocket = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);

    clientSocket.emit("join", "woot");

    let run = 0;

    io.on("connection", socket => {
      socket.use((event, next) => {
        try {
          expect(event).toStrictEqual(["join", "woot"]);
          event.unshift("wrap");
          run++;
          next();
        } catch (err) {
          clearTimeout(timeout);
          fail(done, io, err, clientSocket);
        }
      });
      socket.use((event, next) => {
        try {
          expect(event).toStrictEqual(["wrap", "join", "woot"]);
          run++;
          next();
        } catch (err) {
          clearTimeout(timeout);
          fail(done, io, err, clientSocket);
        }
      });
      socket.on("wrap", (data1, data2) => {
        try {
          clearTimeout(timeout);
          expect(data1).toBe("join");
          expect(data2).toBe("woot");
          expect(run).toBe(2);

          success(done, io, clientSocket);
        } catch (err) {
          fail(done, io, err, clientSocket);
        }
      });
    });
  });

  it.skip("should pass errors", done => {
    const io = new Server(0);
    const clientSocket = createClient(io, "/", { multiplex: false });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"), clientSocket);
    }, 200);

    clientSocket.emit("join", "woot");

    io.on("connection", socket => {
      socket.use((event, next) => {
        next(new Error("Authentication error"));
      });
      socket.use((event, next) => {
        done(new Error("should not happen"));
      });
      socket.on("join", () => {
        done(new Error("should not happen"));
      });
      socket.on("error", err => {
        try {
          clearTimeout(timeout);
          expect(err).toBeInstanceOf(Error);
          expect(err.message).toBe("Authentication error");

          success(done, io, clientSocket);
        } catch (err) {
          fail(done, io, err, clientSocket);
        }
      });
    });
  });
});
