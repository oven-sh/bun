//#FILE: test-http2-client-request-listeners-warning.js
//#SHA1: cb4f9a71d1f670a78f989caed948e88fa5dbd681
//-----------------
"use strict";
const http2 = require("http2");
const EventEmitter = require("events");

// Skip the test if crypto is not available
let hasCrypto;
try {
  require("crypto");
  hasCrypto = true;
} catch (err) {
  hasCrypto = false;
}

(hasCrypto ? describe : describe.skip)("HTTP2 client request listeners warning", () => {
  let server;
  let port;

  beforeAll(done => {
    server = http2.createServer();
    server.on("stream", stream => {
      stream.respond();
      stream.end();
    });

    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test("should not emit MaxListenersExceededWarning", done => {
    const warningListener = jest.fn();
    process.on("warning", warningListener);

    const client = http2.connect(`http://localhost:${port}`);

    function request() {
      return new Promise((resolve, reject) => {
        const stream = client.request();
        stream.on("error", reject);
        stream.on("response", resolve);
        stream.end();
      });
    }

    const requests = [];
    for (let i = 0; i < EventEmitter.defaultMaxListeners + 1; i++) {
      requests.push(request());
    }

    Promise.all(requests)
      .then(() => {
        expect(warningListener).not.toHaveBeenCalled();
      })
      .finally(() => {
        process.removeListener("warning", warningListener);
        client.close();
        done();
      });
  });
});

//<#END_FILE: test-http2-client-request-listeners-warning.js
