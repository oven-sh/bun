"use strict";

var express = require("express");
var request = require("supertest");
var utils = require("./support/utils");

describe("res", function () {
  describe(".redirect(url)", function () {
    it("should default to a 302 redirect", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("http://google.com");
      });

      request(app).get("/").expect("location", "http://google.com").expect(302, done);
    });

    it('should encode "url"', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("https://google.com?q=\u2603 §10");
      });

      request(app).get("/").expect("Location", "https://google.com?q=%E2%98%83%20%C2%A710").expect(302, done);
    });

    it('should not touch already-encoded sequences in "url"', function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("https://google.com?q=%A710");
      });

      request(app).get("/").expect("Location", "https://google.com?q=%A710").expect(302, done);
    });
  });

  describe(".redirect(status, url)", function () {
    it("should set the response status", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect(303, "http://google.com");
      });

      request(app).get("/").expect("Location", "http://google.com").expect(303, done);
    });
  });

  describe("when the request method is HEAD", function () {
    it("should ignore the body", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("http://google.com");
      });

      request(app)
        .head("/")
        .expect(302)
        .expect("Location", "http://google.com")
        .expect(utils.shouldNotHaveBody())
        .end(done);
    });
  });

  describe("when accepting html", function () {
    it.todo("should respond with html", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("http://google.com");
      });

      request(app)
        .get("/")
        .set("Accept", "text/html")
        .expect("Content-Type", /html/)
        .expect("Location", "http://google.com")
        .expect(302, "<p>Found. Redirecting to http://google.com</p>", done);
    });

    it.todo("should escape the url", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("<la'me>");
      });

      request(app)
        .get("/")
        .set("Host", "http://example.com")
        .set("Accept", "text/html")
        .expect("Content-Type", /html/)
        .expect("Location", "%3Cla'me%3E")
        .expect(302, "<p>Found. Redirecting to %3Cla&#39;me%3E</p>", done);
    });

    it.todo("should not render evil javascript links in anchor href (prevent XSS)", function (done) {
      var app = express();
      var xss = "javascript:eval(document.body.innerHTML=`<p>XSS</p>`);";
      var encodedXss = "javascript:eval(document.body.innerHTML=%60%3Cp%3EXSS%3C/p%3E%60);";

      app.use(function (req, res) {
        res.redirect(xss);
      });

      request(app)
        .get("/")
        .set("Host", "http://example.com")
        .set("Accept", "text/html")
        .expect("Content-Type", /html/)
        .expect("Location", encodedXss)
        .expect(302, "<p>Found. Redirecting to " + encodedXss + "</p>", done);
    });

    it.todo("should include the redirect type", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect(301, "http://google.com");
      });

      request(app)
        .get("/")
        .set("Accept", "text/html")
        .expect("Content-Type", /html/)
        .expect("Location", "http://google.com")
        .expect(301, "<p>Moved Permanently. Redirecting to http://google.com</p>", done);
    });
  });

  describe("when accepting text", function () {
    it("should respond with text", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("http://google.com");
      });

      request(app)
        .get("/")
        .set("Accept", "text/plain, */*")
        .expect("Content-Type", /plain/)
        .expect("Location", "http://google.com")
        .expect(302, "Found. Redirecting to http://google.com", done);
    });

    it("should encode the url", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect('http://example.com/?param=<script>alert("hax");</script>');
      });

      request(app)
        .get("/")
        .set("Host", "http://example.com")
        .set("Accept", "text/plain, */*")
        .expect("Content-Type", /plain/)
        .expect("Location", "http://example.com/?param=%3Cscript%3Ealert(%22hax%22);%3C/script%3E")
        .expect(
          302,
          "Found. Redirecting to http://example.com/?param=%3Cscript%3Ealert(%22hax%22);%3C/script%3E",
          done,
        );
    });

    it("should include the redirect type", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect(301, "http://google.com");
      });

      request(app)
        .get("/")
        .set("Accept", "text/plain, */*")
        .expect("Content-Type", /plain/)
        .expect("Location", "http://google.com")
        .expect(301, "Moved Permanently. Redirecting to http://google.com", done);
    });
  });

  describe("when accepting neither text or html", function () {
    it("should respond with an empty body", function (done) {
      var app = express();

      app.use(function (req, res) {
        res.redirect("http://google.com");
      });

      request(app)
        .get("/")
        .set("Accept", "application/octet-stream")
        .expect(302)
        .expect("location", "http://google.com")
        .expect("content-length", "0")
        .expect(utils.shouldNotHaveHeader("Content-Type"))
        .expect(utils.shouldNotHaveBody())
        .end(done);
    });
  });
});
