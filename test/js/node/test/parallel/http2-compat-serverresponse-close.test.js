//#FILE: test-http2-compat-serverresponse-close.js
//#SHA1: 6b61a9cea948447ae33843472678ffbed0b47c9a
//-----------------
"use strict";

const h2 = require("http2");

// Skip the test if crypto is not available
let hasCrypto;
try {
  require("crypto");
  hasCrypto = true;
} catch (err) {
  hasCrypto = false;
}

(hasCrypto ? describe : describe.skip)("HTTP/2 server response close", () => {
  let server;
  let url;

  beforeAll(done => {
    server = h2.createServer((req, res) => {
      res.writeHead(200);
      res.write("a");

      const reqCloseMock = jest.fn();
      const resCloseMock = jest.fn();
      const reqErrorMock = jest.fn();

      req.on("close", reqCloseMock);
      res.on("close", resCloseMock);
      req.on("error", reqErrorMock);

      // Use Jest's fake timers to ensure the test doesn't hang
      setTimeout(() => {
        expect(reqCloseMock).toHaveBeenCalled();
        expect(resCloseMock).toHaveBeenCalled();
        expect(reqErrorMock).not.toHaveBeenCalled();
        done();
      }, 1000);
    });

    server.listen(0, () => {
      url = `http://localhost:${server.address().port}`;
      done();
    });
  });

  afterAll(() => {
    server.close();
  });

  test("Server request and response should receive close event if connection terminated before response.end", done => {
    const client = h2.connect(url, () => {
      const request = client.request();
      request.on("data", chunk => {
        client.destroy();
        done();
      });
    });
  });
});

//<#END_FILE: test-http2-compat-serverresponse-close.js
