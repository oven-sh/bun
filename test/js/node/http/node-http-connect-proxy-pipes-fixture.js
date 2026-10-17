// The CONNECT proxy of the Node.js documentation for the 'connect' event: net.connect() and two
// pipes. Its upstream is slow and then goes away, its client gives up, and then it shuts down the
// graceful way: server.close(), no process.exit(). The process must exit by itself.
"use strict";
const http = require("node:http");
const net = require("node:net");

const result = {};
let client;

// An upstream that does not read.
let upstreamSocket;
const upstream = net.createServer(socket => {
  upstreamSocket = socket.pause().on("error", () => {});
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
  // pipe() pauses the client's socket because the upstream is slow. Then the upstream goes away.
  clientSocket.once("pause", () => {
    upstreamSocket.destroy();
    upstream.close();
  });
  serverSocket.on("close", () => {
    // pipe() does not resume the socket that it paused.
    result.clientSocketIsPaused = clientSocket.isPaused();
    client.on("close", () => proxy.close(() => (result.proxy = "close")));
    client.destroy();
  });
});

upstream.listen(0, "127.0.0.1", () => {
  proxy.listen(0, "127.0.0.1", () => {
    client = net.connect(proxy.address().port, "127.0.0.1", () => {
      client.write(`CONNECT 127.0.0.1:${upstream.address().port} HTTP/1.1\r\nHost: a\r\n\r\n`);
      // More than the kernel buffers between the proxy and the upstream take.
      client.write(Buffer.alloc(32 * 1024 * 1024, "x"));
    });
    client.on("error", () => {});
    client.resume();
  });
});

process.on("exit", () => console.log(JSON.stringify(result)));
