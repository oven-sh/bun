//#FILE: test-http2-many-writes-and-destroy.js
//#SHA1: b4a66fa27d761038f79e0eb3562f521724887db4
//-----------------
"use strict";

const http2 = require("http2");

// Skip the test if crypto is not available
let hasCrypto;
try {
  require("crypto");
  hasCrypto = true;
} catch (err) {
  hasCrypto = false;
}

(hasCrypto ? describe : describe.skip)("HTTP/2 many writes and destroy", () => {
  let server;
  let url;

  beforeAll(done => {
    server = http2.createServer((req, res) => {
      req.pipe(res);
    });

    server.listen(0, () => {
      url = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test("should handle many writes and destroy", done => {
    const client = http2.connect(url);
    const req = client.request({ ":method": "POST" });

    for (let i = 0; i < 4000; i++) {
      req.write(Buffer.alloc(6));
    }

    req.on("close", () => {
      console.log("(req onclose)");
      client.close();
      done();
    });

    req.once("data", () => {
      req.destroy();
    });
  });
});

//<#END_FILE: test-http2-many-writes-and-destroy.js
