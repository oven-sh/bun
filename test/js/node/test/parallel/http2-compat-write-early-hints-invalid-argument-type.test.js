//#FILE: test-http2-compat-write-early-hints-invalid-argument-type.js
//#SHA1: 8ae2eba59668a38b039a100d3ad26f88e54be806
//-----------------
"use strict";

const http2 = require("node:http2");
const util = require("node:util");
const debug = util.debuglog("test");

const testResBody = "response content";

// Check if crypto is available
let hasCrypto = false;
try {
  require("crypto");
  hasCrypto = true;
} catch (err) {
  // crypto not available
}

(hasCrypto ? describe : describe.skip)("HTTP2 compat writeEarlyHints invalid argument type", () => {
  let server;
  let client;

  beforeAll(done => {
    server = http2.createServer();
    server.listen(0, () => {
      done();
    });
  });

  afterAll(() => {
    if (client) {
      client.close();
    }
    server.close();
  });

  test("should throw ERR_INVALID_ARG_TYPE for invalid object value", done => {
    server.on("request", (req, res) => {
      debug("Server sending early hints...");
      expect(() => {
        res.writeEarlyHints("this should not be here");
      }).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );

      debug("Server sending full response...");
      res.end(testResBody);
    });

    client = http2.connect(`http://localhost:${server.address().port}`);
    const req = client.request();

    debug("Client sending request...");

    req.on("headers", () => {
      done(new Error("Should not receive headers"));
    });

    req.on("response", () => {
      done();
    });

    req.end();
  });
});

//<#END_FILE: test-http2-compat-write-early-hints-invalid-argument-type.js
