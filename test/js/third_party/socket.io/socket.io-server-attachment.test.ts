import { Server } from "socket.io";
import { createServer } from "http";
import request from "supertest";
import { getPort, success, fail } from "./support/util";
import { describe, it, expect } from "bun:test";

// Hanging tests are disabled because they cause the test suite to hang
describe.skip("server attachment", () => {
  describe("http.Server", () => {
    const clientVersion = require("socket.io-client/package.json").version;

    const testSource = filename => done => {
      const srv = createServer();
      const io = new Server(srv);
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 1000);

      request(srv)
        .get("/socket.io/" + filename)
        .buffer(true)
        .end((err, res) => {
          clearTimeout(timeout);
          if (err) return fail(done, io, err);
          try {
            expect(res.headers["content-type"]).toBe("application/javascript; charset=utf-8");
            expect(res.headers.etag).toBe('"' + clientVersion + '"');
            expect(res.headers["x-sourcemap"]).toBe(undefined);
            expect(res.text).toMatch(/engine\.io/);
            expect(res.status).toBe(200);
            success(done, io);
          } catch (err) {
            fail(done, io, err);
          }
        });
    };

    const testSourceMap = filename => done => {
      const srv = createServer();
      const io = new Server(srv);
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 200);
      request(srv)
        .get("/socket.io/" + filename)
        .buffer(true)
        .end((err, res) => {
          clearTimeout(timeout);
          if (err) return fail(done, io, err);
          try {
            expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
            expect(res.headers.etag).toBe('"' + clientVersion + '"');
            expect(res.text).toMatch(/engine\.io/);
            expect(res.status).toBe(200);
            success(done, io);
          } catch (err) {
            fail(done, io, err);
          }
        });
    };

    it("should serve client", testSource("socket.io.js"));
    it("should serve client with query string", testSource("socket.io.js?buster=" + Date.now()));
    it("should serve source map", testSourceMap("socket.io.js.map"));
    it("should serve client (min)", testSource("socket.io.min.js"));

    it("should serve source map (min)", testSourceMap("socket.io.min.js.map"));

    it.skip("should serve client (gzip)", done => {
      const srv = createServer();
      const io = new Server(srv);
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 200);
      request(srv)
        .get("/socket.io/socket.io.js")
        .set("accept-encoding", "gzip,br,deflate")
        .buffer(true)
        .end((err, res) => {
          clearTimeout(timeout);
          if (err) return fail(done, io, err);
          try {
            expect(res.headers["content-encoding"]).toBe("gzip");
            expect(res.status).toBe(200);
            success(done, io);
          } catch (err) {
            fail(done, io, err);
          }
        });
    });

    it("should serve bundle with msgpack parser", testSource("socket.io.msgpack.min.js"));

    it("should serve source map for bundle with msgpack parser", testSourceMap("socket.io.msgpack.min.js.map"));

    it("should serve the ESM bundle", testSource("socket.io.esm.min.js"));

    it("should serve the source map for the ESM bundle", testSourceMap("socket.io.esm.min.js.map"));

    it("should handle 304", done => {
      const srv = createServer();
      const io = new Server(srv);
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 200);
      request(srv)
        .get("/socket.io/socket.io.js")
        .set("If-None-Match", '"' + clientVersion + '"')
        .end((err, res) => {
          try {
            clearTimeout(timeout);
            if (err) return done(err);
            expect(res.statusCode).toBe(304);
            success(done, io);
          } catch (err) {
            fail(done, io, err);
          }
        });
    });

    it("should handle 304", done => {
      const srv = createServer();
      const io = new Server(srv);
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 200);
      request(srv)
        .get("/socket.io/socket.io.js")
        .set("If-None-Match", 'W/"' + clientVersion + '"')
        .end((err, res) => {
          try {
            clearTimeout(timeout);
            if (err) return done(err);
            expect(res.statusCode).toBe(304);
            success(done, io);
          } catch (err) {
            fail(done, io, err);
          }
        });
    });

    it("should not serve static files", done => {
      const srv = createServer();
      const io = new Server(srv, { serveClient: false });
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 200);

      request(srv)
        .get("/socket.io/socket.io.js")
        .expect(400, err => {
          clearTimeout(timeout);
          if (err) return fail(done, io, err);
          success(done, io);
        });
    });

    it("should work with #attach", done => {
      const srv = createServer((req, res) => {
        res.writeHead(404);
        res.end();
      });
      const sockets = new Server();
      const timeout = setTimeout(() => {
        fail(done, sockets, new Error("timeout"));
      }, 200);
      sockets.attach(srv);
      request(srv)
        .get("/socket.io/socket.io.js")
        .end((err, res) => {
          try {
            clearTimeout(timeout);
            if (err) return done(err);
            expect(res.statusCode).toBe(200);
            success(done, sockets);
          } catch (err) {
            fail(done, sockets, err);
          }
        });
    });

    it("should work with #attach (and merge options)", done => {
      const srv = createServer((req, res) => {
        res.writeHead(404);
        res.end();
      });
      const server = new Server({
        pingTimeout: 6000,
      });
      try {
        server.attach(srv, {
          pingInterval: 24000,
        });
        // @ts-ignore
        expect(server.eio.opts.pingTimeout).toBe(6000);
        // @ts-ignore
        expect(server.eio.opts.pingInterval).toBe(24000);
        success(done, server);
      } catch (err) {
        fail(done, server, err);
      }
    });
  });

  describe("port", () => {
    it("should be bound", done => {
      const io = new Server(0);
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 200);

      request(`http://localhost:${getPort(io)}`)
        .get("/socket.io/socket.io.js")
        .expect(200, err => {
          clearTimeout(timeout);
          if (err) return fail(done, io, err);
          success(done, io);
        });
    });

    it("with listen", done => {
      const io = new Server().listen(0);
      const timeout = setTimeout(() => {
        fail(done, io, new Error("timeout"));
      }, 200);

      request(`http://localhost:${getPort(io)}`)
        .get("/socket.io/socket.io.js")
        .expect(200, err => {
          clearTimeout(timeout);
          if (err) return fail(done, io, err);
          success(done, io);
        });
    });
  });
});
