class Fake extends EventTarget {
  constructor() {
    super();
    throw new Error("builtin used a replaced global");
  }
}
for (const name of ["MessagePort", "MessageChannel", "BroadcastChannel", "Worker", "Blob", "AbortController", "TextDecoder", "Headers"]) {
  globalThis[name] = Fake;
}
for (const name of ["URLSearchParams", "WebSocket", "Performance", "PerformanceEntry", "PerformanceObserver", "PerformanceResourceTiming"]) {
  globalThis[name] = Fake;
}
// Deleting a global reifies the whole static table; intrinsics must still resolve after that.
delete globalThis.URL;
delete globalThis.Event;
globalThis.crypto = { randomUUID: () => "fake" };

for (const [mod, names] of Object.entries({
  "node:url": ["URL", "URLSearchParams"],
  "node:http": ["WebSocket"],
  "node:perf_hooks": ["Performance", "PerformanceEntry", "PerformanceResourceTiming"],
  "node:worker_threads": ["MessagePort", "MessageChannel", "BroadcastChannel"],
})) {
  for (const name of names) {
    const value = require(mod)[name];
    if (typeof value !== "function" || value === Fake) throw new Error(mod + " exported a replaced " + name);
  }
}
if (!(require("node:perf_hooks").performance instanceof require("node:perf_hooks").Performance)) throw new Error("perf_hooks.Performance is not the intrinsic");
new (require("node:perf_hooks").PerformanceObserver)(() => {}).disconnect();
if (new (require("node:url").URL)("http://a/b").pathname !== "/b") throw new Error("url.URL is not the intrinsic");

const wt = require("node:worker_threads");
if (typeof wt.MessagePort.prototype.on !== "function") throw new Error("MessagePort.prototype.on missing");
const { port1, port2 } = new wt.MessageChannel();
port1.close();
port2.close();
const worker = new wt.Worker("require('node:worker_threads').parentPort.postMessage('hi')", { eval: true });
const [message] = await require("node:events").once(worker, "message");
if (message !== "hi") throw new Error("worker message: " + message);
await worker.terminate();

if (require("node:crypto").randomUUID() === "fake") throw new Error("node:crypto used a replaced globalThis.crypto");

const { Readable } = require("node:stream");
const text = await require("node:stream/consumers").text(Readable.from([Buffer.from("abc")]));
if (text !== "abc") throw new Error("stream/consumers text: " + text);

const http = require("node:http");
const server = http.createServer((req, res) => res.end("ok")).listen(0);
await require("node:events").once(server, "listening");
const body = await new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${server.address().port}/`, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => (data += chunk));
    res.on("end", () => resolve(data));
  }).on("error", reject);
});
server.close();
if (body !== "ok") throw new Error("http body: " + body);

console.log("ok");
