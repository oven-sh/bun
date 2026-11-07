process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const net = require("net");
const { Readable } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();
const encoder = new TextEncoder();
let failed = false;

// Answers a request when its chunked body ends.
const server = net.createServer(socket => {
  let received = "";
  socket.on("data", data => {
    received += data.toString("latin1");
    const headersEnd = received.indexOf("\r\n\r\n");
    if (headersEnd !== -1 && received.slice(headersEnd + 2).endsWith("\r\n0\r\n\r\n")) {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
    }
  });
});

// Each uploads the chunks of an async generator as a fetch() request body.
const init = body => ({ method: "POST", body, duplex: "half" });
const uploads = {
  "an async generator": (url, generator) => fetch(url, init(generator)),
  "an async iterable": (url, generator) => fetch(url, init({ [Symbol.asyncIterator]: () => generator })),
  "a node Readable": (url, generator) => fetch(url, init(Readable.from(generator))),
  "new Response(generator).body": (url, generator) => fetch(url, init(new Response(generator).body)),
  "new Request(url, { body: generator })": (url, generator) => fetch(new Request(url, init(generator))),
};

server.listen(0, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${server.address().port}`;

  // The uploads run at the same time, each in its own store.
  await Promise.all(
    Object.entries(uploads).map(([name, upload]) =>
      asyncLocalStorage.run({ test: name }, async () => {
        const check = where => {
          if (asyncLocalStorage.getStore()?.test !== name) {
            console.error(`FAIL: fetch body from ${name} lost context ${where}`);
            failed = true;
          }
        };
        async function* generator() {
          try {
            for (let i = 0; i < 2; i++) {
              check(`before the await of chunk ${i}`);
              await new Promise(resolve => setImmediate(resolve));
              check(`after the await of chunk ${i}`);
              yield encoder.encode("chunk");
            }
          } finally {
            check("in finally");
          }
        }
        const response = await upload(url, generator());
        if ((await response.text()) !== "ok") {
          console.error(`FAIL: fetch body from ${name} got no response`);
          failed = true;
        }
      }),
    ),
  );

  server.close();
  process.exit(failed ? 1 : 0);
});
