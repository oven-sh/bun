// Goes down the usual roads of node:http, node:events, node:stream and the tick queue, and down many that are unusual: the arms that Bun's own modules mark `"unlikely";`.
import { EventEmitter, once } from "node:events";
import http from "node:http";
import net from "node:net";
import { PassThrough, Readable, Transform, Writable, pipeline } from "node:stream";

const lines = [];
const say = (...parts) => lines.push(parts.join(" "));

const emitter = new EventEmitter();
emitter.on("newListener", (name, listener) => say("newListener", String(name), typeof listener));
emitter.on("removeListener", name => say("removeListener", String(name)));
const first = value => say("first", value);
emitter.on("value", first);
emitter.prependListener("value", value => say("in front", value));
emitter.once("value", value => say("once", value));
say(emitter.emit("value", 1), emitter.emit("value", 2), emitter.emit("nobody"), emitter.listenerCount("value"));
emitter.off("value", first);
emitter.setMaxListeners(1);
say(emitter.getMaxListeners(), emitter.eventNames().map(String).join());
try {
  emitter.emit("error", new RangeError("nobody listens"));
} catch (error) {
  say("thrown", error.name, error.message);
}
try {
  emitter.on("value", 5);
} catch (error) {
  say("thrown", error.code);
}
emitter.removeAllListeners("value");
emitter.removeAllListeners();
say(emitter.eventNames().length);
const waited = once(emitter, "later");
process.nextTick((a, b, c, d, e) => emitter.emit("later", a + b + c + d + e), 1, 2, 3, 4, 5);
say("later", (await waited)[0]);

const order = [];
process.nextTick(() => order.push("tick 1"));
queueMicrotask(() => order.push("microtask"));
process.nextTick(() => {
  order.push("tick 2");
  process.nextTick(() => order.push("tick 3"));
});
setImmediate(() => order.push("immediate"));
await new Promise(resolve => setTimeout(resolve, 5));
say(order.join());

const collected = [];
await new Promise((resolve, reject) =>
  pipeline(
    Readable.from(["a", "b", Buffer.from("c"), "d".repeat(70000)]),
    new Transform({ transform(chunk, encoding, done) { done(null, String(chunk).toUpperCase()); } }),
    new PassThrough({ highWaterMark: 4 }),
    new Writable({ write(chunk, encoding, done) { collected.push(chunk.length); setImmediate(done); }, final(done) { collected.push("final"); done(); } }),
    error => (error ? reject(error) : resolve()),
  ),
);
say(collected.join());
const broken = new Readable({ read() { this.destroy(new TypeError("broken")); } });
broken.on("error", error => say("stream error", error.message)).on("close", () => say("closed", broken.destroyed));
const brokenClosed = new Promise(resolve => broken.on("close", resolve));
broken.resume();
await brokenClosed;
const objects = new Readable({ objectMode: true, read() {} });
objects.push({ n: 1 });
objects.push(null);
for await (const object of objects) say("object", object.n);
const paused = Readable.from(["x", "y"]);
paused.setEncoding("utf8");
paused.pause();
say(paused.isPaused(), paused.readableFlowing, paused.read());

const server = http.createServer((request, response) => {
  const url = request.url;
  if (url === "/text") return response.end("hello");
  if (url === "/head") return response.writeHead(200, "Fine", { "content-type": "text/plain", "x-list": ["a", "b"] }).end("body");
  if (url === "/chunks") {
    response.setHeader("x-set", "1");
    response.write("one,");
    response.write(Buffer.from("two,"));
    return setImmediate(() => response.end("three"));
  }
  if (url === "/echo") {
    const parts = [];
    request.on("data", part => parts.push(part)).on("end", () => {
      response.statusCode = 201;
      response.setHeader("content-type", request.headers["content-type"] ?? "none");
      response.end(Buffer.concat(parts));
    });
    return;
  }
  if (url === "/pipe") return request.pipe(response);
  if (url === "/stream") return Readable.from(["s1", "s2", "s3"]).pipe(response);
  if (url === "/headers") {
    response.setHeader("X-Mixed", "Case");
    response.appendHeader("x-mixed", "again");
    response.removeHeader("date");
    const seen = [response.hasHeader("x-mixed"), response.getHeader("X-MIXED"), response.getHeaderNames().join(), response.headersSent];
    response.flushHeaders();
    return response.end(JSON.stringify([...seen, response.headersSent, request.method, request.httpVersion, request.rawHeaders.length % 2]));
  }
  if (url === "/twice") {
    response.on("error", error => say("response error", error.code));
    response.end("once");
    response.end("twice");
    try {
      response.setHeader("x-late", "1");
    } catch (error) {
      say("late header", error.code);
    }
    return;
  }
  if (url === "/invalid") {
    try {
      response.setHeader("x bad", "1");
    } catch (error) {
      say("bad name", error.code);
    }
    try {
      response.setHeader("x-bad", "a\nb");
    } catch (error) {
      say("bad value", error.code);
    }
    return response.writeHead(204).end();
  }
  if (url === "/destroy") return response.destroy();
  if (url === "/trailers") {
    response.writeHead(200, { trailer: "x-end" });
    response.write("with");
    response.addTrailers({ "x-end": "done" });
    return response.end();
  }
  response.statusCode = 404;
  response.end();
});
server.on("clientError", (error, socket) => {
  say("client error", error.code);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address();
const at = path => `http://127.0.0.1:${port}${path}`;

for (let turn = 0; turn < 40; turn++) await (await fetch(at("/text"))).text();
for (const [path, options] of [
  ["/text"], ["/head"], ["/head", { method: "HEAD" }], ["/chunks"], ["/stream"], ["/headers"], ["/twice"], ["/invalid"], ["/trailers"], ["/missing"],
  ["/echo", { method: "POST", body: "x".repeat(10), headers: { "content-type": "text/x" } }],
  ["/echo", { method: "POST", body: "y".repeat(200000) }],
  ["/echo", { method: "PUT", body: "" }],
  ["/pipe", { method: "POST", body: "piped" }],
  ["/text", { headers: { connection: "close" } }],
]) {
  const answer = await fetch(at(path), options);
  const body = await answer.text();
  say(options?.method ?? "GET", path, answer.status, answer.statusText, answer.headers.get("content-type"), answer.headers.get("x-list"), answer.headers.get("x-mixed"), body.length > 40 ? body.length : body);
}
try {
  await fetch(at("/destroy"));
  say("answered");
} catch {
  say("the connection was closed");
}

const asked = http.request({ port, host: "127.0.0.1", path: "/echo", method: "POST", headers: { expect: "100-continue", "content-type": "a/b" } });
asked.on("continue", () => {
  say("continue");
  asked.end("after continue");
});
const [answer] = await once(asked, "response");
answer.setEncoding("utf8");
let text = "";
for await (const part of answer) text += part;
say(answer.statusCode, answer.headers["content-type"], text);

const raw = net.connect(port, "127.0.0.1");
raw.write("GET /text HTTP/1.1\r\nHost: a\r\n\r\nGET /missing HTTP/1.0\r\n\r\n");
let rawText = "";
raw.setEncoding("latin1").on("data", part => (rawText += part));
await once(raw, "close");
say(rawText.split("\r\n").filter(line => line.startsWith("HTTP/")).join());
const bad = net.connect(port, "127.0.0.1");
bad.write("NOT A REQUEST\r\n\r\n");
bad.resume();
await once(bad, "close");

server.close();
await once(server, "close");
say("listening", server.listening);
console.log(lines.join("\n"));
