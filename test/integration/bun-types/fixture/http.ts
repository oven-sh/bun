import * as http from "http";

const server = new http.Server({});
server.address;
server.close();
server.eventNames;
server.getMaxListeners();
server.listeners;
server.on;
server.once;
server.prependListener;
server.prependOnceListener;
server.rawListeners;
server.removeAllListeners;
server.removeListener;
server.setMaxListeners;
server;
const agent = new http.Agent({});

http.globalAgent;
http.maxHeaderSize;
console.log(Object.getOwnPropertyNames(agent));

const req = http.request({ host: "localhost", port: 3000, method: "GET" });
req.abort;
req.end();
export {};

// URLSearchParams should be iterable
const sp = new URLSearchParams("q=foo&bar=baz");
for (const q of sp) {
  console.log(q);
}

fetch("https://example.com", {
  s3: {
    accessKeyId: "123",
    secretAccessKey: "456",
  },
  proxy: "cool",
});
