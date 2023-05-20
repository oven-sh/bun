import { Server } from "socket.io";
import { describe, it, expect } from "bun:test";
import { getPort, success, fail } from "./support/util.ts";

describe("handshake", () => {
  const request = require("superagent");

  it("should send the Access-Control-Allow-xxx headers on OPTIONS request", done => {
    const io = new Server(0, {
      cors: {
        origin: "http://localhost:54023",
        methods: ["GET", "POST"],
        allowedHeaders: ["content-type"],
        credentials: true,
      },
    });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    request
      .options(`http://localhost:${getPort(io)}/socket.io/default/`)
      .query({ transport: "polling", EIO: 4 })
      .set("Origin", "http://localhost:54023")
      .end((err, res) => {
        try {
          clearTimeout(timeout);
          expect(res.status).toBe(204);

          expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:54023");
          expect(res.headers["access-control-allow-methods"]).toBe("GET,POST");
          expect(res.headers["access-control-allow-headers"]).toBe("content-type");
          expect(res.headers["access-control-allow-credentials"]).toBe("true");
          success(done, io);
        } catch (err) {
          fail(done, io, err);
        }
      });
  });

  it("should send the Access-Control-Allow-xxx headers on GET request", done => {
    const io = new Server(0, {
      cors: {
        origin: "http://localhost:54024",
        methods: ["GET", "POST"],
        allowedHeaders: ["content-type"],
        credentials: true,
      },
    });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    request
      .get(`http://localhost:${getPort(io)}/socket.io/default/`)
      .query({ transport: "polling", EIO: 4 })
      .set("Origin", "http://localhost:54024")
      .end((err, res) => {
        clearTimeout(timeout);
        try {
          expect(res.status).toBe(200);

          expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:54024");
          expect(res.headers["access-control-allow-credentials"]).toBe("true");
          success(done, io);
        } catch (err) {
          fail(done, io, err);
        }
      });
  });

  it("should allow request if custom function in opts.allowRequest returns true", done => {
    const io = new Server(0, {
      allowRequest: (req, callback) => callback(null, true),
    });

    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);

    request
      .get(`http://localhost:${getPort(io)}/socket.io/default/`)
      .query({ transport: "polling", EIO: 4 })
      .end((err, res) => {
        try {
          clearTimeout(timeout);
          expect(res.status).toBe(200);
          success(done, io);
        } catch (err) {
          fail(done, io, err);
        }
      });
  });

  it("should disallow request if custom function in opts.allowRequest returns false", done => {
    const io = new Server(0, {
      allowRequest: (req, callback) => callback(null, false),
    });
    const timeout = setTimeout(() => {
      fail(done, io, new Error("timeout"));
    }, 200);
    request
      .get(`http://localhost:${getPort(io)}/socket.io/default/`)
      .set("origin", "http://foo.example")
      .query({ transport: "polling", EIO: 4 })
      .end((err, res) => {
        try {
          clearTimeout(timeout);
          expect(res.status).toBe(403);
          success(done, io);
        } catch (err) {
          fail(done, io, err);
        }
      });
  });
});
