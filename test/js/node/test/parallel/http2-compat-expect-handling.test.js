//#FILE: test-http2-compat-expect-handling.js
//#SHA1: 015a7b40547c969f4d631e7e743f5293d9e8f843
//-----------------
"use strict";

const http2 = require("http2");

const hasCrypto = (() => {
  try {
    require("crypto");
    return true;
  } catch (err) {
    return false;
  }
})();

const expectValue = "meoww";

describe("HTTP/2 Expect Header Handling", () => {
  let server;
  let port;

  beforeAll(done => {
    server = http2.createServer();
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test("server should not call request handler", () => {
    const requestHandler = jest.fn();
    server.on("request", requestHandler);

    return new Promise(resolve => {
      server.once("checkExpectation", (req, res) => {
        expect(req.headers.expect).toBe(expectValue);
        res.statusCode = 417;
        res.end();
        expect(requestHandler).not.toHaveBeenCalled();
        resolve();
      });

      const client = http2.connect(`http://localhost:${port}`);
      const req = client.request({
        ":path": "/",
        ":method": "GET",
        ":scheme": "http",
        ":authority": `localhost:${port}`,
        "expect": expectValue,
      });

      req.on("response", headers => {
        expect(headers[":status"]).toBe(417);
        req.resume();
      });

      req.on("end", () => {
        client.close();
      });
    });
  });

  test("client should receive 417 status", () => {
    return new Promise(resolve => {
      const client = http2.connect(`http://localhost:${port}`);
      const req = client.request({
        ":path": "/",
        ":method": "GET",
        ":scheme": "http",
        ":authority": `localhost:${port}`,
        "expect": expectValue,
      });

      req.on("response", headers => {
        expect(headers[":status"]).toBe(417);
        req.resume();
      });

      req.on("end", () => {
        client.close();
        resolve();
      });
    });
  });
});

if (!hasCrypto) {
  test.skip("skipping HTTP/2 tests due to missing crypto support", () => {});
}

//<#END_FILE: test-http2-compat-expect-handling.js
