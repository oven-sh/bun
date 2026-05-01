"use strict";

var assert = require("node:assert");
var AsyncLocalStorage = require("node:async_hooks").AsyncLocalStorage;

var express = require("express");
var request = require("supertest");

describe("express.json()", function () {
  let app;

  it("should parse JSON", function (done) {
    request(createApp())
      .post("/")
      .set("Content-Type", "application/json")
      .send('{"user":"tobi"}')
      .expect(200, '{"user":"tobi"}', done);
  });

  it("should handle Content-Length: 0", function (done) {
    request(createApp())
      .post("/")
      .set("Content-Type", "application/json")
      .set("Content-Length", "0")
      .expect(200, "{}", done);
  });

  it.todo("should handle empty message-body", function (done) {
    request(createApp())
      .post("/")
      .set("Content-Type", "application/json")
      .set("Transfer-Encoding", "chunked")
      .expect(200, "{}", done);
  });

  it("should handle no message-body", function (done) {
    request(createApp())
      .post("/")
      .set("Content-Type", "application/json")
      .unset("Transfer-Encoding")
      .expect(200, "{}", done);
  });

  // The old node error message modification in body parser is catching this
  it("should 400 when only whitespace", function (done) {
    request(createApp())
      .post("/")
      .set("Content-Type", "application/json")
      .send("  \n")
      .expect(400, "[entity.parse.failed] " + parseError(" \n"), done);
  });

  it("should 400 when invalid content-length", function (done) {
    var app = express();

    app.use(function (req, res, next) {
      req.headers["content-length"] = "20"; // bad length
      next();
    });

    app.use(express.json());

    app.post("/", function (req, res) {
      res.json(req.body);
    });

    request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send('{"str":')
      .expect(400, /content length/, done);
  });

  it("should handle duplicated middleware", function (done) {
    var app = express();

    app.use(express.json());
    app.use(express.json());

    app.post("/", function (req, res) {
      res.json(req.body);
    });

    request(app)
      .post("/")
      .set("Content-Type", "application/json")
      .send('{"user":"tobi"}')
      .expect(200, '{"user":"tobi"}', done);
  });

  describe("when JSON is invalid", function () {
    let app;
    beforeAll(function () {
      app = createApp();
    });

    it("should 400 for bad token", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send("{:")
        .expect(400, "[entity.parse.failed] " + parseError("{:"), done);
    });

    it("should 400 for incomplete", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send('{"user"')
        .expect(400, "[entity.parse.failed] " + parseError('{"user"'), done);
    });

    it("should include original body on error object", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .set("X-Error-Property", "body")
        .send(' {"user"')
        .expect(400, ' {"user"', done);
    });
  });

  describe("with limit option", function () {
    it("should 413 when over limit with Content-Length", function (done) {
      var buf = Buffer.alloc(1024, ".");
      request(createApp({ limit: "1kb" }))
        .post("/")
        .set("Content-Type", "application/json")
        .set("Content-Length", "1034")
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, "[entity.too.large] request entity too large", done);
    });

    it("should 413 when over limit with chunked encoding", function (done) {
      var app = createApp({ limit: "1kb" });
      var buf = Buffer.alloc(1024, ".");
      var test = request(app).post("/");
      test.set("Content-Type", "application/json");
      test.set("Transfer-Encoding", "chunked");
      test.write('{"str":');
      test.write('"' + buf.toString() + '"}');
      test.expect(413, done);
    });

    it("should 413 when inflated body over limit", function (done) {
      var app = createApp({ limit: "1kb" });
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000aab562a2e2952b252d21b05a360148c58a0540b0066f7ce1e0a040000", "hex"));
      test.expect(413, done);
    });

    it("should accept number of bytes", function (done) {
      var buf = Buffer.alloc(1024, ".");
      request(createApp({ limit: 1024 }))
        .post("/")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, done);
    });

    it("should not change when options altered", function (done) {
      var buf = Buffer.alloc(1024, ".");
      var options = { limit: "1kb" };
      var app = createApp(options);

      options.limit = "100kb";

      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ str: buf.toString() }))
        .expect(413, done);
    });

    it("should not hang response", function (done) {
      var buf = Buffer.alloc(10240, ".");
      var app = createApp({ limit: "8kb" });
      var test = request(app).post("/");
      test.set("Content-Type", "application/json");
      test.write(buf);
      test.write(buf);
      test.write(buf);
      test.expect(413, done);
    });

    it("should not error when inflating", function (done) {
      var app = createApp({ limit: "1kb" });
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000aab562a2e2952b252d21b05a360148c58a0540b0066f7ce1e0a0400", "hex"));
      test.expect(413, done);
    });
  });

  describe("with inflate option", function () {
    describe("when false", function () {
      beforeAll(function () {
        app = createApp({ inflate: false });
      });

      it.todo("should not accept content-encoding", function (done) {
        var test = request(app).post("/");
        test.set("Content-Encoding", "gzip");
        test.set("Content-Type", "application/json");
        test.write(Buffer.from("1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000", "hex"));
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
        test.set("Content-Type", "application/json");
        test.write(Buffer.from("1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000", "hex"));
        test.expect(200, '{"name":"论"}', done);
      });
    });
  });

  describe("with strict option", function () {
    describe("when undefined", function () {
      beforeAll(function () {
        app = createApp();
      });

      it("should 400 on primitives", function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .send("true")
          .expect(400, "[entity.parse.failed] " + parseError("#rue").replace(/#/g, "t"), done);
      });
    });

    describe("when false", function () {
      beforeAll(function () {
        app = createApp({ strict: false });
      });

      it.todo("should parse primitives", function (done) {
        request(app).post("/").set("Content-Type", "application/json").send("true").expect(200, "true", done);
      });
    });

    describe("when true", function () {
      beforeAll(function () {
        app = createApp({ strict: true });
      });

      it("should not parse primitives", function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .send("true")
          .expect(400, "[entity.parse.failed] " + parseError("#rue").replace(/#/g, "t"), done);
      });

      it("should not parse primitives with leading whitespaces", function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .send("    true")
          .expect(400, "[entity.parse.failed] " + parseError("    #rue").replace(/#/g, "t"), done);
      });

      it("should allow leading whitespaces in JSON", function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .send('   { "user": "tobi" }')
          .expect(200, '{"user":"tobi"}', done);
      });

      it("should include correct message in stack trace", function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .set("X-Error-Property", "stack")
          .send("true")
          .expect(400)
          .expect(shouldContainInBody(parseError("#rue").replace(/#/g, "t")))
          .end(done);
      });
    });
  });

  describe("with type option", function () {
    describe.skip('when "application/vnd.api+json"', function () {
      beforeAll(function () {
        app = createApp({ type: "application/vnd.api+json" });
      });

      it("should parse JSON for custom type", function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/vnd.api+json")
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done);
      });

      it("should ignore standard type", function (done) {
        request(app).post("/").set("Content-Type", "application/json").send('{"user":"tobi"}').expect(200, "", done);
      });
    });

    describe('when ["application/json", "application/vnd.api+json"]', function () {
      beforeAll(function () {
        app = createApp({
          type: ["application/json", "application/vnd.api+json"],
        });
      });

      it('should parse JSON for "application/json"', function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/json")
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done);
      });

      it.todo('should parse JSON for "application/vnd.api+json"', function (done) {
        request(app)
          .post("/")
          .set("Content-Type", "application/vnd.api+json")
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done);
      });

      it.todo('should ignore "application/x-json"', function (done) {
        request(app).post("/").set("Content-Type", "application/x-json").send('{"user":"tobi"}').expect(200, "", done);
      });
    });

    describe("when a function", function () {
      it("should parse when truthy value returned", function (done) {
        var app = createApp({ type: accept });

        function accept(req) {
          return req.headers["content-type"] === "application/vnd.api+json";
        }

        request(app)
          .post("/")
          .set("Content-Type", "application/vnd.api+json")
          .send('{"user":"tobi"}')
          .expect(200, '{"user":"tobi"}', done);
      });

      it("should work without content-type", function (done) {
        var app = createApp({ type: accept });

        function accept(req) {
          return true;
        }

        var test = request(app).post("/");
        test.write('{"user":"tobi"}');
        test.expect(200, '{"user":"tobi"}', done);
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
    it("should assert value if function", function () {
      assert.throws(createApp.bind(null, { verify: "lol" }), /TypeError: option verify must be function/);
    });

    it("should error from verify", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error("no arrays");
        },
      });

      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send('["tobi"]')
        .expect(403, "[entity.verify.failed] no arrays", done);
    });

    it("should allow custom codes", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x5b) return;
          var err = new Error("no arrays");
          err.status = 400;
          throw err;
        },
      });

      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send('["tobi"]')
        .expect(400, "[entity.verify.failed] no arrays", done);
    });

    it("should allow custom type", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] !== 0x5b) return;
          var err = new Error("no arrays");
          err.type = "foo.bar";
          throw err;
        },
      });

      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send('["tobi"]')
        .expect(403, "[foo.bar] no arrays", done);
    });

    it("should include original body on error object", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error("no arrays");
        },
      });

      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .set("X-Error-Property", "body")
        .send('["tobi"]')
        .expect(403, '["tobi"]', done);
    });

    it("should allow pass-through", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error("no arrays");
        },
      });

      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send('{"user":"tobi"}')
        .expect(200, '{"user":"tobi"}', done);
    });

    it("should work with different charsets", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          if (buf[0] === 0x5b) throw new Error("no arrays");
        },
      });

      var test = request(app).post("/");
      test.set("Content-Type", "application/json; charset=utf-16");
      test.write(Buffer.from("feff007b0022006e0061006d00650022003a00228bba0022007d", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should 415 on unknown charset prior to verify", function (done) {
      var app = createApp({
        verify: function (req, res, buf) {
          throw new Error("unexpected verify call");
        },
      });

      var test = request(app).post("/");
      test.set("Content-Type", "application/json; charset=x-bogus");
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

      app.use(express.json());

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
        .set("Content-Type", "application/json")
        .send('{"user":"tobi"}')
        .expect(200)
        .expect("x-store-foo", "bar")
        .expect('{"user":"tobi"}')
        .end(done);
    });

    it("should persist store when unmatched content-type", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "application/fizzbuzz")
        .send("buzz")
        .expect(200)
        .expect("x-store-foo", "bar")
        .expect("")
        .end(done);
    });

    it("should presist store when inflated", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000", "hex"));
      test.expect(200);
      test.expect("x-store-foo", "bar");
      test.expect('{"name":"论"}');
      test.end(done);
    });

    it("should presist store when inflate error", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000bab56cc4d55b2527ab16e97522d00515be1cc0e000000", "hex"));
      test.expect(400);
      test.expect("x-store-foo", "bar");
      test.end(done);
    });

    it("should presist store when parse error", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send('{"user":')
        .expect(400)
        .expect("x-store-foo", "bar")
        .end(done);
    });

    it("should presist store when limit exceeded", function (done) {
      request(app)
        .post("/")
        .set("Content-Type", "application/json")
        .send('{"user":"' + Buffer.alloc(1024 * 100, ".").toString() + '"}')
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
      test.set("Content-Type", "application/json; charset=utf-8");
      test.write(Buffer.from("7b226e616d65223a22e8aeba227d", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should parse utf-16", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "application/json; charset=utf-16");
      test.write(Buffer.from("feff007b0022006e0061006d00650022003a00228bba0022007d", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should parse when content-length != char length", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "application/json; charset=utf-8");
      test.set("Content-Length", "13");
      test.write(Buffer.from("7b2274657374223a22c3a5227d", "hex"));
      test.expect(200, '{"test":"å"}', done);
    });

    it("should default to utf-8", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("7b226e616d65223a22e8aeba227d", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should fail on unknown charset", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "application/json; charset=koi8-r");
      test.write(Buffer.from("7b226e616d65223a22cec5d4227d", "hex"));
      test.expect(415, '[charset.unsupported] unsupported charset "KOI8-R"', done);
    });
  });

  describe("encoding", function () {
    let app;
    beforeAll(function () {
      app = createApp({ limit: "1kb" });
    });

    it("should parse without encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("7b226e616d65223a22e8aeba227d", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should support identity encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "identity");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("7b226e616d65223a22e8aeba227d", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should support gzip encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should support deflate encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "deflate");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("789cab56ca4bcc4d55b2527ab16e97522d00274505ac", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should be case-insensitive", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "GZIP");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000bab56ca4bcc4d55b2527ab16e97522d00515be1cc0e000000", "hex"));
      test.expect(200, '{"name":"论"}', done);
    });

    it("should 415 on unknown encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "nulls");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("000000000000", "hex"));
      test.expect(415, '[encoding.unsupported] unsupported content encoding "nulls"', done);
    });

    it("should 400 on malformed encoding", function (done) {
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000bab56cc4d55b2527ab16e97522d00515be1cc0e000000", "hex"));
      test.expect(400, done);
    });

    it("should 413 when inflated value exceeds limit", function (done) {
      // gzip'd data exceeds 1kb, but deflated below 1kb
      var test = request(app).post("/");
      test.set("Content-Encoding", "gzip");
      test.set("Content-Type", "application/json");
      test.write(Buffer.from("1f8b080000000000000bedc1010d000000c2a0f74f6d0f071400000000000000", "hex"));
      test.write(Buffer.from("0000000000000000000000000000000000000000000000000000000000000000", "hex"));
      test.write(Buffer.from("0000000000000000004f0625b3b71650c30000", "hex"));
      test.expect(413, done);
    });
  });
});

function createApp(options?) {
  var app = express();

  app.use(express.json(options));

  app.use(function (err, req, res, next) {
    // console.log(err)
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

function parseError(str) {
  try {
    JSON.parse(str);
    throw new SyntaxError("strict violation");
  } catch (e) {
    return e.message;
  }
}

function shouldContainInBody(str) {
  return function (res) {
    assert.ok(res.text.indexOf(str) !== -1, "expected '" + res.text + "' to contain '" + str + "'");
  };
}
