//#FILE: test-http2-status-code.js
//#SHA1: 53911ac66c46f57bca1d56cdaf76e46d61c957d8
//-----------------
"use strict";

const http2 = require("http2");

const codes = [200, 202, 300, 400, 404, 451, 500];
let server;
let client;

beforeAll(done => {
  server = http2.createServer();

  let testIndex = 0;
  server.on("stream", stream => {
    const status = codes[testIndex++];
    stream.respond({ ":status": status }, { endStream: true });
  });

  server.listen(0, () => {
    done();
  });
});

afterAll(() => {
  client.close();
  server.close();
});

test("HTTP/2 status codes", done => {
  const port = server.address().port;
  client = http2.connect(`http://localhost:${port}`);

  let remaining = codes.length;
  function maybeClose() {
    if (--remaining === 0) {
      done();
    }
  }

  function doTest(expected) {
    return new Promise(resolve => {
      const req = client.request();
      req.on("response", headers => {
        expect(headers[":status"]).toBe(expected);
      });
      req.resume();
      req.on("end", () => {
        maybeClose();
        resolve();
      });
    });
  }

  Promise.all(codes.map(doTest)).then(() => {
    // All tests completed
  });
});

//<#END_FILE: test-http2-status-code.js
