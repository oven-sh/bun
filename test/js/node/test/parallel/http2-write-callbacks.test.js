//#FILE: test-http2-write-callbacks.js
//#SHA1: 4ad84acd162dcde6c2fbe344e6da2a3ec225edc1
//-----------------
"use strict";

const http2 = require("http2");

// Mock for common.mustCall
const mustCall = fn => {
  const wrappedFn = jest.fn(fn);
  return wrappedFn;
};

describe("HTTP/2 write callbacks", () => {
  let server;
  let client;
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

  test("write callbacks are called", done => {
    const serverWriteCallback = mustCall(() => {});
    const clientWriteCallback = mustCall(() => {});

    server.once("stream", stream => {
      stream.write("abc", serverWriteCallback);
      stream.end("xyz");

      let actual = "";
      stream.setEncoding("utf8");
      stream.on("data", chunk => (actual += chunk));
      stream.on("end", () => {
        expect(actual).toBe("abcxyz");
      });
    });

    client = http2.connect(`http://localhost:${port}`);
    const req = client.request({ ":method": "POST" });

    req.write("abc", clientWriteCallback);
    req.end("xyz");

    let actual = "";
    req.setEncoding("utf8");
    req.on("data", chunk => (actual += chunk));
    req.on("end", () => {
      expect(actual).toBe("abcxyz");
    });

    req.on("close", () => {
      client.close();

      // Check if callbacks were called
      expect(serverWriteCallback).toHaveBeenCalled();
      expect(clientWriteCallback).toHaveBeenCalled();

      done();
    });
  });
});

//<#END_FILE: test-http2-write-callbacks.js
