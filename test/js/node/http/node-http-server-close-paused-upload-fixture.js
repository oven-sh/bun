// Runs under Bun and under Node: `<runtime> <this file> <shape> <http|https>`, with the key and certificate in TLS_KEY and TLS_CERT.
// The client is the parent process. It sends half of a request body and stays connected.
const http = require("node:http");
const https = require("node:https");
const [shape, protocol] = process.argv.slice(2);

function whenReadsStopped(req, callback) {
  // A push() that fills the buffer stops the reads of the connection: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js#L128-L141
  if (req.readableLength >= req.readableHighWaterMark) callback();
  else if (req.socket.destroyed) console.log("closed before the reads stopped");
  else setImmediate(whenReadsStopped, req, callback);
}

function close() {
  console.log("close()");
  server.close(() => console.log("closed"));
}

function unref() {
  console.log("unref()");
  server.unref();
}

function rawWrite(socket) {
  // The client ends this process when it has all of it.
  server.keepAliveTimeout = 0;
  // More than the socket buffers hold. The client reads it when it sees "close()" or "unref()".
  socket.write(Buffer.alloc(16 * 1024 * 1024, "c"));
}

function readAgain(req, length) {
  req.on("data", chunk => {
    length += chunk.length;
    // The client sends the other half when it sees this. Until then only the connection holds the process.
    if (length === 1024 * 1024) console.log("half");
  });
  req.on("end", () => console.log("end", length));
  req.resume();
}

const shapes = {
  "response, stop, close()"(req, res) {
    res.end("ok");
    whenReadsStopped(req, close);
  },
  "stop, response, close()"(req, res) {
    whenReadsStopped(req, () => res.end("ok", close));
  },
  "close(), response, stop"(req, res) {
    close();
    res.end("ok");
  },
  "stop, close(), response drains"(req, res) {
    // More than the socket buffers hold. The client reads it when it sees "close()".
    res.end(Buffer.alloc(16 * 1024 * 1024, "b"), () => console.log("finish"));
    whenReadsStopped(req, close);
  },
  "response, stop, unref()"(req, res) {
    res.end("ok");
    req.socket.on("close", () => console.log("closed"));
    whenReadsStopped(req, unref);
  },
  "response, stop, the request is destroyed, close()"(req, res) {
    res.end("ok");
    whenReadsStopped(req, () => {
      // What a failed stream.pipeline() does to a request: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/destroy.js#L332-L334
      req.socket = null;
      req.destroy();
      close();
    });
  },
  "reads start again after close()"(req, res, length) {
    // The client decides when this connection closes.
    server.keepAliveTimeout = 0;
    res.end("ok");
    whenReadsStopped(req, () => {
      close();
      setImmediate(readAgain, req, length);
    });
  },
  "reads start again after unref()"(req, res, length) {
    server.keepAliveTimeout = 0;
    res.end("ok");
    whenReadsStopped(req, () => {
      unref();
      setImmediate(readAgain, req, length);
    });
  },
  "closeAllConnections() after close()"(req, res) {
    res.end("ok");
    whenReadsStopped(req, () => {
      close();
      setImmediate(() => server.closeAllConnections());
    });
  },
  "response, stop, raw write, close()"(req, res) {
    res.end("ok");
    whenReadsStopped(req, () => {
      rawWrite(req.socket);
      close();
    });
  },
  "response, raw write, stop, close()"(req, res) {
    res.end("ok");
    rawWrite(req.socket);
    whenReadsStopped(req, close);
  },
  "response, stop, raw write, unref()"(req, res) {
    res.end("ok");
    whenReadsStopped(req, () => {
      rawWrite(req.socket);
      unref();
    });
  },
  "response, raw write, stop, unref()"(req, res) {
    res.end("ok");
    rawWrite(req.socket);
    whenReadsStopped(req, unref);
  },
  "response, stop, the request is destroyed, raw write, close()"(req, res) {
    res.end("ok");
    whenReadsStopped(req, () => {
      const socket = req.socket;
      req.socket = null;
      req.destroy();
      rawWrite(socket);
      close();
    });
  },
};

function onRequest(req, res) {
  req.once("data", chunk => {
    req.pause();
    shapes[shape](req, res, chunk.length);
  });
}
const server =
  protocol === "https"
    ? https.createServer({ key: process.env.TLS_KEY, cert: process.env.TLS_CERT }, onRequest)
    : http.createServer(onRequest);
// A connection that holds the process is closed by this timeout, and "closed" is printed.
server.keepAliveTimeout = 2000;
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
