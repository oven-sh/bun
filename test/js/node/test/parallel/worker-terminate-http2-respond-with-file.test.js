//#FILE: test-worker-terminate-http2-respond-with-file.js
//#SHA1: e8ce958ee3283a8ec8c83acc27cc3a02824ebfb7
//-----------------
"use strict";

const http2 = require("http2");
const makeDuplexPair = require("../common/duplexpair");
const { Worker, isMainThread } = require("worker_threads");

// This is a variant of test-http2-generic-streams-sendfile for checking
// that Workers can be terminated during a .respondWithFile() operation.

if (isMainThread) {
  test("Worker can be terminated during respondWithFile operation", () => {
    const worker = new Worker(__filename);
    expect(worker).toBeDefined();
  });
} else {
  test("HTTP/2 server responds with file", done => {
    const server = http2.createServer();
    server.on("stream", (stream, headers) => {
      stream.respondWithFile(process.execPath); // Use a large-ish file.
    });

    const { clientSide, serverSide } = makeDuplexPair();
    server.emit("connection", serverSide);

    const client = http2.connect("http://localhost:80", {
      createConnection: () => clientSide,
    });

    const req = client.request();

    req.on("response", headers => {
      expect(headers[":status"]).toBe(200);
    });

    req.on("data", () => {
      process.exit();
      done();
    });

    req.on("end", () => {
      done.fail("Request should not end");
    });

    req.end();
  });
}

//<#END_FILE: test-worker-terminate-http2-respond-with-file.js
