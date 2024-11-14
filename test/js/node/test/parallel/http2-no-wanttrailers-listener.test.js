//#FILE: test-http2-no-wanttrailers-listener.js
//#SHA1: a5297c0a1ed58f7d2d0a13bc4eaaa198a7ab160e
//-----------------
"use strict";

const h2 = require("http2");

let server;
let client;

beforeAll(() => {
  // Check if crypto is available
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }
});

afterEach(() => {
  if (client) {
    client.close();
  }
  if (server) {
    server.close();
  }
});

test("HTTP/2 server should not hang without wantTrailers listener", done => {
  server = h2.createServer();

  server.on("stream", (stream, headers, flags) => {
    stream.respond(undefined, { waitForTrailers: true });
    stream.end("ok");
  });

  server.listen(0, () => {
    const port = server.address().port;
    client = h2.connect(`http://localhost:${port}`);
    const req = client.request();
    req.resume();

    req.on("trailers", () => {
      throw new Error("Unexpected trailers event");
    });

    req.on("close", () => {
      done();
    });
  });
});

//<#END_FILE: test-http2-no-wanttrailers-listener.js
