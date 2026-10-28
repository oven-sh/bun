// A server's request path without the server: ES5 constructors that call each other, one pair of objects a request,
// both linked to application-level prototypes, a chain of handlers called through `next`, names stored along the way.
// VARIANT (first argument): words joined by "-": relinked, declared, hidden (both objects pass through code that no build sees), indirect (that code calls the handlers). "plain" is none of them.
var variant = process.argv[2] || "relinked";
var relinks = variant.indexOf("relinked") >= 0;
var declares = variant.indexOf("declared") >= 0;
// The text comes from outside, so no build can read it.
var hide = variant.indexOf("hidden") >= 0 ? new Function("x", process.env.HIDE_BODY || "return x") : function (x) { return x; };
var invoke = variant.indexOf("indirect") >= 0 ? new Function("f", "a", "b", "c", process.env.INVOKE_BODY || "return f(a, b, c)") : function (f, a, b, c) { return f(a, b, c); };

function Emitter() {
  this._events = undefined;
  this._count = 0;
}
Emitter.prototype.on = function (name, listener) {
  if (!this._events) this._events = Object.create(null);
  this._events[name] = listener;
  this._count++;
  return this;
};
Emitter.prototype.emit = function (name, value) {
  var listener = this._events && this._events[name];
  if (listener) listener.call(this, value);
  return !!listener;
};

function Incoming(url, method, headers) {
  Emitter.call(this);
  this.url = url;
  this.method = method;
  this.headers = headers;
  this.complete = false;
  if (declares) {
    this.res = undefined;
    this.next = undefined;
    this.baseUrl = undefined;
    this.originalUrl = undefined;
    this.params = undefined;
    this.query = undefined;
    this.route = undefined;
  }
}
Object.setPrototypeOf(Incoming.prototype, Emitter.prototype);
Incoming.prototype.header = function (name) {
  return this.headers[name];
};

function Outgoing(req) {
  Emitter.call(this);
  this.req = req;
  this.statusCode = 200;
  this.finished = false;
  this._headers = Object.create(null);
  this._body = "";
  if (declares) {
    this.locals = undefined;
    this.sent = undefined;
  }
}
Object.setPrototypeOf(Outgoing.prototype, Emitter.prototype);
Outgoing.prototype.setHeader = function (name, value) {
  this._headers[name] = value;
};
Outgoing.prototype.getHeader = function (name) {
  return this._headers[name];
};
Outgoing.prototype.end = function (body) {
  this._body = body;
  this.finished = true;
  this.emit("finish", body.length);
};

var request = relinks ? Object.create(Incoming.prototype) : Incoming.prototype;
request.get = function (name) {
  return this.header(name.toLowerCase());
};
request.path = function () {
  var mark = this.url.indexOf("?");
  return mark < 0 ? this.url : this.url.slice(0, mark);
};
var response = relinks ? Object.create(Outgoing.prototype) : Outgoing.prototype;
response.status = function (code) {
  this.statusCode = code;
  return this;
};
response.set = function (name, value) {
  this.setHeader(name, value);
  return this;
};
response.send = function (body) {
  if (!this.getHeader("content-type")) this.set("content-type", "text/html");
  this.set("content-length", body.length);
  this.sent = true;
  this.end(body);
  return this;
};

function createApplication() {
  var app = { stack: [], request: undefined, response: undefined };
  app.request = relinks ? Object.create(request) : request;
  app.response = relinks ? Object.create(response) : response;
  app.use = function (handler) {
    app.stack.push({ handle: handler, name: handler.name });
  };
  app.handle = function (req, res, done) {
    var index = 0;
    req.baseUrl = "";
    req.originalUrl = req.url;
    function next(error) {
      if (error) return done(error);
      var layer = app.stack[index++];
      if (!layer) return done();
      invoke(layer.handle, req, res, next);
    }
    req.next = next;
    next();
  };
  return app;
}

var app = createApplication();
app.use(function init(req, res, next) {
  res.setHeader("x-powered-by", "nobody");
  req.res = res;
  if (relinks) {
    Object.setPrototypeOf(req, app.request);
    Object.setPrototypeOf(res, app.response);
  }
  res.locals = res.locals || Object.create(null);
  next();
});
app.use(function query(req, res, next) {
  if (!req.query) req.query = req.url.indexOf("?") < 0 ? {} : { raw: req.url };
  next();
});
app.use(function route(req, res, next) {
  if (req.method !== "GET" || req.path() !== "/text") return next();
  req.params = {};
  req.route = "/text";
  res.status(200).set("x-host", req.get("Host")).send("Hello, World!");
});

var input = JSON.parse('{"url":"/text","method":"GET","headers":{"host":"localhost","accept":"*/*"},"rounds":300000}');
var total = 0;
function finished(length) {
  total += length;
}
for (var i = 0; i < input.rounds; i++) {
  var req = hide(new Incoming(input.url, input.method, input.headers));
  var res = hide(new Outgoing(req));
  res.on("finish", finished);
  app.handle(req, res, function (error) {
    total -= 1;
  });
  if (res.statusCode !== 200 || !res.sent) total -= 1000;
}
console.log(variant, total);
