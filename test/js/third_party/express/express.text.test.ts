"use strict";

var assert = require("node:assert");
var AsyncLocalStorage = require("node:async_hooks").AsyncLocalStorage;

var express = require("express");
var request = require("supertest");

describe("express.text()", function () {
  let app;

  beforeAll(function () {
    app = createApp();
  });

  it("should parse text/plain", function (done) {
    request(app).post("/").set("Content-Type", "text/plain").send("user is tobi").expect(200, '"user is tobi"', done);
  });

  it("should 400 when invalid content-length", function (done) {
    var app = express();

    app.use(function (req, res, next) {
      req.headers["content-length"] = "20"; // bad length
      next();
    });

    app.use(express.text());

    app.post("/", function (req, res) {
      res.json(req.body);
    });

    request(app)
      .post("/")
      .set("Content-Type", "text/plain")
      .send("user")
      .expect(400, /content length/, done);
  });

  it("should handle Content-Length: 0", function (done) {
    request(createApp({ limit: "1kb" }))
      .post("/")
      .set("Content-Type", "text/plain")
      .set("Content-Length", "0")
      .expect(200, '""', done);
  });

  it.todo("should handle empty message-body", function (done) {
    request(createApp({ limit: "1kb" }))
      .post("/")
      .set("Content-Type", "text/plain")
      .set("Transfer-Encoding", "chunked")
      .send("")
      .expect(200, '""', done);
  });

  it("should handle duplicated middleware", function (done) {
    var app = express();

    app.use(express.text());
    app.use(express.text());

    app.post("/", function (req, res) {
      res.json(req.body);
    });

    request(app).post("/").set("Content-Type", "text/plain").send("user is tobi").expect(200, '"user is tobi"', done);
  });

  describe("with defaultCharset option", function () {
    it("should change default charset", function (done) {
      var server = createApp({ defaultCharset: "koi8-r" });
      var test = request(server).post("/");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("6e616d6520697320cec5d4", "hex"));
      test.expect(200, '"name is нет"', done);
    });

    it("should honor content-type charset", function (done) {
      var server = createApp({ defaultCharset: "koi8-r" });
      var test = request(server).post("/");
      test.set("Content-Type", "text/plain; charset=utf-8");
      test.write(Buffer.from("6e616d6520697320e8aeba", "hex"));
      test.expect(200, '"name is 论"', done);
    });
  });

  describe("with limit option", function () {
    it("should 413 when over limit with Content-Length", function (done) {
      var buf = Buffer.alloc(1028, ".");
      request(createApp({ limit: "1kb" }))
        .post("/")
        .set("Content-Type", "text/plain")
        .set("Content-Length", "1028")
        .send(buf.toString())
        .expect(413, done);
    });

    it.todo("should 413 when over limit with chunked encoding", function (done) {
      var app = createApp({ limit: "1kb" });
      var buf = Buffer.alloc(1028, ".");
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain");
      test.set("Transfer-Encoding", "chunked");
      test.write(buf.toString());
      test.expect(413, done);
    });

    it("should 413 when inflated body over limit", function (done) {
      var app = createApp({ limit: "1kb" });
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("1f8b080000000000000ad3d31b05a360148c64000087e5a14704040000", "hex"));
      test.expect(413, done);
    });

    it("should accept number of bytes", function (done) {
      var buf = Buffer.alloc(1028, ".");
      request(createApp({ limit: 1024 }))
        .post("/")
        .set("Content-Type", "text/plain")
        .send(buf.toString())
        .expect(413, done);
    });

    it("should not change when options altered", function (done) {
      var buf = Buffer.alloc(1028, ".");
      var options = { limit: "1kb" };
      var app = createApp(options);

      options.limit = "100kb";

      request(app).post("/").set("Content-Type", "text/plain").send(buf.toString()).expect(413, done);
    });

    it("should not hang response", function (done) {
      var app = createApp({ limit: "8kb" });
      var buf = Buffer.alloc(10240, ".");
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain");
      test.write(buf);
      test.write(buf);
      test.write(buf);
      test.expect(413, done);
    });

    it("should not error when inflating", function (done) {
      var app = createApp({ limit: "1kb" });
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("1f8b080000000000000ad3d31b05a360148c64000087e5a1470404", "hex"));
      setTimeout(function () {
        test.expect(413, done);
      }, 100);
    });
  });

  describe("with inflate option", function () {
    describe.todo("when false", function () {
      beforeAll(function () {
        app = createApp({ inflate: false });
      });

      it("should not accept content-encoding", function (done) {
        var test = request(app).post("/");
        test.set("Content-Encoding", "gzip");
        test.set("Content-Type", "text/plain");
        test.write(Buffer.from("1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000", "hex"));
        test.expect(415, "[encoding.unsupported] content encoding unsupported", done);
      });
    });

    describe("when true", function () {
      beforeAll(function () {
        app = createApp({ inflate: true });
      });

      it("should accept content-encoding", function (done) {
        var test = request(app).post("/");
        test.set("Content-Encoding", "gzip");
        test.set("Content-Type", "text/plain");
        test.write(Buffer.from("1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000", "hex"));
        test.expect(200, '"name is 论"', done);
      });
    });
  });

  describe("with type option", function () {
    describe.todo('when "text/html"', function () {
      beforeAll(function () {
        app = createApp({ type: "text/html" });
      });

      it("should parse for custom type", function (done) {
        request(app).post("/").set("Content-Type", "text/html").send("<b>tobi</b>").expect(200, '"<b>tobi</b>"', done);
      });

      it("should ignore standard type", function (done) {
        request(app).post("/").set("Content-Type", "text/plain").send("user is tobi").expect(200, "", done);
      });
    });

    describe('when ["text/html", "text/plain"]', function () {
      beforeAll(function () {
        app = createApp({ type: ["text/html", "text/plain"] });
      });

      it.todo('should parse "text/html"', function (done) {
        request(app).post("/").set("Content-Type", "text/html").send("<b>tobi</b>").expect(200, '"<b>tobi</b>"', done);
      });

      it('should parse "text/plain"', function (done) {
        request(app).post("/").set("Content-Type", "text/plain").send("tobi").expect(200, '"tobi"', done);
      });

      it.todo('should ignore "text/xml"', function (done) {
        request(app).post("/").set("Content-Type", "text/xml").send("<user>tobi</user>").expect(200, "", done);
      });
    });

    describe("when a function", function () {
      it("should parse when truthy value returned", function (done) {
        var app = createApp({ type: accept });

        function accept(req) {
          return req.headers["content-type"] === "text/vnd.something";
        }

        request(app)
          .post("/")
          .set("Content-Type", "text/vnd.something")
          .send("user is tobi")
          .expect(200, '"user is tobi"', done);
      });

      it("should work without content-type", function (done) {
        var app = createApp({ type: accept });

        function accept(req) {
          return true;
        }

        var test = request(app).post("/");
        test.write("user is tobi");
        test.expect(200, '"user is tobi"', done);
      });

      it("should not invoke without a body", function (done) {
        var app = createApp({ type: accept });

        function accept(req) {
          throw new Error("oops!");
        }

        request(app).get("/").expect(404, done);
      });
    });
  });

  describe("with verify option", function () {
    it("should assert value is function", function () {
      assert.throws(createApp.bind(null, { verify: "lol" }), /TypeError: option verify must be function/);
    });

    it("should error from verify", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x20) throw new Error("no leading space");
        },
      });

      request(app)
        .post("/")
        .set("Content-Type", "text/plain")
        .send(" user is tobi")
        .expect(403, "[entity.verify.failed] no leading space", done);
    });

    it("should allow custom codes", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x20) return;
          var err = new Error("no leading space");
          err.status = 400;
          throw err;
        },
      });

      request(app)
        .post("/")
        .set("Content-Type", "text/plain")
        .send(" user is tobi")
        .expect(400, "[entity.verify.failed] no leading space", done);
    });

    it("should allow pass-through", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x20) throw new Error("no leading space");
        },
      });

      request(app).post("/").set("Content-Type", "text/plain").send("user is tobi").expect(200, '"user is tobi"', done);
    });

    it("should 415 on unknown charset prior to verify", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          throw new Error("unexpected verify call");
        },
      });

      var test = request(app).post("/");
      test.set("Content-Type", "text/plain; charset=x-bogus");
      test.write(Buffer.from("00000000", "hex"));
      test.expect(415, '[charset.unsupported] unsupported charset "X-BOGUS"', done);
    });
  });

  describe.todo("async local storage", function () {
    beforeAll(function () {
      var app = express();
      var store = { foo: "bar" };

      app.use(function (req, res, next) {
        req.asyncLocalStorage = new AsyncLocalStorage();
        req.asyncLocalStorage.run(store, next);
      });

      app.use(express.text());

      app.use(function (req, res, next) {
        var local = req.asyncLocalStorage.getStore();

        if (local) {
          res.setHeader("x-store-foo", String(local.foo));
        }

        next();
      });

      app.use(function (err, req, res, next) {
        var local = req.asyncLocalStorage.getStore();

        if (local) {
          res.setHeader("x-store-foo", String(local.foo));
        }

        res.status(err.status || 500);
        res.send("[" + err.type + "] " + err.message);
      });

      app.post("/", function (req, res) {
        res.json(req.body);
      });

      app = app;
    });

    it("should presist store", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "text/plain")
        .send("user is tobi")
        .expect(200)
        .expect("x-store-foo", "bar")
        .expect('"user is tobi"')
        .end(done);
    });

    it("should presist store when unmatched content-type", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "application/fizzbuzz")
        .send("buzz")
        .expect(200)
        .expect("x-store-foo", "bar")
        .end(done);
    });

    it("should presist store when inflated", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000", "hex"));
      test.expect(200);
      test.expect("x-store-foo", "bar");
      test.expect('"name is 论"');
      test.end(done);
    });

    it("should presist store when inflate error", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b0000", "hex"));
      test.expect(400);
      test.expect("x-store-foo", "bar");
      test.end(done);
    });

    it("should presist store when limit exceeded", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "text/plain")
        .send("user is " + Buffer.alloc(1024 * 100, ".").toString())
        .expect(413)
        .expect("x-store-foo", "bar")
        .end(done);
    });
  });

  describe("charset", function () {
    beforeAll(function () {
      app = createApp();
    });

    it("should parse utf-8", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain; charset=utf-8");
      test.write(Buffer.from("6e616d6520697320e8aeba", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should parse codepage charsets", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain; charset=koi8-r");
      test.write(Buffer.from("6e616d6520697320cec5d4", "hex"));
      test.expect(200, '"name is нет"', done);
    });

    it("should parse when content-length != char length", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain; charset=utf-8");
      test.set("Content-Length", "11");
      test.write(Buffer.from("6e616d6520697320e8aeba", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should default to utf-8", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("6e616d6520697320e8aeba", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should 415 on unknown charset", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain; charset=x-bogus");
      test.write(Buffer.from("00000000", "hex"));
      test.expect(415, '[charset.unsupported] unsupported charset "X-BOGUS"', done);
    });
  });

  describe("encoding", function () {
    beforeAll(function () {
      app = createApp({ limit: "10kb" });
    });

    it("should parse without encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("6e616d6520697320e8aeba", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should support identity encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "identity");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("6e616d6520697320e8aeba", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should support gzip encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should support deflate encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "deflate");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("789ccb4bcc4d55c82c5678b16e17001a6f050e", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should be case-insensitive", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "GZIP");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("1f8b080000000000000bcb4bcc4d55c82c5678b16e170072b3e0200b000000", "hex"));
      test.expect(200, '"name is 论"', done);
    });

    it("should 415 on unknown encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "nulls");
      test.set("Content-Type", "text/plain");
      test.write(Buffer.from("000000000000", "hex"));
      test.expect(415, '[encoding.unsupported] unsupported content encoding "nulls"', done);
    });
  });
});

function createApp(options?) {
  var app = express();

  app.use(express.text(options));

  app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.send(
      String(
        req.headers["x-error-property"] ? err[req.headers["x-error-property"]] : "[" + err.type + "] " + err.message,
      ),
    );
  });

  app.post("/", function (req, res) {
    res.json(req.body);
  });

  return app;
}
