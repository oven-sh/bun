"use strict";

var after = require("./support/after");
var express = require("express"),
  request = require("supertest"),
  assert = require("node:assert"),
  methods = require("./support/utils").methods;

var shouldSkipQuery = require("./support/utils").shouldSkipQuery;

describe("app.router", function () {
  it("should restore req.params after leaving router", function (done) {
    var app = express();
    var router = new express.Router();

    function handler1(req, res, next) {
      res.setHeader("x-user-id", String(req.params.id));
      next();
    }

    function handler2(req, res) {
      res.send(req.params.id);
    }

    router.use(function (req, res, next) {
      res.setHeader("x-router", String(req.params.id));
      next();
    });

    app.get("/user/:id", handler1, router, handler2);

    request(app).get("/user/1").expect("x-router", "undefined").expect("x-user-id", "1").expect(200, "1", done);
  });

  describe("methods", function () {
    methods.forEach(function (method) {
      if (method === "connect") return;

      it("should include " + method.toUpperCase(), function (done) {
        if (method === "query" && shouldSkipQuery(process.versions.node)) {
          this.skip();
        }
        var app = express();

        app[method]("/foo", function (req, res) {
          res.send(method);
        });

        request(app)[method]("/foo").expect(200, done);
      });

      it.todo("should reject numbers for app." + method, function () {
        var app = express();
        assert.throws(app[method].bind(app, "/", 3), /argument handler must be a function/);
      });
    });

    it("should re-route when method is altered", function (done) {
      var app = express();
      var cb = after(3, done);

      app.use(function (req, res, next) {
        if (req.method !== "POST") return next();
        req.method = "DELETE";
        res.setHeader("X-Method-Altered", "1");
        next();
      });

      app.delete("/", function (req, res) {
        res.end("deleted everything");
      });

      request(app).get("/").expect(404, cb);

      request(app).delete("/").expect(200, "deleted everything", cb);

      request(app).post("/").expect("X-Method-Altered", "1").expect(200, "deleted everything", cb);
    });
  });

  describe("decode params", function () {
    it("should decode correct params", function (done) {
      var app = express();

      app.get("/:name", function (req, res) {
        res.send(req.params.name);
      });

      request(app).get("/foo%2Fbar").expect("foo/bar", done);
    });

    it("should not accept params in malformed paths", function (done) {
      var app = express();

      app.get("/:name", function (req, res) {
        res.send(req.params.name);
      });

      request(app).get("/%foobar").expect(400, done);
    });

    it("should not decode spaces", function (done) {
      var app = express();

      app.get("/:name", function (req, res) {
        res.send(req.params.name);
      });

      request(app).get("/foo+bar").expect("foo+bar", done);
    });

    it("should work with unicode", function (done) {
      var app = express();

      app.get("/:name", function (req, res) {
        res.send(req.params.name);
      });

      request(app).get("/%ce%b1").expect("\u03b1", done);
    });
  });

  it("should be .use()able", function (done) {
    var app = express();

    var calls = [];

    app.use(function (req, res, next) {
      calls.push("before");
      next();
    });

    app.get("/", function (req, res, next) {
      calls.push("GET /");
      next();
    });

    app.use(function (req, res, next) {
      calls.push("after");
      res.json(calls);
    });

    request(app).get("/").expect(200, ["before", "GET /", "after"], done);
  });

  describe("when given a regexp", function () {
    it("should match the pathname only", function (done) {
      var app = express();

      app.get(/^\/user\/[0-9]+$/, function (req, res) {
        res.end("user");
      });

      request(app).get("/user/12?foo=bar").expect("user", done);
    });

    it("should populate req.params with the captures", function (done) {
      var app = express();

      app.get(/^\/user\/([0-9]+)\/(view|edit)?$/, function (req, res) {
        var id = req.params[0],
          op = req.params[1];
        res.end(op + "ing user " + id);
      });

      request(app).get("/user/10/edit").expect("editing user 10", done);
    });

    if (supportsRegexp("(?<foo>.*)")) {
      it.todo("should populate req.params with named captures", function (done) {
        var app = express();
        var re = new RegExp("^/user/(?<userId>[0-9]+)/(view|edit)?$");

        app.get(re, function (req, res) {
          var id = req.params.userId,
            op = req.params[0];
          res.end(op + "ing user " + id);
        });

        request(app).get("/user/10/edit").expect("editing user 10", done);
      });
    }

    it("should ensure regexp matches path prefix", function (done) {
      var app = express();
      var p = [];

      app.use(/\/api.*/, function (req, res, next) {
        p.push("a");
        next();
      });
      app.use(/api/, function (req, res, next) {
        p.push("b");
        next();
      });
      app.use(/\/test/, function (req, res, next) {
        p.push("c");
        next();
      });
      app.use(function (req, res) {
        res.end();
      });

      request(app)
        .get("/test/api/1234")
        .expect(200, function (err) {
          if (err) return done(err);
          assert.deepEqual(p, ["c"]);
          done();
        });
    });
  });

  describe("case sensitivity", function () {
    it("should be disabled by default", function (done) {
      var app = express();

      app.get("/user", function (req, res) {
        res.end("tj");
      });

      request(app).get("/USER").expect("tj", done);
    });

    describe('when "case sensitive routing" is enabled', function () {
      it("should match identical casing", function (done) {
        var app = express();

        app.enable("case sensitive routing");

        app.get("/uSer", function (req, res) {
          res.end("tj");
        });

        request(app).get("/uSer").expect("tj", done);
      });

      it("should not match otherwise", function (done) {
        var app = express();

        app.enable("case sensitive routing");

        app.get("/uSer", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user").expect(404, done);
      });
    });
  });

  describe("params", function () {
    it("should overwrite existing req.params by default", function (done) {
      var app = express();
      var router = new express.Router();

      router.get("/:action", function (req, res) {
        res.send(req.params);
      });

      app.use("/user/:user", router);

      request(app).get("/user/1/get").expect(200, '{"action":"get"}', done);
    });

    it("should allow merging existing req.params", function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get("/:action", function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(
          keys.map(function (k) {
            return [k, req.params[k]];
          }),
        );
      });

      app.use("/user/:user", router);

      request(app).get("/user/tj/get").expect(200, '[["action","get"],["user","tj"]]', done);
    });

    it("should use params from router", function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get("/:thing", function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(
          keys.map(function (k) {
            return [k, req.params[k]];
          }),
        );
      });

      app.use("/user/:thing", router);

      request(app).get("/user/tj/get").expect(200, '[["thing","get"]]', done);
    });

    it("should merge numeric indices req.params", function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/^\/(.*)\.(.*)/, function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(
          keys.map(function (k) {
            return [k, req.params[k]];
          }),
        );
      });

      app.use(/^\/user\/id:(\d+)/, router);

      request(app).get("/user/id:10/profile.json").expect(200, '[["0","10"],["1","profile"],["2","json"]]', done);
    });

    it("should merge numeric indices req.params when more in parent", function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/\/(.*)/, function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(
          keys.map(function (k) {
            return [k, req.params[k]];
          }),
        );
      });

      app.use(/^\/user\/id:(\d+)\/name:(\w+)/, router);

      request(app).get("/user/id:10/name:tj/profile").expect(200, '[["0","10"],["1","tj"],["2","profile"]]', done);
    });

    it("should merge numeric indices req.params when parent has same number", function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/\/name:(\w+)/, function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(
          keys.map(function (k) {
            return [k, req.params[k]];
          }),
        );
      });

      app.use(/\/user\/id:(\d+)/, router);

      request(app).get("/user/id:10/name:tj").expect(200, '[["0","10"],["1","tj"]]', done);
    });

    it("should ignore invalid incoming req.params", function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get("/:name", function (req, res) {
        var keys = Object.keys(req.params).sort();
        res.send(
          keys.map(function (k) {
            return [k, req.params[k]];
          }),
        );
      });

      app.use("/user/", function (req, res, next) {
        req.params = 3; // wat?
        router(req, res, next);
      });

      request(app).get("/user/tj").expect(200, '[["name","tj"]]', done);
    });

    it("should restore req.params", function (done) {
      var app = express();
      var router = new express.Router({ mergeParams: true });

      router.get(/\/user:(\w+)\//, function (req, res, next) {
        next();
      });

      app.use(/\/user\/id:(\d+)/, function (req, res, next) {
        router(req, res, function (err) {
          var keys = Object.keys(req.params).sort();
          res.send(
            keys.map(function (k) {
              return [k, req.params[k]];
            }),
          );
        });
      });

      request(app).get("/user/id:42/user:tj/profile").expect(200, '[["0","42"]]', done);
    });
  });

  describe("trailing slashes", function () {
    it("should be optional by default", function (done) {
      var app = express();

      app.get("/user", function (req, res) {
        res.end("tj");
      });

      request(app).get("/user/").expect("tj", done);
    });

    describe('when "strict routing" is enabled', function () {
      it("should match trailing slashes", function (done) {
        var app = express();

        app.enable("strict routing");

        app.get("/user/", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user/").expect("tj", done);
      });

      it("should pass-though middleware", function (done) {
        var app = express();

        app.enable("strict routing");

        app.use(function (req, res, next) {
          res.setHeader("x-middleware", "true");
          next();
        });

        app.get("/user/", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user/").expect("x-middleware", "true").expect(200, "tj", done);
      });

      it("should pass-though mounted middleware", function (done) {
        var app = express();

        app.enable("strict routing");

        app.use("/user/", function (req, res, next) {
          res.setHeader("x-middleware", "true");
          next();
        });

        app.get("/user/test/", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user/test/").expect("x-middleware", "true").expect(200, "tj", done);
      });

      it("should match no slashes", function (done) {
        var app = express();

        app.enable("strict routing");

        app.get("/user", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user").expect("tj", done);
      });

      it("should match middleware when omitting the trailing slash", function (done) {
        var app = express();

        app.enable("strict routing");

        app.use("/user/", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user").expect(200, "tj", done);
      });

      it("should match middleware", function (done) {
        var app = express();

        app.enable("strict routing");

        app.use("/user", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user").expect(200, "tj", done);
      });

      it("should match middleware when adding the trailing slash", function (done) {
        var app = express();

        app.enable("strict routing");

        app.use("/user", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user/").expect(200, "tj", done);
      });

      it("should fail when omitting the trailing slash", function (done) {
        var app = express();

        app.enable("strict routing");

        app.get("/user/", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user").expect(404, done);
      });

      it("should fail when adding the trailing slash", function (done) {
        var app = express();

        app.enable("strict routing");

        app.get("/user", function (req, res) {
          res.end("tj");
        });

        request(app).get("/user/").expect(404, done);
      });
    });
  });

  it('should allow literal "."', function (done) {
    var app = express();

    app.get("/api/users/:from..:to", function (req, res) {
      var from = req.params.from,
        to = req.params.to;

      res.end("users from " + from + " to " + to);
    });

    request(app).get("/api/users/1..50").expect("users from 1 to 50", done);
  });

  describe(":name", function () {
    it("should denote a capture group", function (done) {
      var app = express();

      app.get("/user/:user", function (req, res) {
        res.end(req.params.user);
      });

      request(app).get("/user/tj").expect("tj", done);
    });

    it("should match a single segment only", function (done) {
      var app = express();

      app.get("/user/:user", function (req, res) {
        res.end(req.params.user);
      });

      request(app).get("/user/tj/edit").expect(404, done);
    });

    it("should allow several capture groups", function (done) {
      var app = express();

      app.get("/user/:user/:op", function (req, res) {
        res.end(req.params.op + "ing " + req.params.user);
      });

      request(app).get("/user/tj/edit").expect("editing tj", done);
    });

    it.todo("should work following a partial capture group", function (done) {
      var app = express();
      var cb = after(2, done);

      app.get("/user{s}/:user/:op", function (req, res) {
        res.end(req.params.op + "ing " + req.params.user + (req.url.startsWith("/users") ? " (old)" : ""));
      });

      request(app).get("/user/tj/edit").expect("editing tj", cb);

      request(app).get("/users/tj/edit").expect("editing tj (old)", cb);
    });

    it("should work inside literal parenthesis", function (done) {
      var app = express();

      app.get("/:user\\(:op\\)", function (req, res) {
        res.end(req.params.op + "ing " + req.params.user);
      });

      request(app).get("/tj(edit)").expect("editing tj", done);
    });

    it("should work in array of paths", function (done) {
      var app = express();
      var cb = after(2, done);

      app.get(["/user/:user/poke", "/user/:user/pokes"], function (req, res) {
        res.end("poking " + req.params.user);
      });

      request(app).get("/user/tj/poke").expect("poking tj", cb);

      request(app).get("/user/tj/pokes").expect("poking tj", cb);
    });
  });

  describe.todo(":name?", function () {
    it("should denote an optional capture group", function (done) {
      var app = express();

      app.get("/user/:user{/:op}", function (req, res) {
        var op = req.params.op || "view";
        res.end(op + "ing " + req.params.user);
      });

      request(app).get("/user/tj").expect("viewing tj", done);
    });

    it("should populate the capture group", function (done) {
      var app = express();

      app.get("/user/:user{/:op}", function (req, res) {
        var op = req.params.op || "view";
        res.end(op + "ing " + req.params.user);
      });

      request(app).get("/user/tj/edit").expect("editing tj", done);
    });
  });

  describe.todo(":name*", function () {
    it("should match one segment", function (done) {
      var app = express();

      app.get("/user/*user", function (req, res) {
        res.end(req.params.user[0]);
      });

      request(app).get("/user/122").expect("122", done);
    });

    it("should match many segments", function (done) {
      var app = express();

      app.get("/user/*user", function (req, res) {
        res.end(req.params.user.join("/"));
      });

      request(app).get("/user/1/2/3/4").expect("1/2/3/4", done);
    });

    it("should match zero segments", function (done) {
      var app = express();

      app.get("/user{/*user}", function (req, res) {
        res.end(req.params.user);
      });

      request(app).get("/user").expect("", done);
    });
  });

  describe.todo(":name+", function () {
    it("should match one segment", function (done) {
      var app = express();

      app.get("/user/*user", function (req, res) {
        res.end(req.params.user[0]);
      });

      request(app).get("/user/122").expect(200, "122", done);
    });

    it("should match many segments", function (done) {
      var app = express();

      app.get("/user/*user", function (req, res) {
        res.end(req.params.user.join("/"));
      });

      request(app).get("/user/1/2/3/4").expect(200, "1/2/3/4", done);
    });

    it("should not match zero segments", function (done) {
      var app = express();

      app.get("/user/*user", function (req, res) {
        res.end(req.params.user);
      });

      request(app).get("/user").expect(404, done);
    });
  });

  describe.todo(".:name", function () {
    it("should denote a format", function (done) {
      var app = express();
      var cb = after(2, done);

      app.get("/:name.:format", function (req, res) {
        res.end(req.params.name + " as " + req.params.format);
      });

      request(app).get("/foo.json").expect(200, "foo as json", cb);

      request(app).get("/foo").expect(404, cb);
    });
  });

  describe.todo(".:name?", function () {
    it("should denote an optional format", function (done) {
      var app = express();
      var cb = after(2, done);

      app.get("/:name{.:format}", function (req, res) {
        res.end(req.params.name + " as " + (req.params.format || "html"));
      });

      request(app).get("/foo").expect(200, "foo as html", cb);

      request(app).get("/foo.json").expect(200, "foo as json", cb);
    });
  });

  describe.todo("when next() is called", function () {
    it("should continue lookup", function (done) {
      var app = express(),
        calls = [];

      app.get("/foo{/:bar}", function (req, res, next) {
        calls.push("/foo/:bar?");
        next();
      });

      app.get("/bar", function () {
        assert(0);
      });

      app.get("/foo", function (req, res, next) {
        calls.push("/foo");
        next();
      });

      app.get("/foo", function (req, res) {
        calls.push("/foo 2");
        res.json(calls);
      });

      request(app).get("/foo").expect(200, ["/foo/:bar?", "/foo", "/foo 2"], done);
    });
  });

  describe('when next("route") is called', function () {
    it("should jump to next route", function (done) {
      var app = express();

      function fn(req, res, next) {
        res.set("X-Hit", "1");
        next("route");
      }

      app.get("/foo", fn, function (req, res) {
        res.end("failure");
      });

      app.get("/foo", function (req, res) {
        res.end("success");
      });

      request(app).get("/foo").expect("X-Hit", "1").expect(200, "success", done);
    });
  });

  describe('when next("router") is called', function () {
    it("should jump out of router", function (done) {
      var app = express();
      var router = express.Router();

      function fn(req, res, next) {
        res.set("X-Hit", "1");
        next("router");
      }

      router.get("/foo", fn, function (req, res) {
        res.end("failure");
      });

      router.get("/foo", function (req, res) {
        res.end("failure");
      });

      app.use(router);

      app.get("/foo", function (req, res) {
        res.end("success");
      });

      request(app).get("/foo").expect("X-Hit", "1").expect(200, "success", done);
    });
  });

  describe("when next(err) is called", function () {
    it.todo("should break out of app.router", function (done) {
      var app = express(),
        calls = [];

      app.get("/foo{/:bar}", function (req, res, next) {
        calls.push("/foo/:bar?");
        next();
      });

      app.get("/bar", function () {
        assert(0);
      });

      app.get("/foo", function (req, res, next) {
        calls.push("/foo");
        next(new Error("fail"));
      });

      app.get("/foo", function () {
        assert(0);
      });

      app.use(function (err, req, res, next) {
        res.json({
          calls: calls,
          error: err.message,
        });
      });

      request(app)
        .get("/foo")
        .expect(200, { calls: ["/foo/:bar?", "/foo"], error: "fail" }, done);
    });

    it("should call handler in same route, if exists", function (done) {
      var app = express();

      function fn1(req, res, next) {
        next(new Error("boom!"));
      }

      function fn2(req, res, next) {
        res.send("foo here");
      }

      function fn3(err, req, res, next) {
        res.send("route go " + err.message);
      }

      app.get("/foo", fn1, fn2, fn3);

      app.use(function (err, req, res, next) {
        res.end("error!");
      });

      request(app).get("/foo").expect("route go boom!", done);
    });
  });

  // TODO: upgrade to express v5
  describe.todo("promise support", function () {
    it("should pass rejected promise value", function (done) {
      var app = express();
      var router = new express.Router();

      router.use(function createError(req, res, next) {
        return Promise.reject(new Error("boom!"));
      });

      router.use(function sawError(err, req, res, next) {
        res.send("saw " + err.name + ": " + err.message);
      });

      app.use(router);

      request(app).get("/").expect(200, "saw Error: boom!", done);
    });

    it("should pass rejected promise without value", function (done) {
      var app = express();
      var router = new express.Router();

      router.use(function createError(req, res, next) {
        return Promise.reject();
      });

      router.use(function sawError(err, req, res, next) {
        res.send("saw " + err.name + ": " + err.message);
      });

      app.use(router);

      request(app).get("/").expect(200, "saw Error: Rejected promise", done);
    });

    it("should ignore resolved promise", function (done) {
      var app = express();
      var router = new express.Router();

      router.use(function createError(req, res, next) {
        res.send("saw GET /foo");
        return Promise.resolve("foo");
      });

      router.use(function () {
        done(new Error("Unexpected middleware invoke"));
      });

      app.use(router);

      request(app).get("/foo").expect(200, "saw GET /foo", done);
    });

    describe("error handling", function () {
      it("should pass rejected promise value", function (done) {
        var app = express();
        var router = new express.Router();

        router.use(function createError(req, res, next) {
          return Promise.reject(new Error("boom!"));
        });

        router.use(function handleError(err, req, res, next) {
          return Promise.reject(new Error("caught: " + err.message));
        });

        router.use(function sawError(err, req, res, next) {
          res.send("saw " + err.name + ": " + err.message);
        });

        app.use(router);

        request(app).get("/").expect(200, "saw Error: caught: boom!", done);
      });

      it("should pass rejected promise without value", function (done) {
        var app = express();
        var router = new express.Router();

        router.use(function createError(req, res, next) {
          return Promise.reject();
        });

        router.use(function handleError(err, req, res, next) {
          return Promise.reject(new Error("caught: " + err.message));
        });

        router.use(function sawError(err, req, res, next) {
          res.send("saw " + err.name + ": " + err.message);
        });

        app.use(router);

        request(app).get("/").expect(200, "saw Error: caught: Rejected promise", done);
      });

      it("should ignore resolved promise", function (done) {
        var app = express();
        var router = new express.Router();

        router.use(function createError(req, res, next) {
          return Promise.reject(new Error("boom!"));
        });

        router.use(function handleError(err, req, res, next) {
          res.send("saw " + err.name + ": " + err.message);
          return Promise.resolve("foo");
        });

        router.use(function () {
          done(new Error("Unexpected middleware invoke"));
        });

        app.use(router);

        request(app).get("/foo").expect(200, "saw Error: boom!", done);
      });
    });
  });

  it("should allow rewriting of the url", function (done) {
    var app = express();

    app.get("/account/edit", function (req, res, next) {
      req.user = { id: 12 }; // faux authenticated user
      req.url = "/user/" + req.user.id + "/edit";
      next();
    });

    app.get("/user/:id/edit", function (req, res) {
      res.send("editing user " + req.params.id);
    });

    request(app).get("/account/edit").expect("editing user 12", done);
  });

  it.todo("should run in order added", function (done) {
    var app = express();
    var path = [];

    app.get("/*path", function (req, res, next) {
      path.push(0);
      next();
    });

    app.get("/user/:id", function (req, res, next) {
      path.push(1);
      next();
    });

    app.use(function (req, res, next) {
      path.push(2);
      next();
    });

    app.all("/user/:id", function (req, res, next) {
      path.push(3);
      next();
    });

    app.get("/*splat", function (req, res, next) {
      path.push(4);
      next();
    });

    app.use(function (req, res, next) {
      path.push(5);
      res.end(path.join(","));
    });

    request(app).get("/user/1").expect(200, "0,1,2,3,4,5", done);
  });

  it("should be chainable", function () {
    var app = express();
    assert.strictEqual(
      app.get("/", function () {}),
      app,
    );
  });

  it("should should not use disposed router/middleware", function (done) {
    // more context: https://github.com/expressjs/express/issues/5743#issuecomment-2277148412

    var app = express();
    var router = new express.Router();

    router.use(function (req, res, next) {
      res.setHeader("old", "foo");
      next();
    });

    app.use(function (req, res, next) {
      return router.handle(req, res, next);
    });

    app.get("/", function (req, res, next) {
      res.send("yee");
      next();
    });

    request(app)
      .get("/")
      .expect("old", "foo")
      .expect(function (res) {
        if (typeof res.headers["new"] !== "undefined") {
          throw new Error("`new` header should not be present");
        }
      })
      .expect(200, "yee", function (err, res) {
        if (err) return done(err);

        router = new express.Router();

        router.use(function (req, res, next) {
          res.setHeader("new", "bar");
          next();
        });

        request(app)
          .get("/")
          .expect("new", "bar")
          .expect(function (res) {
            if (typeof res.headers["old"] !== "undefined") {
              throw new Error("`old` header should not be present");
            }
          })
          .expect(200, "yee", done);
      });
  });
});

function supportsRegexp(source) {
  try {
    new RegExp(source);
    return true;
  } catch (e) {
    return false;
  }
}
