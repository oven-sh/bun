//#FILE: test-http2-compat-serverresponse-settimeout.js
//#SHA1: fe2e0371e885463968a268362464724494b758a6
//-----------------
"use strict";

const http2 = require("http2");

const msecs = 1000; // Assuming a reasonable timeout for all platforms

let server;
let client;

beforeAll(done => {
  if (!process.versions.openssl) {
    return test.skip("missing crypto");
  }
  server = http2.createServer();
  server.listen(0, () => {
    done();
  });
});

afterAll(() => {
  if (client) {
    client.close();
  }
  if (server) {
    server.close();
  }
});

test("HTTP2 ServerResponse setTimeout", done => {
  const timeoutCallback = jest.fn();
  const onTimeout = jest.fn();
  const onFinish = jest.fn();

  server.on("request", (req, res) => {
    res.setTimeout(msecs, timeoutCallback);
    res.on("timeout", onTimeout);
    res.on("finish", () => {
      onFinish();
      res.setTimeout(msecs, jest.fn());
      process.nextTick(() => {
        res.setTimeout(msecs, jest.fn());
      });
    });

    // Explicitly end the response after a short delay
    setTimeout(() => {
      res.end();
    }, 100);
  });

  const port = server.address().port;
  client = http2.connect(`http://localhost:${port}`);
  const req = client.request({
    ":path": "/",
    ":method": "GET",
    ":scheme": "http",
    ":authority": `localhost:${port}`,
  });

  req.on("end", () => {
    client.close();

    // Move assertions here to ensure they run after the response has finished
    expect(timeoutCallback).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledTimes(1);

    done();
  });

  req.resume();
  req.end();
}, 10000); // Increase the timeout to 10 seconds

//<#END_FILE: test-http2-compat-serverresponse-settimeout.js
