// The CONNECT proxy from Node's docs for the 'connect' event: net.connect() and two pipes.
// The upstream stalls and then closes, the client gives up, and the proxy calls server.close().
// The process has to exit on its own.
"use strict";
const http = require("node:http");
const net = require("node:net");

const result = {};
let client;

// An upstream that does not read.
const upstreamSocket = Promise.withResolvers();
const upstream = net.createServer(socket => {
  upstreamSocket.resolve(socket.pause().on("error", () => {}));
});

const proxy = http.createServer();
proxy.on("connect", (req, clientSocket, head) => {
  const { port, hostname } = new URL(`http://${req.url}`);
  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });
  clientSocket.on("error", () => {});
  serverSocket.on("error", () => {});
  // pipe() pauses the client's socket because the upstream doesn't read. Then the upstream closes.
  clientSocket.once("pause", async () => {
    (await upstreamSocket.promise).destroy();
    upstream.close();
  });
  serverSocket.on("close", () => {
    // pipe() doesn't resume the socket it paused.
    result.clientSocketIsPaused = clientSocket.isPaused();
    client.on("close", () => proxy.close(() => (result.proxy = "close")));
    client.destroy();
  });
});

upstream.listen(0, "127.0.0.1", () => {
  proxy.listen(0, "127.0.0.1", () => {
    client = net.connect(proxy.address().port, "127.0.0.1", () => {
      client.write(`CONNECT 127.0.0.1:${upstream.address().port} HTTP/1.1\r\nHost: a\r\n\r\n`);
      // More than the kernel buffers between the proxy and the upstream can hold.
      client.write(Buffer.alloc(32 * 1024 * 1024, "x"));
    });
    client.on("error", () => {});
    client.resume();
  });
});

process.on("exit", () => console.log(JSON.stringify(result)));
