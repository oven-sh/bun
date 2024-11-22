//#FILE: test-http2-compat-socket-destroy-delayed.js
//#SHA1: c7b5b8b5de4667a89e0e261e36098f617d411ed2
//-----------------
"use strict";

const http2 = require("http2");

const { HTTP2_HEADER_PATH, HTTP2_HEADER_METHOD } = http2.constants;

// Skip the test if crypto is not available
if (!process.versions.openssl) {
  test.skip("missing crypto", () => {});
} else {
  test("HTTP/2 socket destroy delayed", done => {
    const app = http2.createServer((req, res) => {
      res.end("hello");
      setImmediate(() => req.socket?.destroy());
    });

    app.listen(0, () => {
      const session = http2.connect(`http://localhost:${app.address().port}`);
      const request = session.request({
        [HTTP2_HEADER_PATH]: "/",
        [HTTP2_HEADER_METHOD]: "get",
      });
      request.once("response", (headers, flags) => {
        let data = "";
        request.on("data", chunk => {
          data += chunk;
        });
        request.on("end", () => {
          expect(data).toBe("hello");
          session.close();
          app.close();
          done();
        });
      });
      request.end();
    });
  });
}

// This tests verifies that calling `req.socket.destroy()` via
// setImmediate does not crash.
// Fixes https://github.com/nodejs/node/issues/22855.

//<#END_FILE: test-http2-compat-socket-destroy-delayed.js
