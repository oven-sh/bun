// Sends header blocks on every path of node:http2 that sends one, and prints the names that the
// receiver lists under http2.sensitiveHeaders. Run under Node.js and under Bun: the output must be
// identical.
const http2 = require("node:http2");
const fs = require("node:fs");
const { once } = require("node:events");

const sensitive = http2.sensitiveHeaders;
const x19 = Buffer.alloc(19, "x").toString();
const x20 = Buffer.alloc(20, "x").toString();

// Every error of a server, a session or a stream ends the run.
const failure = Promise.withResolvers();
const settled = promise => Promise.race([promise, failure.promise]);

async function listening(onStream) {
  const server = http2.createServer();
  server.on("error", failure.reject);
  server.on("stream", (stream, headers) => {
    stream.on("error", failure.reject);
    onStream(stream, headers);
  });
  await settled(once(server.listen(0, "127.0.0.1"), "listening"));
  const client = http2.connect(`http://127.0.0.1:${server.address().port}`);
  client.on("error", failure.reject);
  return { server, client };
}

// Listed names of every kind, and a cookie that is not listed: its short value is marked, its long one is not.
async function everySendPath() {
  // The array-index names come first and ascend: an object lists its own keys in that order.
  const names = ["0", "123", "4294967294", "007", "4294967295", "99999999999999999999", "__proto__", "abc"];
  // Object.fromEntries makes "__proto__" an own property, like the other names.
  const block = (pseudo = {}) =>
    Object.assign(
      Object.fromEntries([...Object.entries(pseudo), ...names.map(name => [name, "v"]), ["cookie", ["c=1", x20]]]),
      { [sensitive]: [...names] },
    );
  const rawBlock = (...pseudo) =>
    Object.assign([...pseudo, ...names.flatMap(name => [name, "v"]), "cookie", "c=1", "cookie", x20], {
      [sensitive]: [...names],
    });

  const seen = {};
  const pushed = Promise.withResolvers();
  const fd = fs.openSync(__filename, "r");
  const { server, client } = await listening((stream, headers) => {
    const path = headers[":path"];
    switch (path) {
      case "/request-queued":
      case "/request":
      case "/request-raw":
        seen[path] = headers[sensitive];
        break;
      case "/respond":
        stream.respond(block({ ":status": 200 }));
        return stream.end();
      case "/respond-raw":
        stream.respond(rawBlock(":status", "200"));
        return stream.end();
      case "/respondWithFD":
        return stream.respondWithFD(fd, block({ ":status": 200 }), { length: 1 });
      case "/additionalHeaders":
        stream.additionalHeaders(block({ ":status": 103 }));
        break;
      case "/pushStream":
        stream.pushStream(block({ ":path": "/pushed" }), (err, push) => {
          if (err) return failure.reject(err);
          push.on("error", failure.reject);
          push.respond({ ":status": 200 });
          push.end();
        });
        break;
      case "/sendTrailers-server":
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers(block()));
        return stream.end();
      case "/sendTrailers-client":
        // The response waits for the trailers of the request.
        stream.on("trailers", trailers => {
          seen[path] = trailers[sensitive];
          stream.respond({ ":status": 200 });
          stream.end();
        });
        return stream.resume();
    }
    stream.respond({ ":status": 200 });
    stream.end();
  });
  client.on("stream", (stream, headers) => {
    stream.on("error", failure.reject);
    stream.resume();
    pushed.resolve(headers[sensitive]);
  });

  // The sensitive names of each header block that the request receives.
  const roundTrip = async (headers, options) => {
    const req = client.request(headers, options);
    req.on("error", failure.reject);
    const received = {};
    req.on("headers", info => (received.headers = info[sensitive]));
    req.on("response", response => (received.response = response[sensitive]));
    req.on("trailers", trailers => (received.trailers = trailers[sensitive]));
    if (options?.waitForTrailers) req.on("wantTrailers", () => req.sendTrailers(block()));
    req.resume();
    req.end();
    await settled(once(req, "close"));
    return received;
  };

  // The session has not connected yet, so this request waits in a queue. It keeps the names that
  // the list had when request() was called.
  const queued = block({ ":path": "/request-queued" });
  const queuedRoundTrip = roundTrip(queued);
  queued[sensitive].length = 0;
  await queuedRoundTrip;
  await roundTrip(block({ ":path": "/request" }));
  await roundTrip(rawBlock(":path", "/request-raw"));
  seen["/respond"] = (await roundTrip({ ":path": "/respond" })).response;
  seen["/respond-raw"] = (await roundTrip({ ":path": "/respond-raw" })).response;
  seen["/respondWithFD"] = (await roundTrip({ ":path": "/respondWithFD" })).response;
  seen["/additionalHeaders"] = (await roundTrip({ ":path": "/additionalHeaders" })).headers;
  await roundTrip({ ":path": "/pushStream" });
  seen["/pushStream"] = await settled(pushed.promise);
  seen["/sendTrailers-server"] = (await roundTrip({ ":path": "/sendTrailers-server" })).trailers;
  await roundTrip({ ":method": "POST", ":path": "/sendTrailers-client" }, { waitForTrailers: true });

  client.close();
  server.close();
  fs.closeSync(fd);
  for (const [path, label] of [
    ["/request-queued", "request() before the session connects"],
    ["/request", "request()"],
    ["/request-raw", "request() with a raw list"],
    ["/respond", "respond()"],
    ["/respond-raw", "respond() with a raw list"],
    ["/respondWithFD", "respondWithFD()"],
    ["/additionalHeaders", "additionalHeaders()"],
    ["/pushStream", "pushStream()"],
    ["/sendTrailers-server", "sendTrailers() of a server"],
    ["/sendTrailers-client", "sendTrailers() of a client"],
  ]) {
    console.log(`${label}: ${JSON.stringify(seen[path])}`);
  }
}

// Each row is a request: fields beside ":path", or a raw list. The server answers with the names it lists.
async function rules() {
  // Decoded from UTF-16, a text keeps 16-bit characters, also where each one fits in 8 bits.
  const wide = text => new TextDecoder("utf-16le").decode(Buffer.from(text, "utf16le"));
  const wideName = wide("x-wide");
  if (process.versions.bun && !require("bun:jsc").jscDescribe(wideName).includes("8Bit:(0)")) {
    throw new Error("the listed name is not a 16-bit string");
  }
  // A hole is no name: `map` skips it in Node.
  const holey = ["x-a"];
  holey[2] = "x-b";
  const fractional = new Proxy(["x-a"], { get: (target, key) => (key === "length" ? 1.5 : target[key]) });
  const rows = [
    ["no list, no such field", { "x-a": "1" }],
    ["authorization", { authorization: "Bearer t" }],
    ["Authorization", { Authorization: "Bearer t" }],
    ["proxy-authorization", { "proxy-authorization": "Basic t" }],
    ["set-cookie, 3 code units", { "set-cookie": "a=1" }],
    ["cookie, 3 code units", { cookie: "a=1" }],
    ["Cookie, 3 code units", { Cookie: "a=1" }],
    ["cookie, 19 code units", { cookie: x19 }],
    ["cookie, 20 code units", { cookie: x20 }],
    ["cookie, 10 code units above U+00FF", { cookie: "\u0141".repeat(10) }],
    ["cookie, 19 code units above U+007F", { cookie: "\u00e9".repeat(19) }],
    ["cookie, 20 code units above U+007F", { cookie: "\u00e9".repeat(20) }],
    ["cookie, the number 5", { cookie: 5 }],
    ["cookie, an array of one short value", { cookie: ["c=1"] }],
    ["cookie, an array of two short values", { cookie: ["c=1", "d=2"] }],
    ["cookie, an array of a short and a long value", { cookie: ["c=1", x20] }],
    ["authorization and a cookie array of two short values", { authorization: "Bearer t", cookie: ["c=1", "d=2"] }],
    ["cookie short, Cookie long", { cookie: "a=1", Cookie: x20 }],
    ["Cookie long, cookie short", { Cookie: x20, cookie: "a=1" }],
    ["a raw list: cookie short, cookie short", [":path", "/", "cookie", "a=1", "cookie", "b=2"]],
    ["a raw list: Cookie short, cookie long", [":path", "/", "Cookie", "a=1", "cookie", x20]],
    ["COOKIE listed: cookie, 20 code units", { cookie: x20, [sensitive]: ["COOKIE"] }],
    [
      "x-LISTED listed: X-Listed, x-listed-not, x-liste",
      { "X-Listed": "1", "x-listed-not": "2", "x-liste": "3", [sensitive]: ["x-LISTED"] },
    ],
    ["an empty list", { "x-a": "1", [sensitive]: [] }],
    ["a listed name that is not sent", { "x-a": "1", [sensitive]: ["x-b"] }],
    ["a list with a hole: x-a, x-b, undefined", { "x-a": "1", "x-b": "2", undefined: "3", [sensitive]: holey }],
    [
      "a list behind a Proxy with the length 1.5: x-a, undefined",
      { "x-a": "1", undefined: "3", [sensitive]: fractional },
    ],
    [
      "no list: 0, 123, constructor, tostring, valueof, hasownproperty",
      { 0: "1", 123: "2", constructor: "3", tostring: "4", valueof: "5", hasownproperty: "6" },
    ],
    ["a 16-bit name listed: x-wide, x-wide-not", { "x-wide": "1", "x-wide-not": "2", [sensitive]: [wideName] }],
    ["a 16-bit name in upper case listed: x-wide", { "x-wide": "1", [sensitive]: [wide("X-WIDE")] }],
    ["a name with the Kelvin sign for its k listed: key", { key: "1", [sensitive]: ["\u212Aey"] }],
  ];

  const { server, client } = await listening((stream, headers) => {
    stream.respond({ ":status": 200 });
    stream.end(JSON.stringify(headers[sensitive]));
  });
  for (const [label, headers] of rows) {
    const req = client.request(Array.isArray(headers) ? headers : { ":path": "/", ...headers });
    req.on("error", failure.reject);
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => (body += chunk));
    req.end();
    await settled(once(req, "close"));
    console.log(`${label}: ${body}`);
  }
  client.close();
  server.close();
}

// A property of Object.prototype that has the name of a listed header does not change the answer.
async function objectPrototype() {
  const { server, client } = await listening((stream, headers) => {
    stream.respond({ ":status": 200 });
    stream.end(JSON.stringify(headers[sensitive]));
  });
  await settled(once(client, "connect"));

  let req;
  Object.defineProperty(Object.prototype, "x-sensitive-setter", { set() {}, configurable: true });
  Object.defineProperty(Object.prototype, "x-sensitive-frozen", { value: 1, writable: false, configurable: true });
  try {
    req = client.request({
      ":path": "/",
      "x-sensitive-setter": "1",
      "x-sensitive-frozen": "2",
      [sensitive]: ["x-sensitive-setter", "x-sensitive-frozen"],
    });
  } finally {
    delete Object.prototype["x-sensitive-setter"];
    delete Object.prototype["x-sensitive-frozen"];
  }
  req.on("error", failure.reject);
  let body = "";
  req.setEncoding("utf8");
  req.on("data", chunk => (body += chunk));
  req.end();
  await settled(once(req, "close"));
  console.log(`a setter and a read-only property on Object.prototype: ${body}`);
  client.close();
  server.close();
}

(async () => {
  console.log("# every send path");
  await everySendPath();
  console.log("# the rules");
  await rules();
  console.log("# Object.prototype");
  await objectPrototype();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
