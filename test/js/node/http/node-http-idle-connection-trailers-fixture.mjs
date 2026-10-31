// A node:http server for the tests of what a connection keeps of a request trailer section.
// It prints {"port": n}. GET /rss collects garbage and answers with the RSS in bytes.
import { once } from "node:events";
import http from "node:http";
import { pipeline, Writable } from "node:stream";

// stream.pipeline() destroys the request at its first chunk, and the connection lives on.
function destroyWithPipeline(req, done) {
  const failing = new Writable({
    write(chunk, encoding, callback) {
      callback(new Error("stop"));
    },
  });
  pipeline(req, failing, done);
}

const server = http.createServer({ maxHeaderSize: 4 * 1024 * 1024 }, (req, res) => {
  switch (req.url) {
    case "/rss":
      Bun.gc(true);
      res.end(String(process.memoryUsage.rss()));
      break;
    case "/done":
      // The server parses this request only after the whole message before it.
      res.end("done");
      break;
    case "/read":
      req.resume().on("end", () => res.end("done"));
      break;
    case "/trailers":
      res.setHeader("Connection", "close");
      req.resume().on("end", () => res.end(JSON.stringify(req.rawTrailers)));
      break;
    case "/destroyed":
      destroyWithPipeline(req, () => res.end("ok"));
      break;
    case "/cut":
      // The response is still in flight when the peer's FIN cuts the body.
      req.on("error", () => {});
      req.resume();
      break;
  }
});
// With a response in flight, the peer's FIN does not close the connection.
server.httpAllowHalfOpen = true;
// For a request that fails to parse. It keeps the socket.
server.on("clientError", (err, socket) => {
  socket.write("HTTP/1.1 400 Bad Request\r\nContent-Length: 4\r\n\r\ndone");
});
// It answers when the peer's FIN cut the body of the request, and keeps the tunnel. Bun leaves
// that tunnel open for writes. Node.js ends the connection there.
server.on("upgrade", (req, socket) => {
  if (req.url === "/destroyed") {
    destroyWithPipeline(req, () => {});
  } else {
    req.on("error", () => {});
    req.resume();
  }
  socket.on("error", () => {});
  socket.on("end", () => socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\ndone"));
  socket.resume();
});
server.keepAliveTimeout = 0;
await once(server.listen(0, "127.0.0.1"), "listening");
console.log(JSON.stringify({ port: server.address().port }));
