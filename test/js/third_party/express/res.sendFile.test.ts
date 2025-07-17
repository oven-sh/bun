"use strict";

var after = require("./support/after");
var assert = require("node:assert");
var AsyncLocalStorage = require("node:async_hooks").AsyncLocalStorage;

var express = require("express"),
  request = require("supertest");
// var onFinished = require("on-finished");
var path = require("node:path");
var fixtures = path.join(__dirname, "fixtures");
var utils = require("./support/utils");

describe("res", function () {
  describe(".sendFile(path)", function () {
    it("should error missing path", function (done) {
      var app = createApp();

      request(app)
        .get("/")
        .expect(500, /path.*required/, done);
    });

    it("should error for non-string path", function (done) {
      var app = createApp(42);

      request(app)
        .get("/")
        .expect(500, /TypeError: path must be a string to res.sendFile/, done);
    });

    it("should error for non-absolute path", function (done) {
      var app = createApp("name.txt");

      request(app)
        .get("/")
        .expect(500, /TypeError: path must be absolute/, done);
    });

    it.todo("should transfer a file", function (done) {
      var app = createApp(path.resolve(fixtures, "name.txt"));

      request(app).get("/").expect(200, "tobi", done);
    });

    it("should transfer a file with special characters in string", function (done) {
      var app = createApp(path.resolve(fixtures, "% of dogs.txt"));

      request(app).get("/").expect(200, "20%", done);
    });

    it.todo("should include ETag", function (done) {
      var app = createApp(path.resolve(fixtures, "name.txt"));

      request(app)
        .get("/")
        .expect("ETag", /^(?:W\/)?"[^"]+"$/)
        .expect(200, "tobi", done);
    });

    it.todo("should 304 when ETag matches", function (done) {
      var app = createApp(path.resolve(fixtures, "name.txt"));

      request(app)
        .get("/")
        .expect("ETag", /^(?:W\/)?"[^"]+"$/)
        .expect(200, "tobi", function (err, res) {
          if (err) return done(err);
          var etag = res.headers.etag;
          request(app).get("/").set("If-None-Match", etag).expect(304, done);
        });
    });

    it.todo("should disable the ETag function if requested", function (done) {
      var app = createApp(path.resolve(fixtures, "name.txt")).disable("etag");

      request(app).get("/").expect(handleHeaders).expect(200, done);

      function handleHeaders(res) {
        assert(res.headers.etag === undefined);
      }
    });

    it("should 404 for directory", function (done) {
      var app = createApp(path.resolve(fixtures, "blog"));

      request(app).get("/").expect(404, done);
    });

    it("should 404 when not found", function (done) {
      var app = createApp(path.resolve(fixtures, "does-no-exist"));

      app.use(function (req, res) {
        res.statusCode = 200;
        res.send("no!");
      });

      request(app).get("/").expect(404, done);
    });

    it("should send cache-control by default", function (done) {
      var app = createApp(path.resolve(__dirname, "fixtures/name.txt"));

      request(app).get("/").expect("Cache-Control", "public, max-age=0").expect(200, done);
    });

    it("should not serve dotfiles by default", function (done) {
      var app = createApp(path.resolve(__dirname, "fixtures/.name"));

      request(app).get("/").expect(404, done);
    });

    it("should not override manual content-types", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.contentType("application/x-bogus");
        res.sendFile(path.resolve(fixtures, "name.txt"));
      });

      request(app).get("/").expect("Content-Type", "application/x-bogus").end(done);
    });

    it.todo("should not error if the client aborts", function (done) {
      var app = express();
      var cb = after(2, done);
      var error = null;

      app.use(function (req, res) {
        setImmediate(function () {
          res.sendFile(path.resolve(fixtures, "name.txt"));
          setTimeout(function () {
            cb(error);
          }, 10);
        });
        test.req.abort();
      });

      app.use(function (err, req, res, next) {
        error = err;
        next(err);
      });

      var server = app.listen();
      var test = request(server).get("/");
      test.end(function (err) {
        assert.ok(err);
        server.close(cb);
      });
    });
  });

  describe(".sendFile(path, fn)", function () {
    it("should invoke the callback when complete", function (done) {
      var cb = after(2, done);
      var app = createApp(path.resolve(fixtures, "name.txt"), cb);

      request(app).get("/").expect(200, cb);
    });

    it.todo("should invoke the callback when client aborts", function (done) {
      var cb = after(2, done);
      var app = express();

      app.use(function (req, res) {
        setImmediate(function () {
          res.sendFile(path.resolve(fixtures, "name.txt"), function (err) {
            assert.ok(err);
            assert.strictEqual(err.code, "ECONNABORTED");
            cb();
          });
        });
        test.req.abort();
      });

      var server = app.listen();
      var test = request(server).get("/");
      test.end(function (err) {
        assert.ok(err);
        server.close(cb);
      });
    });

    // TODO: refactor to not use onFinished
    // it("should invoke the callback when client already aborted", function (done) {
    //   var cb = after(2, done);
    //   var app = express();

    //   app.use(function (req, res) {
    //     onFinished(res, function () {
    //       res.sendFile(path.resolve(fixtures, "name.txt"), function (err) {
    //         assert.ok(err);
    //         assert.strictEqual(err.code, "ECONNABORTED");
    //         cb();
    //       });
    //     });
    //     test.req.abort();
    //   });

    //   var server = app.listen();
    //   var test = request(server).get("/");
    //   test.end(function (err) {
    //     assert.ok(err);
    //     server.close(cb);
    //   });
    // });

    it("should invoke the callback without error when HEAD", function (done) {
      var app = express();
      var cb = after(2, done);

      app.use(function (req, res) {
        res.sendFile(path.resolve(fixtures, "name.txt"), cb);
      });

      request(app).head("/").expect(200, cb);
    });

    it.todo("should invoke the callback without error when 304", function (done) {
      var app = express();
      var cb = after(3, done);

      app.use(function (req, res) {
        res.sendFile(path.resolve(fixtures, "name.txt"), cb);
      });

      request(app)
        .get("/")
        .expect("ETag", /^(?:W\/)?"[^"]+"$/)
        .expect(200, "tobi", function (err, res) {
          if (err) return cb(err);
          var etag = res.headers.etag;
          request(app).get("/").set("If-None-Match", etag).expect(304, cb);
        });
    });

    it("should invoke the callback on 404", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.sendFile(path.resolve(fixtures, "does-not-exist"), function (err) {
          res.send(err ? "got " + err.status + " error" : "no error");
        });
      });

      request(app).get("/").expect(200, "got 404 error", done);
    });

    describe.todo("async local storage", function () {
      it("should presist store", function (done) {
        var app = express();
        var cb = after(2, done);
        var store = { foo: "bar" };

        app.use(function (req, res, next) {
          req.asyncLocalStorage = new AsyncLocalStorage();
          req.asyncLocalStorage.run(store, next);
        });

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "name.txt"), function (err) {
            if (err) return cb(err);

            var local = req.asyncLocalStorage.getStore();

            assert.strictEqual(local.foo, "bar");
            cb();
          });
        });

        request(app).get("/").expect("Content-Type", "text/plain; charset=utf-8").expect(200, "tobi", cb);
      });

      it("should presist store on error", function (done) {
        var app = express();
        var store = { foo: "bar" };

        app.use(function (req, res, next) {
          req.asyncLocalStorage = new AsyncLocalStorage();
          req.asyncLocalStorage.run(store, next);
        });

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "does-not-exist"), function (err) {
            var local = req.asyncLocalStorage.getStore();

            if (local) {
              res.setHeader("x-store-foo", String(local.foo));
            }

            res.send(err ? "got " + err.status + " error" : "no error");
          });
        });

        request(app).get("/").expect(200).expect("x-store-foo", "bar").expect("got 404 error").end(done);
      });
    });
  });

  describe(".sendFile(path, options)", function () {
    it("should pass options to send module", function (done) {
      request(createApp(path.resolve(fixtures, "name.txt"), { start: 0, end: 1 }))
        .get("/")
        .expect(200, "to", done);
    });

    describe('with "acceptRanges" option', function () {
      describe("when true", function () {
        it("should advertise byte range accepted", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "nums.txt"), {
              acceptRanges: true,
            });
          });

          request(app).get("/").expect(200).expect("Accept-Ranges", "bytes").expect("123456789").end(done);
        });

        it("should respond to range request", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "nums.txt"), {
              acceptRanges: true,
            });
          });

          request(app).get("/").set("Range", "bytes=0-4").expect(206, "12345", done);
        });
      });

      describe("when false", function () {
        it("should not advertise accept-ranges", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "nums.txt"), {
              acceptRanges: false,
            });
          });

          request(app).get("/").expect(200).expect(utils.shouldNotHaveHeader("Accept-Ranges")).end(done);
        });

        it("should not honor range requests", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "nums.txt"), {
              acceptRanges: false,
            });
          });

          request(app).get("/").set("Range", "bytes=0-4").expect(200, "123456789", done);
        });
      });
    });

    describe('with "cacheControl" option', function () {
      describe("when true", function () {
        it("should send cache-control header", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              cacheControl: true,
            });
          });

          request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=0").end(done);
        });
      });

      describe("when false", function () {
        it("should not send cache-control header", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              cacheControl: false,
            });
          });

          request(app).get("/").expect(200).expect(utils.shouldNotHaveHeader("Cache-Control")).end(done);
        });
      });
    });

    describe('with "dotfiles" option', function () {
      describe('when "allow"', function () {
        it("should allow dotfiles", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, ".name"), {
              dotfiles: "allow",
            });
          });

          request(app)
            .get("/")
            .expect(200)
            .expect(utils.shouldHaveBody(Buffer.from("tobi")))
            .end(done);
        });
      });

      describe('when "deny"', function () {
        it("should deny dotfiles", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, ".name"), {
              dotfiles: "deny",
            });
          });

          request(app)
            .get("/")
            .expect(403)
            .expect(/Forbidden/)
            .end(done);
        });
      });

      describe('when "ignore"', function () {
        it("should ignore dotfiles", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, ".name"), {
              dotfiles: "ignore",
            });
          });

          request(app)
            .get("/")
            .expect(404)
            .expect(/Not Found/)
            .end(done);
        });
      });
    });

    describe('with "headers" option', function () {
      it("should set headers on response", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "user.html"), {
            headers: {
              "X-Foo": "Bar",
              "X-Bar": "Foo",
            },
          });
        });

        request(app).get("/").expect(200).expect("X-Foo", "Bar").expect("X-Bar", "Foo").end(done);
      });

      it("should use last header when duplicated", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "user.html"), {
            headers: {
              "X-Foo": "Bar",
              "x-foo": "bar",
            },
          });
        });

        request(app).get("/").expect(200).expect("X-Foo", "bar").end(done);
      });

      it("should override Content-Type", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "user.html"), {
            headers: {
              "Content-Type": "text/x-custom",
            },
          });
        });

        request(app).get("/").expect(200).expect("Content-Type", "text/x-custom").end(done);
      });

      it("should not set headers on 404", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "does-not-exist"), {
            headers: {
              "X-Foo": "Bar",
            },
          });
        });

        request(app).get("/").expect(404).expect(utils.shouldNotHaveHeader("X-Foo")).end(done);
      });
    });

    describe('with "immutable" option', function () {
      describe("when true", function () {
        it("should send cache-control header with immutable", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              immutable: true,
            });
          });

          request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=0, immutable").end(done);
        });
      });

      describe("when false", function () {
        it("should not send cache-control header with immutable", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              immutable: false,
            });
          });

          request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=0").end(done);
        });
      });
    });

    describe('with "lastModified" option', function () {
      describe("when true", function () {
        it("should send last-modified header", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              lastModified: true,
            });
          });

          request(app).get("/").expect(200).expect(utils.shouldHaveHeader("Last-Modified")).end(done);
        });

        it("should conditionally respond with if-modified-since", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              lastModified: true,
            });
          });

          request(app)
            .get("/")
            .set("If-Modified-Since", new Date(Date.now() + 99999).toUTCString())
            .expect(304, done);
        });
      });

      describe("when false", function () {
        it("should not have last-modified header", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              lastModified: false,
            });
          });

          request(app).get("/").expect(200).expect(utils.shouldNotHaveHeader("Last-Modified")).end(done);
        });

        it("should not honor if-modified-since", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              lastModified: false,
            });
          });

          request(app)
            .get("/")
            .set("If-Modified-Since", new Date(Date.now() + 99999).toUTCString())
            .expect(200)
            .expect(utils.shouldNotHaveHeader("Last-Modified"))
            .end(done);
        });
      });
    });

    describe('with "maxAge" option', function () {
      it("should set cache-control max-age to milliseconds", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "user.html"), {
            maxAge: 20000,
          });
        });

        request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=20").end(done);
      });

      it("should cap cache-control max-age to 1 year", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "user.html"), {
            maxAge: 99999999999,
          });
        });

        request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=31536000").end(done);
      });

      it.todo("should min cache-control max-age to 0", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "user.html"), {
            maxAge: -20000,
          });
        });

        request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=0").end(done);
      });

      it.todo("should floor cache-control max-age", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(path.resolve(fixtures, "user.html"), {
            maxAge: 21911.23,
          });
        });

        request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=21").end(done);
      });

      describe("when cacheControl: false", function () {
        it("should not send cache-control", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              cacheControl: false,
              maxAge: 20000,
            });
          });

          request(app).get("/").expect(200).expect(utils.shouldNotHaveHeader("Cache-Control")).end(done);
        });
      });

      describe("when string", function () {
        it("should accept plain number as milliseconds", function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              maxAge: "20000",
            });
          });

          request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=20").end(done);
        });

        it('should accept suffix "s" for seconds', function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              maxAge: "20s",
            });
          });

          request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=20").end(done);
        });

        it('should accept suffix "m" for minutes', function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              maxAge: "20m",
            });
          });

          request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=1200").end(done);
        });

        it('should accept suffix "d" for days', function (done) {
          var app = express();

          app.use(function (req, res) {
            res.sendFile(path.resolve(fixtures, "user.html"), {
              maxAge: "20d",
            });
          });

          request(app).get("/").expect(200).expect("Cache-Control", "public, max-age=1728000").end(done);
        });
      });
    });

    describe.todo('with "root" option', function () {
      it("should allow relative path", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile("name.txt", {
            root: fixtures,
          });
        });

        request(app).get("/").expect(200, "tobi", done);
      });

      it("should allow up within root", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile("fake/../name.txt", {
            root: fixtures,
          });
        });

        request(app).get("/").expect(200, "tobi", done);
      });

      it.todo("should reject up outside root", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile(".." + path.sep + path.relative(path.dirname(fixtures), path.join(fixtures, "name.txt")), {
            root: fixtures,
          });
        });

        request(app).get("/").expect(403, done);
      });

      it("should reject reading outside root", function (done) {
        var app = express();

        app.use(function (req, res) {
          res.sendFile("../name.txt", {
            root: fixtures,
          });
        });

        request(app).get("/").expect(403, done);
      });
    });
  });
});

function createApp(path?, options?, fn?) {
  var app = express();

  app.use(function sendFileMiddleware(req, res) {
    res.sendFile(path, options, fn);
  });

  return app;
}
