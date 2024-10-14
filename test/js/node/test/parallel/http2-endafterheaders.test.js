//#FILE: test-http2-endafterheaders.js
//#SHA1: 49daddad2dbf7705e6ed4e15bd8cd76fa475d5ff
//-----------------
"use strict";

const http2 = require("http2");

// Mock the Countdown class
class Countdown {
  constructor(count, callback) {
    this.count = count;
    this.callback = callback;
  }
  dec() {
    this.count--;
    if (this.count === 0) this.callback();
  }
}

// Skip the test if crypto is not available
const hasCrypto = (() => {
  try {
    require("crypto");
    return true;
  } catch (err) {
    return false;
  }
})();

(hasCrypto ? describe : describe.skip)("HTTP/2 endAfterHeaders", () => {
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

  test("server handles streams correctly", done => {
    const streamHandler = jest.fn((stream, headers) => {
      const check = headers[":method"] === "GET";
      expect(stream.endAfterHeaders).toBe(check);

      const dataHandler = jest.fn();
      stream.on("data", dataHandler);

      const endHandler = jest.fn();
      stream.on("end", endHandler);

      stream.respond();
      stream.end("ok");

      setImmediate(() => {
        expect(dataHandler).not.toHaveBeenCalled();
        expect(endHandler).toHaveBeenCalled();
      });
    });

    server.on("stream", streamHandler);

    const countdown = new Countdown(2, () => {
      expect(streamHandler).toHaveBeenCalledTimes(2);
      done();
    });

    // First client request (GET)
    {
      const client = http2.connect(`http://localhost:${port}`);
      const req = client.request();

      req.resume();
      req.on("response", () => {
        expect(req.endAfterHeaders).toBe(false);
      });
      req.on("end", () => {
        client.close();
        countdown.dec();
      });
    }

    // Second client request (POST)
    {
      const client = http2.connect(`http://localhost:${port}`);
      const req = client.request({ ":method": "POST" });

      req.resume();
      req.end();
      req.on("response", () => {
        expect(req.endAfterHeaders).toBe(false);
      });
      req.on("end", () => {
        client.close();
        countdown.dec();
      });
    }
  });
});

//<#END_FILE: test-http2-endafterheaders.js
