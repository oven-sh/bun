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

const a = new Response(async function* () {
  yield new Uint8Array([50, 60, 70]);
  yield "hey";
  await Bun.sleep(500);
});

const b_generator = async function* () {
  await Bun.sleep(500);
  yield new Uint8Array([1, 2, 3]);
  yield "it works!";
};

const b = new Response(b_generator());

for (const r of await Promise.all([a.text(), b.text()])) console.log(r);
